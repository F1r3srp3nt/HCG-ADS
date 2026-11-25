import type { AnalyticsReport, MetricTotals } from "@hcg-ads/contracts";
import type { Database } from "../db/database.ts";
import type { Clock } from "../core/clock.ts";
import { dayOf } from "../core/clock.ts";
import type { AuditActor, AuditLog } from "../core/audit.ts";
import { invalid } from "../core/errors.ts";
import { newId } from "../core/ids.ts";
import type { CampaignService } from "../campaigns/service.ts";

const zero = (): MetricTotals => ({ requests: 0, filled: 0, impressions: 0, viewable: 0, clicks: 0, ctr: 0, videoStarts: 0, videoCompletes: 0, errors: 0, invalid: 0 });

/**
 * Analytics Engine. Measured and simulated data are separate datasets and are
 * never combined. Metrics are aggregates; no personal data is collected.
 */
export class AnalyticsService {
  constructor(private db: Database, private clock: Clock, private audit: AuditLog, private campaigns: CampaignService) {}

  report(opts: { from?: string; to?: string; dataset?: "measured" | "simulated"; campaignId?: string; publisherId?: string }): AnalyticsReport {
    const dataset = opts.dataset ?? "measured";
    const sim = dataset === "simulated" ? 1 : 0;
    const to = opts.to ?? dayOf(this.clock.now());
    const from = opts.from ?? dayOf(new Date(new Date(to).getTime() - 29 * 86400_000));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw invalid("Dates must be YYYY-MM-DD.");

    const filters = ["day BETWEEN ? AND ?", "simulated = ?"];
    const params: (string | number)[] = [from, to, sim];
    if (opts.campaignId) { filters.push("campaign_id = ?"); params.push(opts.campaignId); }
    if (opts.publisherId) { filters.push("publisher_id = ?"); params.push(opts.publisherId); }
    const events = this.db.all<{ day: string; type: string; campaign_id: string; creative_id: string; placement_id: string; publisher_id: string; invalid_reason: string | null; n: number }>(
      `SELECT day, type, campaign_id, creative_id, placement_id, publisher_id, invalid_reason, COUNT(*) n FROM events WHERE ${filters.join(" AND ")}
       GROUP BY day, type, campaign_id, creative_id, placement_id, publisher_id, invalid_reason IS NULL`, ...params);

    const cFilters = ["day BETWEEN ? AND ?", "simulated = ?"];
    const cParams: (string | number)[] = [from, to, sim];
    if (opts.campaignId) { cFilters.push("campaign_id = ?"); cParams.push(opts.campaignId); }
    const counters = this.db.all<{ day: string; placement_id: string; campaign_id: string; requests: number; filled: number }>(
      `SELECT day, placement_id, campaign_id, requests, filled FROM delivery_counters WHERE ${cFilters.join(" AND ")}`, ...cParams);

    const buckets = { total: new Map<string, MetricTotals>(), day: new Map<string, MetricTotals>(), campaign: new Map<string, MetricTotals>(), placement: new Map<string, MetricTotals>(), publisher: new Map<string, MetricTotals>(), creative: new Map<string, MetricTotals>() };
    const get = (m: Map<string, MetricTotals>, k: string) => { let v = m.get(k); if (!v) { v = zero(); m.set(k, v); } return v; };
    const placementPublisher = new Map(this.db.all<{ id: string; publisher_id: string }>("SELECT id, publisher_id FROM placements").map((r) => [r.id, r.publisher_id]));

    for (const e of events) {
      const targets = [get(buckets.total, "all"), get(buckets.day, e.day), get(buckets.campaign, e.campaign_id), get(buckets.placement, e.placement_id), get(buckets.publisher, e.publisher_id), get(buckets.creative, e.creative_id)];
      for (const t of targets) {
        if (e.invalid_reason) { t.invalid += e.n; continue; }
        if (e.type === "impression") t.impressions += e.n;
        else if (e.type === "viewable") t.viewable += e.n;
        else if (e.type === "click") t.clicks += e.n;
        else if (e.type === "video_start") t.videoStarts += e.n;
        else if (e.type === "video_complete") t.videoCompletes += e.n;
        else if (e.type === "error") t.errors += e.n;
      }
    }
    for (const c of counters) {
      const pub = placementPublisher.get(c.placement_id) ?? "";
      if (opts.publisherId && pub !== opts.publisherId) continue;
      // Requests are counted once per placement (campaign_id ''); fills per campaign.
      const targets = c.campaign_id === ""
        ? [get(buckets.total, "all"), get(buckets.day, c.day), get(buckets.placement, c.placement_id), get(buckets.publisher, pub)]
        : [get(buckets.total, "all"), get(buckets.day, c.day), get(buckets.placement, c.placement_id), get(buckets.publisher, pub), get(buckets.campaign, c.campaign_id)];
      for (const t of targets) { t.requests += c.requests; t.filled += c.filled; }
    }
    const finish = (t: MetricTotals) => ({ ...t, ctr: t.impressions ? Math.round((t.clicks / t.impressions) * 10000) / 100 : 0 });
    const names = (table: string, col = "name") => new Map(this.db.all<{ id: string; n: string }>(`SELECT id, ${col} n FROM ${table}`).map((r) => [r.id, r.n]));
    const cn = names("campaigns"), pn = names("placements"), un = names("publishers"), rn = names("creatives", "headline");
    const list = (m: Map<string, MetricTotals>, n: Map<string, string>) => [...m.entries()].map(([id, t]) => ({ id, name: n.get(id) ?? id, ...finish(t) })).sort((a, b) => b.impressions - a.impressions);

    const days: Array<{ day: string } & MetricTotals> = [];
    for (let d = new Date(from); dayOf(d) <= to; d = new Date(d.getTime() + 86400_000)) days.push({ day: dayOf(d), ...finish(buckets.day.get(dayOf(d)) ?? zero()) });

    return {
      dataset, from, to,
      totals: finish(buckets.total.get("all") ?? zero()),
      byDay: days,
      byCampaign: list(buckets.campaign, cn),
      byPlacement: list(buckets.placement, pn),
      byPublisher: list(buckets.publisher, un),
      byCreative: list(buckets.creative, rn),
    };
  }

