import { z } from "zod";
import type { Campaign, CampaignHistoryEntry, CampaignState, ContentItem, Creative, Placement } from "@hcg-ads/contracts";
import type { Database } from "../db/database.ts";
import { json } from "../db/database.ts";
import type { Clock } from "../core/clock.ts";
import type { AuditActor, AuditLog } from "../core/audit.ts";
import { SYSTEM_ACTOR } from "../core/audit.ts";
import { AppError, conflict, invalid, notFound } from "../core/errors.ts";
import { newId } from "../core/ids.ts";
import { CreativeInput, validateCreative, type ValidationContext } from "../creatives/validate.ts";
import { HCG_INTERNAL_ADVERTISER_ID, type AdvertiserService } from "../advertisers/service.ts";
import type { PublisherService } from "../publishers/service.ts";
import type { MediaService } from "../media/service.ts";
import type { ContentSourceRegistry } from "../sources/registry.ts";
import type { GovernanceSettings } from "../governance/settings.ts";

export const CampaignInput = z.object({
  name: z.string().trim().min(2).max(140),
  kind: z.enum(["internal", "external"]),
  advertiserId: z.string().optional(),
  objective: z.enum(["awareness", "traffic", "engagement", "announcement"]).default("traffic"),
  priority: z.number().int().min(1).max(10).default(5),
  startAt: z.string().datetime({ offset: true }).nullable().default(null),
  endAt: z.string().datetime({ offset: true }).nullable().default(null),
  publisherIds: z.array(z.string()).default([]),
  placementIds: z.array(z.string()).default([]),
  rotation: z.enum(["even", "weighted", "sequential"]).default("even"),
  impressionLimit: z.number().int().positive().nullable().default(null),
  dailyImpressionLimit: z.number().int().positive().nullable().default(null),
  frequencyLimit: z.object({ count: z.number().int().min(1).max(100), windowHours: z.number().int().min(1).max(720) }).nullable().default(null),
  contextual: z.object({ categories: z.array(z.string()).max(50).default([]), keywords: z.array(z.string().max(40)).max(50).default([]) }).default({ categories: [], keywords: [] }),
  pricing: z.object({
    model: z.enum(["none", "fixed", "cpm", "cpc"]).default("none"),
    budgetMinor: z.number().int().min(0).nullable().default(null),
    rateMinor: z.number().int().min(0).nullable().default(null),
    currency: z.string().length(3).default("NOK"),
  }).default({ model: "none", budgetMinor: null, rateMinor: null, currency: "NOK" }),
  disclosureLabel: z.string().optional(),
}).refine((c) => !c.startAt || !c.endAt || new Date(c.endAt) > new Date(c.startAt), { message: "The end date must be after the start date.", path: ["endAt"] });

/** Allowed lifecycle transitions. */
export const TRANSITIONS: Record<string, { from: CampaignState[]; to: CampaignState | "computed" }> = {
  submit: { from: ["draft", "rejected"], to: "pending_approval" },
  approve: { from: ["pending_approval"], to: "approved" },
  reject: { from: ["pending_approval"], to: "rejected" },
  activate: { from: ["approved", "paused"], to: "computed" },
  pause: { from: ["active", "scheduled"], to: "paused" },
  revise: { from: ["approved", "scheduled", "paused", "rejected", "pending_approval"], to: "draft" },
  complete: { from: ["active", "scheduled", "paused"], to: "completed" },
  archive: { from: ["draft", "rejected", "completed", "paused", "approved"], to: "archived" },
};

