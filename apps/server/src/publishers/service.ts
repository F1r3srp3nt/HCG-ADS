import { z } from "zod";
import type { MediaKind, Placement, Platform, Publisher } from "@hcg-ads/contracts";
import type { Database } from "../db/database.ts";
import { bool, json } from "../db/database.ts";
import type { Clock } from "../core/clock.ts";
import type { AuditActor, AuditLog } from "../core/audit.ts";
import { AppError, conflict, invalid, notFound } from "../core/errors.ts";
import { newId, newPublicKey } from "../core/ids.ts";
import { aspectRatio } from "../placements/compat.ts";

const PLATFORMS = ["web", "ios", "android", "macos", "windows", "linux", "desktop"] as const;
const KINDS = ["image", "animated-image", "video", "native"] as const;

/** Web test origins (https://host[:port]) and native test apps (app://<bundle or app identifier>). */
const originSchema = z.string().regex(/^(https?:\/\/[a-z0-9.-]+(:\d+)?|app:\/\/[a-zA-Z0-9.\-_]+)$/i, "A test origin looks like https://example.com or app://com.example.app");
const domainSchema = z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "Enter a domain such as news.example.com");

export const PublisherInput = z.object({
  productId: z.string().min(2).max(80),
  name: z.string().min(2).max(120),
  domains: z.array(domainSchema).max(20).default([]),
  appIdentifiers: z.array(z.string().regex(/^[a-zA-Z0-9.\-_]+$/)).max(20).default([]),
  testOrigins: z.array(originSchema).max(20).default([]),
  administrators: z.array(z.string()).max(50).default([]),
  platforms: z.array(z.enum(PLATFORMS)).min(1),
  supportedFormats: z.array(z.enum(KINDS)).min(1).default(["image", "native"]),
  campaignEligibility: z.object({ internal: z.boolean(), external: z.boolean() }).default({ internal: true, external: false }),
});

export const PlacementInput = z.object({
  name: z.string().min(2).max(120),
  slot: z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/, "Use lowercase letters, digits and hyphens"),
  platform: z.enum(PLATFORMS),
  width: z.number().int().min(1).max(8000).nullable(),
  height: z.number().int().min(1).max(8000).nullable(),
  responsive: z.enum(["fixed", "fluid-width", "responsive-native"]),
  formats: z.array(z.enum(KINDS)).min(1),
  maxFileBytes: z.number().int().min(1024).max(500 * 1024 * 1024).default(2 * 1024 * 1024),
  maxVideoSeconds: z.number().int().min(1).max(600).default(30),
  allowAnimation: z.boolean().default(true),
  internalEligible: z.boolean().default(true),
  externalEligible: z.boolean().default(false),
  restrictions: z.object({ blockedCategories: z.array(z.string()).default([]), allowedCategories: z.array(z.string()).default([]) }).default({ blockedCategories: [], allowedCategories: [] }),
  fallback: z.enum(["collapse", "house-ad", "keep-space"]).default("collapse"),
}).refine((p) => p.responsive === "responsive-native" || (p.width && p.height), { message: "Fixed and fluid placements need a width and height." });

