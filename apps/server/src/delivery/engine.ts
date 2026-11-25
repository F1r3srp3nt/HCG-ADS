import { randomBytes, randomInt } from "node:crypto";
import {
  CONTRACT_VERSION, type Campaign, type Creative, type CreativeVariant, type DeliveryRequest, type DeliveryResponse,
  type EventType, type Placement, type Publisher, type RenderableAd,
} from "@hcg-ads/contracts";
import type { Database } from "../db/database.ts";
import type { Clock } from "../core/clock.ts";
import { dayOf } from "../core/clock.ts";
import { newId } from "../core/ids.ts";
import type { Signer } from "../core/signing.ts";
import type { CampaignService } from "../campaigns/service.ts";
import type { PublisherService } from "../publishers/service.ts";
import type { MediaService } from "../media/service.ts";
import type { AdvertiserService } from "../advertisers/service.ts";
import type { SettingsService } from "../governance/settings.ts";
import { variantsFor } from "../creatives/validate.ts";
import { checkDestinationUrl } from "../core/url-policy.ts";

export interface RequestOrigin {
  /** Browser Origin (or Referer origin) for web placements. */
  origin: string | null;
  /** Application identifier for native placements (X-HCG-App-Id). */
  appId: string | null;
}

interface DeliveryClaims {
  n: string;   // nonce = delivery id
  c: string;   // campaign
  r: string;   // creative
  p: string;   // placement
  u: string;   // publisher
  t: number;   // issued at (ms)
  pv?: 1;      // preview: never counted
}

export interface PreviewClaims { kind: "preview"; campaignId: string; creativeId?: string; exp: number }

const BOT = /(bot|crawler|spider|slurp|headless|phantom|lighthouse|preview|facebookexternalhit|curl|wget|python-requests|httpclient)/i;
export const IMPRESSION_TTL_MS = 60 * 60 * 1000;
export const CLICK_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Ad Delivery Engine.
 *
 * Contextual by default: decisions use the placement, the page context the
 * publisher sends (category, keywords) and campaign rules. No cookies, no
 * device identifiers, no cross-site profiles, no IP addresses are stored.
 * Frequency limits are enforced by the SDK on the device (when storage
 * consent is given), which only sends the ids of campaigns it has capped.
 */
export class DeliveryEngine {
  constructor(
    private db: Database,
    private clock: Clock,
    private signer: Signer,
    private previewSigner: Signer,
    private campaigns: CampaignService,
    private publishers: PublisherService,
    private media: MediaService,
    private advertisers: AdvertiserService,
    private settings: SettingsService,
    private baseUrl: string,
    private allowLocalhost: boolean,
  ) {}

  previewToken(campaignId: string, creativeId?: string): string {
    return this.previewSigner.sign({ kind: "preview", campaignId, creativeId, exp: this.clock.now().getTime() + 15 * 60_000 });
  }

  /** Is this request allowed to receive ads for this publisher? */
  authorize(pub: Publisher, placement: Placement, from: RequestOrigin): string | null {
    if (placement.platform === "web") {
      if (!from.origin) return "missing_origin";
      let host: string, origin: string;
      try { const u = new URL(from.origin); host = u.hostname.toLowerCase(); origin = u.origin; } catch { return "bad_origin"; }
      if (pub.deliveryMode === "test") return pub.testOrigins.includes(origin) ? null : "origin_not_registered_for_test";
      const ok = pub.domains.some((d) => host === d || host === `www.${d}`) && origin.startsWith("https://");
      return ok ? null : "origin_not_registered";
    }
    if (!from.appId || !pub.appIdentifiers.includes(from.appId)) return "app_not_registered";
    if (pub.deliveryMode === "test" && !pub.testOrigins.includes(`app://${from.appId}`)) return "app_not_registered_for_test";
    return null;
  }

