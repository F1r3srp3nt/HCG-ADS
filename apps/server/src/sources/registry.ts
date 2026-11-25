import type { ContentItem, ContentSource, ContentSourceKind } from "@hcg-ads/contracts";
import type { Database } from "../db/database.ts";
import { json } from "../db/database.ts";
import type { Clock } from "../core/clock.ts";
import type { AuditActor, AuditLog } from "../core/audit.ts";
import { SYSTEM_ACTOR } from "../core/audit.ts";
import { AppError, notFound } from "../core/errors.ts";
import type { BrowseOptions, ContentSourceAdapter } from "./adapter.ts";

export const SOURCE_IDS: Record<ContentSourceKind, string> = {
  "hcg-news": "src_hcg_news",
  "hcg-store": "src_hcg_store",
  "hcg-website": "src_hcg_website",
  custom: "src_custom",
};

export interface SyncReport {
  sourceId: string;
  checked: number;
  refreshed: number;
  unavailable: string[];
  errors: number;
  suspendedCampaigns: string[];
}

/** Content Source Registry: registered HCG sources, cached snapshots, synchronisation. */
export class ContentSourceRegistry {
  private adapters = new Map<string, ContentSourceAdapter>();
  /** Called when a promoted item is confirmed unpublished/unavailable. Returns suspended campaign ids. */
  onItemUnavailable: (sourceId: string, externalId: string, reason: string) => string[] = () => [];

  constructor(private db: Database, private clock: Clock, private audit: AuditLog, adapters: ContentSourceAdapter[]) {
    for (const a of adapters) {
      const id = SOURCE_IDS[a.kind];
      this.adapters.set(id, a);
      const now = this.clock.now().toISOString();
      this.db.run(
        `INSERT INTO content_sources (id, kind, name, status, description, created_at) VALUES (?, ?, ?, 'not_configured', ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description`,
        id, a.kind, a.name, a.description, now,
      );
    }
  }

  adapter(sourceId: string): ContentSourceAdapter {
    const a = this.adapters.get(sourceId);
    if (!a) throw notFound("Content source");
    return a;
  }

  list(): Array<ContentSource & { configured: boolean; configurationProblems: string[] }> {
    return this.db.all<Record<string, unknown>>("SELECT * FROM content_sources ORDER BY created_at, id").map((r) => {
      const a = this.adapters.get(String(r.id));
      const count = this.db.get<{ n: number }>("SELECT COUNT(*) n FROM content_items WHERE source_id = ?", String(r.id))?.n ?? 0;
      return {
        id: String(r.id),
        kind: r.kind as ContentSourceKind,
        name: String(r.name),
        status: (a?.configured ? r.status : "not_configured") as ContentSource["status"],
        description: String(r.description),
        lastSyncAt: (r.last_sync_at as string) ?? null,
        lastSyncResult: (r.last_sync_result as string) ?? null,
        itemCount: count,
        connectedAt: (r.connected_at as string) ?? null,
        configured: a?.configured ?? false,
        configurationProblems: a?.configurationProblems ?? [],
      };
    });
  }

  get(sourceId: string) {
    const s = this.list().find((x) => x.id === sourceId);
    if (!s) throw notFound("Content source");
    return s;
  }

  async connect(sourceId: string, actor: AuditActor) {
    const a = this.adapter(sourceId);
    if (!a.configured) throw new AppError(409, "not_configured", `${a.name} is not configured: ${a.configurationProblems.join(" ")}`);
    const result = await a.verify();
    const now = this.clock.now().toISOString();
    this.db.run(
      "UPDATE content_sources SET status = ?, connected_at = COALESCE(connected_at, ?), last_sync_result = ? WHERE id = ?",
      result.ok ? "connected" : "degraded", result.ok ? now : null, result.message, sourceId,
    );
    this.audit.record(actor, "content_source.connect", "content_source", sourceId, `${a.name}: ${result.message}`);
    if (!result.ok) throw new AppError(502, "source_unreachable", result.message);
    return this.get(sourceId);
  }

  async disconnect(sourceId: string, actor: AuditActor) {
    this.adapter(sourceId);
    this.db.run("UPDATE content_sources SET status = 'disconnected' WHERE id = ?", sourceId);
    this.audit.record(actor, "content_source.disconnect", "content_source", sourceId, "Disconnected");
    return this.get(sourceId);
  }

  private requireConnected(sourceId: string) {
    const s = this.get(sourceId);
    if (s.status !== "connected" && s.status !== "degraded") {
      throw new AppError(409, "source_not_connected", `${s.name} is not connected. Connect it first.`);
    }
  }