export function mapCampaign(r: Record<string, unknown>): Campaign {
  return {
    id: String(r.id),
    name: String(r.name),
    kind: r.kind as Campaign["kind"],
    advertiserId: String(r.advertiser_id),
    objective: r.objective as Campaign["objective"],
    state: r.state as CampaignState,
    stateReason: (r.state_reason as string) ?? null,
    priority: Number(r.priority),
    startAt: (r.start_at as string) ?? null,
    endAt: (r.end_at as string) ?? null,
    publisherIds: json.parse(r.publisher_ids, []),
    placementIds: json.parse(r.placement_ids, []),
    rotation: r.rotation as Campaign["rotation"],
    impressionLimit: (r.impression_limit as number) ?? null,
    dailyImpressionLimit: (r.daily_impression_limit as number) ?? null,
    frequencyLimit: json.parse(r.frequency_limit, null),
    contextual: json.parse(r.contextual, { categories: [], keywords: [] }),
    pricing: json.parse(r.pricing, { model: "none", budgetMinor: null, rateMinor: null, currency: "NOK" }),
    disclosureLabel: String(r.disclosure_label),
    createdBy: String(r.created_by),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export function mapCreative(r: Record<string, unknown>): Creative {
  return {
    id: String(r.id),
    campaignId: String(r.campaign_id),
    type: r.type as Creative["type"],
    headline: String(r.headline),
    description: (r.description as string) ?? null,
    callToAction: String(r.call_to_action),
    destinationUrl: String(r.destination_url),
    contentRef: r.content_source_id && r.content_external_id ? { sourceId: String(r.content_source_id), externalId: String(r.content_external_id) } : null,
    variants: json.parse(r.variants, []),
    moderation: r.moderation as Creative["moderation"],
    moderationNotes: (r.moderation_notes as string) ?? null,
    validationProblems: json.parse(r.validation_problems, []),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export interface CampaignDeps {
  db: Database;
  clock: Clock;
  audit: AuditLog;
  advertisers: AdvertiserService;
  publishers: PublisherService;
  media: MediaService;
  sources: ContentSourceRegistry;
  settings: () => GovernanceSettings;
  allowLocalhost: boolean;
}

/** Campaign Manager, Creative Studio data and Approval & Moderation. */
export class CampaignService {
  constructor(private d: CampaignDeps) {}

  private get db() { return this.d.db; }
  private now() { return this.d.clock.now().toISOString(); }

  // ---- Reads ------------------------------------------------------------

  list(filter: { state?: string; kind?: string; advertiserId?: string } = {}): Array<Campaign & { creatives: Creative[] }> {
    const where: string[] = [];
    const params: string[] = [];
    if (filter.state) { where.push("state = ?"); params.push(filter.state); }
    if (filter.kind) { where.push("kind = ?"); params.push(filter.kind); }
    if (filter.advertiserId) { where.push("advertiser_id = ?"); params.push(filter.advertiserId); }
    return this.db.all<Record<string, unknown>>(`SELECT * FROM campaigns ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY updated_at DESC`, ...params)
      .map((r) => ({ ...mapCampaign(r), creatives: this.creatives(String(r.id)) }));
  }

  get(id: string): Campaign & { creatives: Creative[] } {
    const r = this.db.get<Record<string, unknown>>("SELECT * FROM campaigns WHERE id = ?", id);
    if (!r) throw notFound("Campaign");
    return { ...mapCampaign(r), creatives: this.creatives(id) };
  }

  creatives(campaignId: string): Creative[] {
    return this.db.all<Record<string, unknown>>("SELECT * FROM creatives WHERE campaign_id = ? ORDER BY created_at, rowid", campaignId).map(mapCreative);
  }

  creative(id: string): Creative {
    const r = this.db.get<Record<string, unknown>>("SELECT * FROM creatives WHERE id = ?", id);
    if (!r) throw notFound("Creative");
    return mapCreative(r);
  }

  history(campaignId: string): CampaignHistoryEntry[] {
    return this.db.all<Record<string, unknown>>("SELECT * FROM campaign_history WHERE campaign_id = ? ORDER BY at, rowid", campaignId).map((r) => ({
      id: String(r.id), campaignId: String(r.campaign_id), at: String(r.at), actor: String(r.actor),
      fromState: (r.from_state as CampaignState) ?? null, toState: (r.to_state as CampaignState) ?? null,
      action: String(r.action), note: (r.note as string) ?? null,
    }));
  }

  private record(c: { id: string }, actor: AuditActor, action: string, from: CampaignState | null, to: CampaignState | null, note?: string | null) {
    this.db.run("INSERT INTO campaign_history (id, campaign_id, at, actor, from_state, to_state, action, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      newId("hst"), c.id, this.now(), actor.displayName, from, to, action, note ?? null);
    this.d.audit.record(actor, `campaign.${action}`, "campaign", c.id, `${action}${from && to && from !== to ? `: ${from} → ${to}` : ""}${note ? ` (${note})` : ""}`);
  }

  // ---- Create / edit ------------------------------------------------------

  private validatePlacements(input: { kind: string; placementIds: string[]; publisherIds: string[] }): { placements: Placement[]; publisherIds: string[] } {
    const placements = input.placementIds.map((id) => this.d.publishers.placement(id));
    for (const p of placements) {
      if (input.kind === "internal" && !p.internalEligible) throw invalid(`${p.name} does not accept internal campaigns.`);
      if (input.kind === "external" && !p.externalEligible) throw invalid(`${p.name} does not accept external advertising.`);
    }
    const publisherIds = [...new Set([...input.publisherIds, ...placements.map((p) => p.publisherId)])];
    for (const pid of publisherIds) {
      const pub = this.d.publishers.get(pid);
      if (input.kind === "external" && !pub.campaignEligibility.external) throw invalid(`${pub.name} does not accept external campaigns.`);
      if (input.kind === "internal" && !pub.campaignEligibility.internal) throw invalid(`${pub.name} does not accept internal campaigns.`);
    }
    return { placements, publisherIds };
  }

  create(input: unknown, actor: AuditActor): Campaign & { creatives: Creative[] } {
    const c = CampaignInput.parse(input);
    const advertiserId = c.kind === "internal" ? (c.advertiserId ?? HCG_INTERNAL_ADVERTISER_ID) : c.advertiserId;
    if (!advertiserId) throw invalid("External campaigns need an advertiser.");
    const adv = this.d.advertisers.get(advertiserId);
    if (c.kind === "internal" && adv.kind !== "internal") throw invalid("Internal campaigns must be run by an internal HCG advertiser.");
    if (c.kind === "external" && adv.kind !== "external") throw invalid("External campaigns need an external advertiser.");
    if (c.kind === "internal" && c.pricing.model !== "none") throw invalid("Internal campaigns are not priced.");
    const { publisherIds } = this.validatePlacements(c);
    const labels = this.d.settings().disclosureLabels;
    const label = c.disclosureLabel ?? (c.kind === "internal" ? "Promoted by HCG" : "Sponsored");
    if (!labels.includes(label)) throw invalid(`The disclosure label must be one of: ${labels.join(", ")}.`);
    const id = newId("cmp");
    const now = this.now();
    this.db.run(
      `INSERT INTO campaigns (id, name, kind, advertiser_id, objective, state, priority, start_at, end_at, publisher_ids, placement_ids, rotation,
        impression_limit, daily_impression_limit, frequency_limit, contextual, pricing, disclosure_label, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, c.name, c.kind, advertiserId, c.objective, c.priority, c.startAt, c.endAt, json.str(publisherIds), json.str(c.placementIds),
      c.rotation, c.impressionLimit, c.dailyImpressionLimit, c.frequencyLimit ? json.str(c.frequencyLimit) : null, json.str(c.contextual),
      json.str(c.pricing), label, actor.subject, now, now,
    );
    this.record({ id }, actor, "create", null, "draft", `${c.kind} campaign "${c.name}"`);
    return this.get(id);
  }

  private requireEditable(c: Campaign) {
    if (c.state !== "draft" && c.state !== "rejected") {
      throw new AppError(409, "not_editable", `A ${c.state.replace("_", " ")} campaign cannot be edited. Use "Revise" to return it to draft; it will need approval again.`);
    }
  }

  update(id: string, input: unknown, actor: AuditActor) {
    const cur = this.get(id);
    this.requireEditable(cur);
    const c = CampaignInput.parse({ ...cur, ...(input as object), kind: cur.kind, advertiserId: cur.advertiserId });
    const { publisherIds } = this.validatePlacements(c);
    const labels = this.d.settings().disclosureLabels;
    if (c.disclosureLabel && !labels.includes(c.disclosureLabel)) throw invalid(`The disclosure label must be one of: ${labels.join(", ")}.`);
    if (cur.kind === "internal" && c.pricing.model !== "none") throw invalid("Internal campaigns are not priced.");
    this.db.run(
      `UPDATE campaigns SET name = ?, objective = ?, priority = ?, start_at = ?, end_at = ?, publisher_ids = ?, placement_ids = ?, rotation = ?,
        impression_limit = ?, daily_impression_limit = ?, frequency_limit = ?, contextual = ?, pricing = ?, disclosure_label = ?, updated_at = ? WHERE id = ?`,
      c.name, c.objective, c.priority, c.startAt, c.endAt, json.str(publisherIds), json.str(c.placementIds), c.rotation, c.impressionLimit,
      c.dailyImpressionLimit, c.frequencyLimit ? json.str(c.frequencyLimit) : null, json.str(c.contextual), json.str(c.pricing),
      c.disclosureLabel ?? cur.disclosureLabel, this.now(), id,
    );
    this.d.audit.record(actor, "campaign.update", "campaign", id, `Edited ${c.name}`);
    return this.get(id);
  }

  addCreative(campaignId: string, input: unknown, actor: AuditActor, contentRef?: { sourceId: string; externalId: string }): Creative {
    const c = this.get(campaignId);
    this.requireEditable(c);
    const cr = CreativeInput.parse(input);
    if (c.kind === "external" && cr.type === "article-card") throw invalid("Article cards promote HCG content and are only available to internal campaigns.");
    const id = newId("crv");
    const now = this.now();
    const variants = cr.variants.map((v) => ({ ...v, id: v.id ?? newId("var") }));
    this.db.run(
      `INSERT INTO creatives (id, campaign_id, type, headline, description, call_to_action, destination_url, content_source_id, content_external_id,
        variants, moderation, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      id, campaignId, cr.type, cr.headline, cr.description, cr.callToAction, cr.destinationUrl, contentRef?.sourceId ?? null,
      contentRef?.externalId ?? null, json.str(variants), now, now,
    );
    this.refreshValidation(campaignId);
    this.d.audit.record(actor, "creative.create", "creative", id, `Added ${cr.type} creative "${cr.headline}" to ${c.name}`);
    return this.creative(id);
  }

  updateCreative(creativeId: string, input: unknown, actor: AuditActor): Creative {
    const cur = this.creative(creativeId);
    const c = this.get(cur.campaignId);
    this.requireEditable(c);
    const cr = CreativeInput.parse({ ...cur, ...(input as object) });
    const variants = cr.variants.map((v) => ({ ...v, id: v.id ?? newId("var") }));
    this.db.run(
      "UPDATE creatives SET type = ?, headline = ?, description = ?, call_to_action = ?, destination_url = ?, variants = ?, moderation = 'pending', moderation_notes = NULL, updated_at = ? WHERE id = ?",
      cr.type, cr.headline, cr.description, cr.callToAction, cr.destinationUrl, json.str(variants), this.now(), creativeId,
    );
    this.refreshValidation(cur.campaignId);
    this.d.audit.record(actor, "creative.update", "creative", creativeId, `Edited creative "${cr.headline}"`);
    return this.creative(creativeId);
  }

  removeCreative(creativeId: string, actor: AuditActor) {
    const cur = this.creative(creativeId);
    this.requireEditable(this.get(cur.campaignId));
    this.db.run("DELETE FROM creatives WHERE id = ?", creativeId);
    this.d.audit.record(actor, "creative.delete", "creative", creativeId, `Removed creative "${cur.headline}"`);
  }

  /** Builds an article-card creative from an item's approved metadata. The item itself is never modified. */
  static creativeFromItem(item: ContentItem, overrides: { headline?: string; description?: string | null; callToAction?: string } = {}) {
    if (!item.canonicalUrl) throw invalid("This item has no public URL to promote.");
    return {
      type: "article-card" as const,
      headline: clip(overrides.headline ?? item.headline, 120),
      description: clip(overrides.description !== undefined ? overrides.description : item.description, 300),
      callToAction: overrides.callToAction ?? (item.sourceId === "src_hcg_news" ? "Read on HCG News" : "Learn more"),
      destinationUrl: item.canonicalUrl,
      variants: [{ device: "any" as const, placementId: null, mediaAssetId: null, imageUrl: item.imageUrl, crop: null }],
    };
  }

  /** Creates internal campaigns from one or more content items (one campaign per item, or one with a creative per item). */
  async createFromContent(input: {
    sourceId: string; externalIds: string[]; mode?: "per-item" | "single"; name?: string;
    placementIds: string[]; startAt?: string | null; endAt?: string | null; priority?: number;
    overrides?: Record<string, { headline?: string; description?: string | null; callToAction?: string }>;
  }, actor: AuditActor) {
    if (!input.externalIds.length) throw invalid("Select at least one item.");
    if (input.externalIds.length > 25) throw invalid("Select at most 25 items at a time.");
    const items: ContentItem[] = [];
    for (const id of input.externalIds) items.push(await this.d.sources.fetchItem(input.sourceId, id));
    const demo = items.filter((i) => i.isDemo);
    if (demo.length) throw invalid(`Demo content cannot be promoted: ${demo.map((i) => i.headline).join(", ")}`);
    const base = { kind: "internal", placementIds: input.placementIds, startAt: input.startAt ?? null, endAt: input.endAt ?? null, priority: input.priority ?? 5, objective: "traffic" };
    const created: Array<Campaign & { creatives: Creative[] }> = [];
    if ((input.mode ?? "per-item") === "single") {
      const c = this.create({ ...base, name: input.name ?? `Promotion: ${items.length} articles` }, actor);
      for (const it of items) this.addCreative(c.id, CampaignService.creativeFromItem(it, input.overrides?.[it.externalId]), actor, { sourceId: it.sourceId, externalId: it.externalId });
      created.push(this.get(c.id));
    } else {
      for (const it of items) {
        const c = this.create({ ...base, name: input.name && items.length === 1 ? input.name : `Promote: ${it.headline}`.slice(0, 140), contextual: { categories: [], keywords: [] } }, actor);
        this.addCreative(c.id, CampaignService.creativeFromItem(it, input.overrides?.[it.externalId]), actor, { sourceId: it.sourceId, externalId: it.externalId });
        created.push(this.get(c.id));
      }
    }
    return created;
  }

  // ---- Validation ---------------------------------------------------------

  validationContext(c: Campaign): ValidationContext {
    return {
      campaign: c,
      placements: c.placementIds.map((id) => this.d.publishers.placement(id)),
      media: (id) => { try { return this.d.media.get(id); } catch { return null; } },
      blockedPhrases: this.d.settings().blockedPhrases,
      allowLocalhost: this.d.allowLocalhost,
    };
  }

  refreshValidation(campaignId: string): string[] {
    const c = this.get(campaignId);
    const ctx = this.validationContext(c);
    const all: string[] = [];
    for (const cr of c.creatives) {
      const problems = validateCreative(cr, ctx);
      this.db.run("UPDATE creatives SET validation_problems = ? WHERE id = ?", json.str(problems), cr.id);
      all.push(...problems);
    }
    return all;
  }

  /** Everything that blocks submission or approval, as plain sentences. */
  readiness(campaignId: string): string[] {
    const c = this.get(campaignId);
    const problems = [...this.refreshValidation(campaignId)];
    if (!c.creatives.length) problems.push("Add at least one creative.");
    if (!c.placementIds.length) problems.push("Select at least one placement.");
    const adv = this.d.advertisers.get(c.advertiserId);
    if (adv.status !== "approved") problems.push(`The advertiser ${adv.name} is not approved.`);
    for (const pid of c.publisherIds) {
      const pub = this.d.publishers.get(pid);
      if (pub.status !== "active") problems.push(`The publisher ${pub.name} is ${pub.status}.`);
    }
    if (c.endAt && new Date(c.endAt) <= this.d.clock.now()) problems.push("The end date has already passed.");
    if (c.kind === "external" && c.pricing.model === "none") problems.push("External campaigns need a pricing model (test mode until HCG Payments is connected).");
    for (const cr of c.creatives) {
      if (cr.contentRef) {
        const cached = this.d.sources.cached(cr.contentRef.sourceId, cr.contentRef.externalId);
        if (cached?.status === "unavailable") problems.push(`The promoted item "${cr.headline}" is no longer published at its source.`);
      }
    }
    return [...new Set(problems)];
  }

  // ---- Lifecycle ----------------------------------------------------------

  private transition(id: string, action: keyof typeof TRANSITIONS, to: CampaignState, actor: AuditActor, note?: string | null, reason: string | null = null) {
    const c = this.get(id);
    const t = TRANSITIONS[action];
    if (!t.from.includes(c.state)) throw new AppError(409, "invalid_transition", `Cannot ${action} a campaign that is ${c.state.replace("_", " ")}.`);
    this.db.run("UPDATE campaigns SET state = ?, state_reason = ?, updated_at = ? WHERE id = ?", to, reason, this.now(), id);
    this.record(c, actor, action, c.state, to, note);
    return this.get(id);
  }

  submit(id: string, actor: AuditActor) {
    const problems = this.readiness(id);
    if (problems.length) throw new AppError(422, "not_ready", "The campaign is not ready for approval.", problems);
    return this.transition(id, "submit", "pending_approval", actor);
  }

  /** Approval re-checks the source content and copies approved media into the public namespace. */
  async approve(id: string, actor: AuditActor, note?: string) {
    const c = this.get(id);
    if (c.state !== "pending_approval") throw new AppError(409, "invalid_transition", `Cannot approve a campaign that is ${c.state.replace("_", " ")}.`);
    if (c.createdBy === actor.subject && c.kind === "external") {
      throw new AppError(403, "four_eyes", "External campaigns must be approved by someone other than their creator.");
    }
    for (const cr of c.creatives) {
      if (cr.contentRef) await this.d.sources.fetchItem(cr.contentRef.sourceId, cr.contentRef.externalId);
    }
    const problems = this.readiness(id);
    if (problems.length) throw new AppError(422, "not_ready", "The campaign cannot be approved yet.", problems);
    for (const cr of c.creatives) {
      for (const v of cr.variants) if (v.mediaAssetId) await this.d.media.approve(v.mediaAssetId, actor);
      this.db.run("UPDATE creatives SET moderation = 'approved', moderation_notes = ? WHERE id = ?", note ?? null, cr.id);
    }
    return this.transition(id, "approve", "approved", actor, note);
  }

  reject(id: string, actor: AuditActor, note: string) {
    if (!note?.trim()) throw invalid("Explain why the campaign is rejected.");
    const c = this.get(id);
    for (const cr of c.creatives) this.db.run("UPDATE creatives SET moderation = 'rejected', moderation_notes = ? WHERE id = ?", note, cr.id);
    return this.transition(id, "reject", "rejected", actor, note);
  }

  /** Manual activation. Becomes "scheduled" when the start date is in the future. */
  activate(id: string, actor: AuditActor) {
    const c = this.get(id);
    if (c.state === "paused" && c.stateReason === "source_unavailable") {
      const gone = c.creatives.filter((cr) => cr.contentRef && this.d.sources.cached(cr.contentRef.sourceId, cr.contentRef.externalId)?.status === "unavailable");
      if (gone.length) throw new AppError(409, "source_unavailable", "The promoted content is still unavailable at its source. Synchronise the source first.");
    }
    if (c.state === "paused" && c.creatives.some((cr) => cr.moderation !== "approved")) {
      throw new AppError(409, "needs_approval", "This campaign changed after approval and must be approved again.");
    }
    for (const pid of c.publisherIds) {
      const pub = this.d.publishers.get(pid);
      if (pub.status !== "active") throw new AppError(409, "publisher_inactive", `${pub.name} is ${pub.status}.`);
    }
    const now = this.d.clock.now();
    if (c.endAt && new Date(c.endAt) <= now) throw new AppError(409, "ended", "The campaign's end date has passed.");
    const to: CampaignState = c.startAt && new Date(c.startAt) > now ? "scheduled" : "active";
    return this.transition(id, "activate", to, actor, to === "scheduled" ? `starts ${c.startAt}` : null);
  }

  pause(id: string, actor: AuditActor, reason = "manual", note?: string) {
    return this.transition(id, "pause", "paused", actor, note ?? (reason !== "manual" ? reason : null), reason);
  }

  revise(id: string, actor: AuditActor) {
    const c = this.get(id);
    const out = this.transition(id, "revise", "draft", actor, "returned to draft; approval required again");
    for (const cr of c.creatives) this.db.run("UPDATE creatives SET moderation = 'pending' WHERE id = ?", cr.id);
    return out;
  }

  archive(id: string, actor: AuditActor) {
    return this.transition(id, "archive", "archived", actor);
  }

  duplicate(id: string, actor: AuditActor) {
    const c = this.get(id);
    const copy = this.create({
      ...c, name: `${c.name} (copy)`.slice(0, 140), startAt: null, endAt: null,
      advertiserId: c.advertiserId, disclosureLabel: c.disclosureLabel,
    }, actor);
    for (const cr of c.creatives) {
      this.addCreative(copy.id, { ...cr, variants: cr.variants.map(({ id: _id, ...v }) => v) }, actor, cr.contentRef ?? undefined);
    }
    this.record(copy, actor, "duplicate", null, "draft", `copied from ${c.id}`);
    return this.get(copy.id);
  }

  /** Suspends campaigns that promote an item its source no longer publishes. */
  suspendForContent(sourceId: string, externalId: string, reason: string): string[] {
    const rows = this.db.all<{ campaign_id: string }>(
      "SELECT DISTINCT campaign_id FROM creatives WHERE content_source_id = ? AND content_external_id = ?", sourceId, externalId);
    const out: string[] = [];
    for (const { campaign_id } of rows) {
      const c = this.get(campaign_id);
      if (c.state === "active" || c.state === "scheduled") {
        this.pause(c.id, SYSTEM_ACTOR, "source_unavailable", `the promoted item is ${reason} at its source`);
        out.push(c.id);
      }
    }
    return out;
  }

  /** Scheduler tick: scheduled → active at start; active → completed at end or when the impression limit is reached. */
  tick(): Array<{ id: string; to: CampaignState }> {
    const now = this.d.clock.now();
    const changes: Array<{ id: string; to: CampaignState }> = [];
    for (const c of this.list().filter((x) => x.state === "scheduled" || x.state === "active")) {
      if (c.endAt && new Date(c.endAt) <= now) {
        this.transition(c.id, "complete", "completed", SYSTEM_ACTOR, "end date reached");
        changes.push({ id: c.id, to: "completed" });
      } else if (c.impressionLimit && this.impressions(c.id) >= c.impressionLimit) {
        this.transition(c.id, "complete", "completed", SYSTEM_ACTOR, "impression limit reached");
        changes.push({ id: c.id, to: "completed" });
      } else if (c.state === "scheduled" && (!c.startAt || new Date(c.startAt) <= now)) {
        this.db.run("UPDATE campaigns SET state = 'active', updated_at = ? WHERE id = ?", this.now(), c.id);
        this.record(c, SYSTEM_ACTOR, "start", "scheduled", "active", "start date reached");
        changes.push({ id: c.id, to: "active" });
      }
    }
    return changes;
  }

  impressions(campaignId: string, day?: string): number {
    return this.db.get<{ n: number }>(
      `SELECT COUNT(*) n FROM events WHERE campaign_id = ? AND type = 'impression' AND simulated = 0 AND invalid_reason IS NULL ${day ? "AND day = ?" : ""}`,
      ...(day ? [campaignId, day] : [campaignId]),
    )?.n ?? 0;
  }
}

export { conflict };

/** Shortens text at a word boundary with an ellipsis; never cuts a word in half. */
export function clip<T extends string | null | undefined>(text: T, max: number): T {
  if (text == null || text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return ((space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.\-–—]+$/, "") + "…") as T;
}