  async request(req: DeliveryRequest, from: RequestOrigin): Promise<DeliveryResponse> {
    const empty = (placement: Placement | null, reason: string): DeliveryResponse => ({
      contractVersion: CONTRACT_VERSION,
      placement: placement ? { id: placement.publicKey, width: placement.width, height: placement.height, responsive: placement.responsive, fallback: placement.fallback } : null,
      ad: null,
      reason,
    });
    const placement = typeof req.placement === "string" ? this.publishers.placementByKey(req.placement) : null;
    if (!placement) return empty(null, "unknown_placement");

    // Preview: an administrator's signed, short-lived token. Never counted, never needs activation.
    if (req.preview) {
      const claims = this.previewSigner.verify<PreviewClaims>(req.preview);
      if (!claims || claims.kind !== "preview" || claims.exp < this.clock.now().getTime()) return empty(placement, "invalid_preview");
      const c = this.campaigns.get(claims.campaignId);
      const pick = this.pickCreative(c, placement, req, claims.creativeId);
      if (!pick) return empty(placement, "no_compatible_creative");
      return { contractVersion: CONTRACT_VERSION, placement: empty(placement, "").placement, ad: this.render(c, pick.creative, pick.variant, placement, req, true) };
    }

    const settings = this.settings.get();
    if (settings.emergencyShutdown.active) return empty(placement, "emergency_shutdown");
    const pub = this.publishers.get(placement.publisherId);
    if (pub.status !== "active") return empty(placement, "publisher_inactive");
    if (placement.status !== "active") return empty(placement, "placement_paused");
    const denied = this.authorize(pub, placement, from);
    if (denied) return empty(placement, denied);

    this.count(placement.id, "", "requests");
    this.campaigns.tick();
    const now = this.clock.now();
    const today = dayOf(now);
    const exclude = new Set(Array.isArray(req.exclude) ? req.exclude.slice(0, 100) : []);
    const category = req.context?.category?.toLowerCase() ?? null;
    const restrictions = placement.restrictions;
    if (restrictions.allowedCategories.length && (!category || !restrictions.allowedCategories.map((s) => s.toLowerCase()).includes(category))) {
      return empty(placement, "context_not_allowed");
    }

    const candidates: Array<{ c: Campaign & { creatives: Creative[] }; pick: { creative: Creative; variant: CreativeVariant | null } }> = [];
    for (const c of this.campaigns.list({ state: "active" })) {
      if (!c.placementIds.includes(placement.id) || exclude.has(c.id)) continue;
      if (c.startAt && new Date(c.startAt) > now) continue;
      if (c.endAt && new Date(c.endAt) <= now) continue;
      if (c.kind === "internal" ? !placement.internalEligible : !placement.externalEligible) continue;
      if (c.kind === "external" && !pub.campaignEligibility.external) continue;
      if (this.advertisers.get(c.advertiserId).status !== "approved") continue;
      const cats = c.contextual.categories.map((s) => s.toLowerCase());
      if (cats.length && (!category || !cats.includes(category))) continue;
      if (restrictions.blockedCategories.some((b) => cats.includes(b.toLowerCase()) || b.toLowerCase() === category) && c.kind === "external") continue;
      if (c.impressionLimit && this.campaigns.impressions(c.id) >= c.impressionLimit) continue;
      if (c.dailyImpressionLimit && this.campaigns.impressions(c.id, today) >= c.dailyImpressionLimit) continue;
      const pick = this.pickCreative(c, placement, req);
      if (pick) candidates.push({ c, pick });
    }
    if (!candidates.length) return empty(placement, "no_eligible_campaign");

    // Highest priority wins; equal priorities rotate (weighted by priority when asked).
    const top = Math.max(...candidates.map((x) => x.c.priority));
    const tier = candidates.filter((x) => x.c.priority === top);
    const chosen = tier[randomInt(tier.length)];
    this.count(placement.id, chosen.c.id, "filled");
    return {
      contractVersion: CONTRACT_VERSION,
      placement: { id: placement.publicKey, width: placement.width, height: placement.height, responsive: placement.responsive, fallback: placement.fallback },
      ad: this.render(chosen.c, chosen.pick.creative, chosen.pick.variant, placement, req, false),
    };
  }

  private pickCreative(c: Campaign & { creatives: Creative[] }, p: Placement, req: DeliveryRequest, onlyCreative?: string): { creative: Creative; variant: CreativeVariant | null } | null {
    const ctx = { media: (id: string) => { try { return this.media.get(id); } catch { return null; } } };
    const device = req.device ?? "any";
    const options: Array<{ creative: Creative; variant: CreativeVariant | null }> = [];
    for (const cr of c.creatives) {
      if (onlyCreative && cr.id !== onlyCreative) continue;
      if (!req.preview && cr.moderation !== "approved") continue;
      const variants = variantsFor(cr, p, ctx).filter((v) => v.device === "any" || device === "any" || v.device === device);
      if (variants.length) {
        // Prefer the variant built for this device, then placement-specific variants.
        const best = variants.find((v) => v.device === device && device !== "any") ?? variants[0];
        options.push({ creative: cr, variant: best });
      } else if ((cr.type === "article-card" || cr.type === "native-text") && p.formats.includes("native")) {
        options.push({ creative: cr, variant: null });
      }
    }
    if (!options.length) return null;
    if (c.rotation === "sequential") return options[this.campaigns.impressions(c.id) % options.length];
    return options[randomInt(options.length)];
  }