  async browse(sourceId: string, options: BrowseOptions) {
    this.requireConnected(sourceId);
    const page = await this.adapter(sourceId).browse(sourceId, options);
    for (const item of page.items) this.store(item);
    return page;
  }

  async categories(sourceId: string) {
    this.requireConnected(sourceId);
    return this.adapter(sourceId).categories();
  }

  /** Fresh metadata from the source (used when a campaign is created from an item). */
  async fetchItem(sourceId: string, externalId: string): Promise<ContentItem> {
    this.requireConnected(sourceId);
    const r = await this.adapter(sourceId).lookup(sourceId, externalId);
    if (r.found) {
      this.store(r.item);
      return r.item;
    }
    if (r.reason === "source_error") throw new AppError(502, "source_unreachable", r.message);
    throw new AppError(404, "content_unavailable", "This item is not published (or no longer available) at its source.");
  }

  cached(sourceId: string, externalId: string): (ContentItem & { checkedAt: string }) | null {
    const r = this.db.get<Record<string, unknown>>("SELECT * FROM content_items WHERE source_id = ? AND external_id = ?", sourceId, externalId);
    if (!r) return null;
    const item = json.parse<ContentItem>(r.snapshot, null as unknown as ContentItem);
    return { ...item, status: r.status as ContentItem["status"], checkedAt: String(r.last_checked_at) };
  }

  private store(item: ContentItem) {
    const now = this.clock.now().toISOString();
    this.db.run(
      `INSERT INTO content_items (source_id, external_id, snapshot, status, first_seen_at, last_checked_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_id, external_id) DO UPDATE SET snapshot = excluded.snapshot, status = excluded.status, last_checked_at = excluded.last_checked_at`,
      item.sourceId, item.externalId, json.str(item), item.status, now, now,
    );
  }

  /**
   * Metadata refresh and synchronisation. Every item referenced by a creative
   * is re-checked at its source. An item the source confirms is no longer
   * published suspends its campaigns automatically. A source outage is never
   * treated as unpublication.
   */
  async sync(sourceId: string, actor: AuditActor = SYSTEM_ACTOR): Promise<SyncReport> {
    const s = this.get(sourceId);
    const report: SyncReport = { sourceId, checked: 0, refreshed: 0, unavailable: [], errors: 0, suspendedCampaigns: [] };
    if (s.status === "not_configured" || s.status === "disconnected") return report;
    const adapter = this.adapter(sourceId);
    const refs = this.db.all<{ id: string }>(
      `SELECT DISTINCT content_external_id id FROM creatives WHERE content_source_id = ? AND content_external_id IS NOT NULL`, sourceId,
    ).map((r) => r.id);
    for (const externalId of refs) {
      report.checked++;
      const r = await adapter.lookup(sourceId, externalId);
      const now = this.clock.now().toISOString();
      if (r.found) {
        this.store(r.item);
        report.refreshed++;
      } else if (r.reason === "source_error") {
        report.errors++;
      } else {
        const prev = this.cached(sourceId, externalId);
        const snapshot = prev ?? { externalId, sourceId };
        this.db.run(
          `INSERT INTO content_items (source_id, external_id, snapshot, status, first_seen_at, last_checked_at) VALUES (?, ?, ?, 'unavailable', ?, ?)
           ON CONFLICT(source_id, external_id) DO UPDATE SET status = 'unavailable', last_checked_at = excluded.last_checked_at`,
          sourceId, externalId, json.str({ ...snapshot, status: "unavailable" }), now, now,
        );
        report.unavailable.push(externalId);
        report.suspendedCampaigns.push(...this.onItemUnavailable(sourceId, externalId, r.reason));
      }
    }
    const summary = `Checked ${report.checked}, refreshed ${report.refreshed}, unavailable ${report.unavailable.length}, errors ${report.errors}` +
      (report.suspendedCampaigns.length ? `, suspended ${report.suspendedCampaigns.length} campaign(s)` : "");
    this.db.run("UPDATE content_sources SET last_sync_at = ?, last_sync_result = ?, status = ? WHERE id = ?",
      this.clock.now().toISOString(), summary, report.errors && !report.refreshed ? "degraded" : "connected", sourceId);
    if (report.unavailable.length || actor !== SYSTEM_ACTOR) this.audit.record(actor, "content_source.sync", "content_source", sourceId, summary, report);
    return report;
  }
}