export function mapPublisher(r: Record<string, unknown>): Publisher {
  return {
    id: String(r.id),
    productId: String(r.product_id),
    name: String(r.name),
    domains: json.parse(r.domains, []),
    appIdentifiers: json.parse(r.app_identifiers, []),
    testOrigins: json.parse(r.test_origins, []),
    ownerSubject: (r.owner_subject as string) ?? null,
    administrators: json.parse(r.administrators, []),
    platforms: json.parse(r.platforms, []),
    supportedFormats: json.parse(r.supported_formats, []),
    campaignEligibility: { internal: bool(r.internal_eligible), external: bool(r.external_eligible) },
    status: r.status as Publisher["status"],
    deliveryMode: r.delivery_mode as Publisher["deliveryMode"],
    liveApprovedBy: (r.live_approved_by as string) ?? null,
    liveApprovedAt: (r.live_approved_at as string) ?? null,
    isInternal: bool(r.is_internal),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export function mapPlacement(r: Record<string, unknown>): Placement {
  const width = (r.width as number) ?? null;
  const height = (r.height as number) ?? null;
  return {
    id: String(r.id),
    publicKey: String(r.public_key),
    publisherId: String(r.publisher_id),
    name: String(r.name),
    slot: String(r.slot),
    platform: r.platform as Platform,
    width,
    height,
    aspectRatio: aspectRatio(width, height),
    responsive: r.responsive as Placement["responsive"],
    formats: json.parse<MediaKind[]>(r.formats, []),
    maxFileBytes: Number(r.max_file_bytes),
    maxVideoSeconds: Number(r.max_video_seconds),
    allowAnimation: bool(r.allow_animation),
    internalEligible: bool(r.internal_eligible),
    externalEligible: bool(r.external_eligible),
    restrictions: json.parse(r.restrictions, { blockedCategories: [], allowedCategories: [] }),
    fallback: r.fallback as Placement["fallback"],
    status: r.status as Placement["status"],
    createdAt: String(r.created_at),
  };
}

export const HCG_NEWS_PUBLISHER_ID = "pub_hcg_news";

/** HCG News placements registered when HCG News is connected. */
export const HCG_NEWS_PLACEMENTS: Array<z.input<typeof PlacementInput>> = [
  { name: "Homepage leaderboard", slot: "home-leaderboard", platform: "web", width: 728, height: 90, responsive: "fluid-width", formats: ["image", "animated-image", "native"], maxFileBytes: 300 * 1024, internalEligible: true, externalEligible: true },
  { name: "Homepage billboard", slot: "home-billboard", platform: "web", width: 970, height: 250, responsive: "fluid-width", formats: ["image", "animated-image", "video", "native"], maxFileBytes: 2 * 1024 * 1024, maxVideoSeconds: 30, internalEligible: true, externalEligible: true },
  { name: "Article sidebar", slot: "article-sidebar", platform: "web", width: 300, height: 250, responsive: "fixed", formats: ["image", "animated-image", "native", "video"], maxFileBytes: 1024 * 1024, maxVideoSeconds: 30, internalEligible: true, externalEligible: true },
  { name: "In-article promotion", slot: "in-article", platform: "web", width: null, height: null, responsive: "responsive-native", formats: ["native"], internalEligible: true, externalEligible: false },
  { name: "Related article promotion", slot: "related-article", platform: "web", width: null, height: null, responsive: "responsive-native", formats: ["native"], internalEligible: true, externalEligible: false },
  { name: "Mobile banner", slot: "mobile-banner", platform: "web", width: 320, height: 50, responsive: "fixed", formats: ["image", "native"], maxFileBytes: 150 * 1024, allowAnimation: false, internalEligible: true, externalEligible: true },
  { name: "Large mobile banner", slot: "mobile-banner-large", platform: "web", width: 320, height: 100, responsive: "fixed", formats: ["image", "native"], maxFileBytes: 200 * 1024, internalEligible: true, externalEligible: true },
  { name: "iOS native card", slot: "ios-native-card", platform: "ios", width: null, height: null, responsive: "responsive-native", formats: ["native"], internalEligible: true, externalEligible: false },
];

/** Publisher Manager and Advertising Placement Manager. */
export class PublisherService {
  constructor(private db: Database, private clock: Clock, private audit: AuditLog) {}

  list(): Publisher[] {
    return this.db.all<Record<string, unknown>>("SELECT * FROM publishers ORDER BY created_at").map(mapPublisher);
  }

  get(id: string): Publisher {
    const r = this.db.get<Record<string, unknown>>("SELECT * FROM publishers WHERE id = ?", id);
    if (!r) throw notFound("Publisher");
    return mapPublisher(r);
  }

  create(input: unknown, actor: AuditActor, opts: { id?: string; isInternal?: boolean; status?: Publisher["status"] } = {}): Publisher {
    const p = PublisherInput.parse(input);
    const id = opts.id ?? newId("pub");
    if (this.db.get("SELECT id FROM publishers WHERE id = ?", id)) throw conflict("This publisher is already registered.");
    const now = this.clock.now().toISOString();
    this.db.run(
      `INSERT INTO publishers (id, product_id, name, domains, app_identifiers, test_origins, owner_subject, administrators, platforms, supported_formats,
        internal_eligible, external_eligible, status, delivery_mode, is_internal, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'test', ?, ?, ?)`,
      id, p.productId, p.name, json.str(p.domains), json.str(p.appIdentifiers), json.str(p.testOrigins), actor.subject,
      json.str(p.administrators), json.str(p.platforms), json.str(p.supportedFormats),
      p.campaignEligibility.internal ? 1 : 0, p.campaignEligibility.external ? 1 : 0,
      opts.status ?? "pending", opts.isInternal ? 1 : 0, now, now,
    );
    this.audit.record(actor, "publisher.register", "publisher", id, `Registered publisher ${p.name} (${opts.status ?? "pending"})`);
    return this.get(id);
  }

  update(id: string, input: unknown, actor: AuditActor): Publisher {
    this.get(id);
    const p = PublisherInput.partial().parse(input);
    const sets: string[] = [];
    const vals: (string | number)[] = [];
    const map: Record<string, [string, (v: unknown) => string | number]> = {
      name: ["name", String], productId: ["product_id", String], domains: ["domains", json.str], appIdentifiers: ["app_identifiers", json.str],
      testOrigins: ["test_origins", json.str], administrators: ["administrators", json.str], platforms: ["platforms", json.str],
      supportedFormats: ["supported_formats", json.str],
    };
    for (const [k, v] of Object.entries(p)) {
      if (k === "campaignEligibility" && v) {
        const e = v as { internal: boolean; external: boolean };
        sets.push("internal_eligible = ?", "external_eligible = ?");
        vals.push(e.internal ? 1 : 0, e.external ? 1 : 0);
      } else if (map[k] && v !== undefined) {
        sets.push(`${map[k][0]} = ?`);
        vals.push(map[k][1](v));
      }
    }
    if (sets.length) {
      this.db.run(`UPDATE publishers SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`, ...vals, this.clock.now().toISOString(), id);
      this.audit.record(actor, "publisher.update", "publisher", id, `Updated ${Object.keys(p).join(", ")}`);
    }
    return this.get(id);
  }

  setStatus(id: string, status: Publisher["status"], actor: AuditActor, note?: string): Publisher {
    const pub = this.get(id);
    this.db.run("UPDATE publishers SET status = ?, updated_at = ? WHERE id = ?", status, this.clock.now().toISOString(), id);
    this.audit.record(actor, `publisher.${status}`, "publisher", id, `${pub.name}: ${pub.status} → ${status}${note ? ` (${note})` : ""}`);
    return this.get(id);
  }

  /** Live delivery to a publisher's real domains requires an explicit founder decision. */
  setDeliveryMode(id: string, mode: "test" | "live", actor: AuditActor & { isFounder: boolean }, confirmation?: string): Publisher {
    const pub = this.get(id);
    if (mode === "live") {
      if (!actor.isFounder) throw new AppError(403, "founder_required", "Only the founder can approve live advertising on a publisher.");
      if (confirmation !== `ENABLE LIVE ${pub.name}`) throw invalid(`Type "ENABLE LIVE ${pub.name}" to confirm live delivery.`);
      if (pub.status !== "active") throw conflict("The publisher must be active first.");
    }
    const now = this.clock.now().toISOString();
    this.db.run("UPDATE publishers SET delivery_mode = ?, live_approved_by = ?, live_approved_at = ?, updated_at = ? WHERE id = ?",
      mode, mode === "live" ? actor.displayName : null, mode === "live" ? now : null, now, id);
    this.audit.record(actor, `publisher.delivery_${mode}`, "publisher", id, `${pub.name}: delivery mode ${pub.deliveryMode} → ${mode}`);
    return this.get(id);
  }

  // ---- Placements -------------------------------------------------------

  placements(publisherId?: string): Placement[] {
    const rows = publisherId
      ? this.db.all<Record<string, unknown>>("SELECT * FROM placements WHERE publisher_id = ? ORDER BY created_at, rowid", publisherId)
      : this.db.all<Record<string, unknown>>("SELECT * FROM placements ORDER BY created_at, rowid");
    return rows.map(mapPlacement);
  }

  placement(id: string): Placement {
    const r = this.db.get<Record<string, unknown>>("SELECT * FROM placements WHERE id = ?", id);
    if (!r) throw notFound("Placement");
    return mapPlacement(r);
  }

  placementByKey(publicKey: string): Placement | null {
    const r = this.db.get<Record<string, unknown>>("SELECT * FROM placements WHERE public_key = ?", publicKey);
    return r ? mapPlacement(r) : null;
  }

  createPlacement(publisherId: string, input: unknown, actor: AuditActor): Placement {
    const pub = this.get(publisherId);
    const p = PlacementInput.parse(input);
    if (this.db.get("SELECT id FROM placements WHERE publisher_id = ? AND slot = ?", publisherId, p.slot)) {
      throw conflict(`${pub.name} already has a placement with slot "${p.slot}".`);
    }
    const id = newId("plc");
    this.db.run(
      `INSERT INTO placements (id, public_key, publisher_id, name, slot, platform, width, height, responsive, formats, max_file_bytes, max_video_seconds,
        allow_animation, internal_eligible, external_eligible, restrictions, fallback, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      id, newPublicKey(), publisherId, p.name, p.slot, p.platform, p.width, p.height, p.responsive, json.str(p.formats), p.maxFileBytes,
      p.maxVideoSeconds, p.allowAnimation ? 1 : 0, p.internalEligible ? 1 : 0, p.externalEligible ? 1 : 0, json.str(p.restrictions),
      p.fallback, this.clock.now().toISOString(),
    );
    this.audit.record(actor, "placement.create", "placement", id, `${pub.name}: ${p.name} (${p.width ?? "responsive"}${p.height ? ` × ${p.height}` : ""})`);
    return this.placement(id);
  }

  updatePlacement(id: string, input: unknown, actor: AuditActor): Placement {
    const current = this.placement(id);
    const merged = PlacementInput.parse({ ...current, ...(input as object) });
    this.db.run(
      `UPDATE placements SET name = ?, platform = ?, width = ?, height = ?, responsive = ?, formats = ?, max_file_bytes = ?, max_video_seconds = ?,
        allow_animation = ?, internal_eligible = ?, external_eligible = ?, restrictions = ?, fallback = ? WHERE id = ?`,
      merged.name, merged.platform, merged.width, merged.height, merged.responsive, json.str(merged.formats), merged.maxFileBytes,
      merged.maxVideoSeconds, merged.allowAnimation ? 1 : 0, merged.internalEligible ? 1 : 0, merged.externalEligible ? 1 : 0,
      json.str(merged.restrictions), merged.fallback, id,
    );
    this.audit.record(actor, "placement.update", "placement", id, `Updated ${current.name}`);
    return this.placement(id);
  }

  setPlacementStatus(id: string, status: "active" | "paused", actor: AuditActor): Placement {
    const p = this.placement(id);
    this.db.run("UPDATE placements SET status = ? WHERE id = ?", status, id);
    this.audit.record(actor, `placement.${status}`, "placement", id, `${p.name}: ${p.status} → ${status}`);
    return this.placement(id);
  }

  /** Registers HCG News as the first internal publisher with its standard placements (idempotent). */
  registerHcgNews(actor: AuditActor, testOrigins: string[]): Publisher {
    const existing = this.db.get("SELECT id FROM publishers WHERE id = ?", HCG_NEWS_PUBLISHER_ID);
    if (!existing) {
      this.create({
        productId: "hcg.news",
        name: "HCG News",
        domains: ["news.hakmicapitalgroup.com"],
        appIdentifiers: ["com.hakmicapitalgroup.hcgnews"],
        testOrigins,
        platforms: ["web", "ios"],
        supportedFormats: ["image", "animated-image", "video", "native"],
        campaignEligibility: { internal: true, external: true },
      }, actor, { id: HCG_NEWS_PUBLISHER_ID, isInternal: true, status: "active" });
    }
    const have = new Set(this.placements(HCG_NEWS_PUBLISHER_ID).map((p) => p.slot));
    for (const p of HCG_NEWS_PLACEMENTS) if (!have.has(p.slot)) this.createPlacement(HCG_NEWS_PUBLISHER_ID, p, actor);
    return this.get(HCG_NEWS_PUBLISHER_ID);
  }
}