  private render(c: Campaign, cr: Creative, v: CreativeVariant | null, p: Placement, req: DeliveryRequest, preview: boolean): RenderableAd {
    const nonce = randomBytes(12).toString("base64url");
    const claims: DeliveryClaims = { n: nonce, c: c.id, r: cr.id, p: p.id, u: p.publisherId, t: this.clock.now().getTime(), ...(preview ? { pv: 1 as const } : {}) };
    const token = this.signer.sign(claims as unknown as Record<string, unknown>);
    let media: RenderableAd["media"] = null;
    if (v?.mediaAssetId) {
      const asset = this.media.get(v.mediaAssetId);
      const pub = this.media.publicUrlFor(v.mediaAssetId);
      const url = pub?.url ?? (preview ? asset.previewUrl : null);
      if (url) {
        media = {
          kind: asset.metadata.kind, url, width: asset.metadata.width, height: asset.metadata.height, mime: asset.metadata.mime,
          posterUrl: pub?.posterUrl ?? (preview ? asset.thumbnailUrl : null), crop: v.crop, alt: cr.headline,
        };
      }
    } else if (v?.imageUrl) {
      media = { kind: "image", url: v.imageUrl, width: null, height: null, mime: null, posterUrl: null, crop: v.crop, alt: cr.headline };
    }
    const adv = this.advertisers.get(c.advertiserId);
    const beacon = (t: string) => `${this.baseUrl}/delivery/v1/events/${token}/${t}`;
    let displayUrl = cr.destinationUrl;
    try { displayUrl = new URL(cr.destinationUrl).hostname; } catch { /* keep */ }
    return {
      deliveryId: nonce,
      campaignId: c.id,
      creativeId: cr.id,
      type: cr.type,
      headline: cr.headline,
      description: cr.description,
      callToAction: cr.callToAction,
      clickUrl: `${this.baseUrl}/delivery/v1/click/${token}`,
      displayUrl,
      disclosure: c.disclosureLabel,
      sponsorName: adv.name,
      media,
      frequency: c.frequencyLimit,
      beacons: { impression: beacon("impression"), viewable: beacon("viewable"), video: beacon("video") },
      preview,
    };
    void req;
  }

  private count(placementId: string, campaignId: string, field: "requests" | "filled", simulated = 0) {
    this.db.run(
      `INSERT INTO delivery_counters (day, placement_id, campaign_id, simulated, ${field}) VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(day, placement_id, campaign_id, simulated) DO UPDATE SET ${field} = ${field} + 1`,
      dayOf(this.clock.now()), placementId, campaignId, simulated,
    );
  }

  /**
   * Records one event for a delivery. The (delivery, type) pair is unique, so
   * retries, reloads and double-fired beacons are never double counted.
   * Invalid traffic is kept apart (counted as invalid, excluded from metrics).
   */
  recordEvent(token: string, type: EventType, signals: { userAgent?: string | null } = {}): { counted: boolean; reason?: string; claims?: DeliveryClaims } {
    const claims = this.signer.verify<DeliveryClaims>(token);
    if (!claims || !claims.n) return { counted: false, reason: "invalid_token" };
    if (claims.pv) return { counted: false, reason: "preview", claims };
    const now = this.clock.now();
    const age = now.getTime() - claims.t;
    let invalid: string | null = null;
    if (age > (type === "click" ? CLICK_TTL_MS : IMPRESSION_TTL_MS)) invalid = "expired";
    else if (age < 0) invalid = "clock";
    else if (signals.userAgent && BOT.test(signals.userAgent)) invalid = "automated_agent";
    else if (type !== "impression" && type !== "error") {
      const imp = this.db.get("SELECT 1 FROM events WHERE delivery_id = ? AND type = 'impression' AND invalid_reason IS NULL", claims.n);
      if (!imp) invalid = `${type}_without_impression`;
      else if (type === "click" && age < 300) invalid = "click_too_fast";
    }
    const r = this.db.run(
      `INSERT OR IGNORE INTO events (id, delivery_id, type, campaign_id, creative_id, placement_id, publisher_id, at, day, simulated, invalid_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      newId("evt"), claims.n, type, claims.c, claims.r, claims.p, claims.u, now.toISOString(), dayOf(now), invalid,
    );
    if (r.changes === 0) return { counted: false, reason: "duplicate", claims };
    return invalid ? { counted: false, reason: invalid, claims } : { counted: true, claims };
  }

  /** Destination for a click token; always re-validated. */
  destinationFor(claims: { r: string } | undefined | null): string | null {
    if (!claims) return null;
    try {
      const cr = this.campaigns.creative(claims.r);
      return checkDestinationUrl(cr.destinationUrl, { allowLocalhost: this.allowLocalhost }).ok ? cr.destinationUrl : null;
    } catch {
      return null;
    }
  }

  verifyToken(token: string): DeliveryClaims | null {
    return this.signer.verify<DeliveryClaims>(token);
  }
}