  /** Development only: generates clearly labelled simulated traffic for a campaign. */
  simulate(campaignId: string, days: number, actor: AuditActor): { events: number } {
    const c = this.campaigns.get(campaignId);
    if (!c.placementIds.length || !c.creatives.length) throw invalid("The campaign needs placements and creatives to simulate traffic.");
    const now = this.clock.now();
    let n = 0;
    this.db.tx(() => {
      for (let d = 0; d < Math.min(days, 60); d++) {
        const day = dayOf(new Date(now.getTime() - d * 86400_000));
        for (const pid of c.placementIds) {
          const pub = this.db.get<{ publisher_id: string }>("SELECT publisher_id FROM placements WHERE id = ?", pid)!.publisher_id;
          const imps = 40 + Math.floor(Math.random() * 160);
          this.db.run(`INSERT INTO delivery_counters (day, placement_id, campaign_id, simulated, requests, filled) VALUES (?, ?, '', 1, ?, 0)
            ON CONFLICT(day, placement_id, campaign_id, simulated) DO UPDATE SET requests = requests + excluded.requests`, day, pid, Math.round(imps * 1.2));
          this.db.run(`INSERT INTO delivery_counters (day, placement_id, campaign_id, simulated, requests, filled) VALUES (?, ?, ?, 1, 0, ?)
            ON CONFLICT(day, placement_id, campaign_id, simulated) DO UPDATE SET filled = filled + excluded.filled`, day, pid, c.id, imps);
          for (let i = 0; i < imps; i++) {
            const cr = c.creatives[i % c.creatives.length];
            const delivery = `sim_${newId("d")}`;
            const types = ["impression", ...(Math.random() < 0.6 ? ["viewable"] : []), ...(Math.random() < 0.018 ? ["click"] : [])];
            for (const t of types) {
              this.db.run(`INSERT INTO events (id, delivery_id, type, campaign_id, creative_id, placement_id, publisher_id, at, day, simulated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
                newId("evt"), delivery, t, c.id, cr.id, pid, pub, `${day}T12:00:00.000Z`, day);
              n++;
            }
          }
        }
      }
    });
    this.audit.record(actor, "analytics.simulate", "campaign", c.id, `Generated ${n} SIMULATED development events (kept separate from measured data)`);
    return { events: n };
  }

  clearSimulated(actor: AuditActor): number {
    const r = this.db.run("DELETE FROM events WHERE simulated = 1");
    this.db.run("DELETE FROM delivery_counters WHERE simulated = 1");
    this.audit.record(actor, "analytics.clear_simulated", "analytics", null, `Removed ${r.changes} simulated events`);
    return r.changes;
  }

  /** Retention: measured event rows older than the retention period are deleted. */
  purge(retentionDays: number, actor: AuditActor): number {
    const cutoff = dayOf(new Date(this.clock.now().getTime() - retentionDays * 86400_000));
    const r = this.db.run("DELETE FROM events WHERE day < ?", cutoff);
    this.db.run("DELETE FROM delivery_counters WHERE day < ?", cutoff);
    if (r.changes) this.audit.record(actor, "analytics.retention_purge", "analytics", null, `Deleted ${r.changes} events older than ${cutoff}`);
    return r.changes;
  }
}
