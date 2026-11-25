import { z } from "zod";
import type { Campaign, Creative, CreativeVariant, Placement } from "@hcg-ads/contracts";
import { checkDestinationUrl } from "../core/url-policy.ts";
import { checkCompatibility } from "../placements/compat.ts";
import type { MediaAssetView } from "../media/service.ts";

export const CALLS_TO_ACTION = ["Read more", "Read on HCG News", "Learn more", "Shop now", "Get started", "Sign up", "Download", "Watch now", "Discover", "Contact us"];

const crop = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().gt(0).max(1), height: z.number().gt(0).max(1) })
  .refine((c) => c.x + c.width <= 1.0001 && c.y + c.height <= 1.0001, "The crop must stay inside the image.");

export const VariantInput = z.object({
  id: z.string().optional(),
  device: z.enum(["any", "desktop", "tablet", "mobile"]).default("any"),
  placementId: z.string().nullable().default(null),
  mediaAssetId: z.string().nullable().default(null),
  imageUrl: z.string().nullable().default(null),
  crop: crop.nullable().default(null),
});

export const CreativeInput = z.object({
  type: z.enum(["article-card", "image", "video", "native-text"]),
  headline: z.string().trim().min(1, "A headline is required.").max(120),
  description: z.string().trim().max(300).nullable().default(null),
  callToAction: z.string().trim().min(1).max(30).default("Learn more"),
  destinationUrl: z.string().trim().min(1, "A destination URL is required."),
  variants: z.array(VariantInput).max(20).default([]),
});

export interface ValidationContext {
  campaign: Campaign;
  placements: Placement[];
  media: (id: string) => MediaAssetView | null;
  blockedPhrases: string[];
  allowLocalhost: boolean;
}

function normalise(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ");
}

/** Content checks shared by validation and moderation. Returns problems, never throws. */
export function contentProblems(c: Pick<Creative, "headline" | "description" | "callToAction">, blockedPhrases: string[]): string[] {
  const problems: string[] = [];
  const text = normalise([c.headline, c.description ?? "", c.callToAction].join(" "));
  for (const phrase of blockedPhrases) {
    if (text.includes(normalise(phrase))) problems.push(`"${phrase}" imitates a system or security prompt and is not allowed in advertising.`);
  }
  if (/(<\s*script|javascript:|on\w+\s*=|<\s*iframe)/i.test([c.headline, c.description, c.callToAction].join(" "))) {
    problems.push("Creative text must not contain markup or scripts.");
  }
  const letters = c.headline.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 12 && letters === letters.toUpperCase()) problems.push("Headlines written entirely in capitals read as alarms; use sentence case.");
  if (/[⚠️🚨❗‼]/u.test(c.headline)) problems.push("Warning symbols in headlines can imitate system alerts.");
  return problems;
}

/** Full creative validation against the campaign's placements. */
export function validateCreative(cr: Creative, ctx: ValidationContext): string[] {
  const problems = [...contentProblems(cr, ctx.blockedPhrases)];
  const dest = checkDestinationUrl(cr.destinationUrl, { allowLocalhost: ctx.allowLocalhost });
  problems.push(...dest.problems);

  for (const v of cr.variants) {
    if (v.mediaAssetId) {
      const m = ctx.media(v.mediaAssetId);
      if (!m || m.status === "deleted") { problems.push("A variant uses media that no longer exists."); continue; }
      if (m.status === "rejected") problems.push(`${m.filename} failed media validation: ${m.problems.join(" ")}`);
      if (ctx.campaign.kind === "external" && m.ownerAdvertiserId !== ctx.campaign.advertiserId) problems.push(`${m.filename} belongs to another advertiser.`);
    } else if (v.imageUrl) {
      if (!/^https:\/\//.test(v.imageUrl) && !(ctx.allowLocalhost && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(v.imageUrl))) problems.push("Image URLs must use https://.");
      if (ctx.campaign.kind === "external") problems.push("External campaigns must upload their media for review; linked images are not accepted.");
    }
  }
  if (cr.type !== "native-text" && cr.type !== "article-card" && !cr.variants.some((v) => v.mediaAssetId)) {
    problems.push("Image and video creatives need at least one uploaded media variant.");
  }

  // Every selected placement must be served by at least one variant without distortion.
  for (const p of ctx.placements) {
    if (!placementFits(cr, p, ctx)) {
      problems.push(`No variant of "${cr.headline}" fits ${p.name}${p.width && p.height ? ` (${p.width} × ${p.height})` : ""}.`);
    }
  }
  return [...new Set(problems)];
}

/** The variants of a creative that can render in a placement, best first. */
export function variantsFor(cr: Creative, p: Placement, ctx: Pick<ValidationContext, "media">): CreativeVariant[] {
  return cr.variants.filter((v) => {
    if (v.placementId && v.placementId !== p.id) return false;
    if (v.mediaAssetId) {
      const m = ctx.media(v.mediaAssetId);
      if (!m || m.status === "deleted" || m.status === "rejected") return false;
      if (v.crop && m.metadata.width && m.metadata.height && p.width && p.height && p.responsive !== "responsive-native") {
        // An explicit crop must produce the placement's aspect ratio.
        const w = m.metadata.width * v.crop.width, h = m.metadata.height * v.crop.height;
        return Math.abs(w / h - p.width / p.height) / (p.width / p.height) <= 0.01 && p.formats.includes(m.metadata.kind);
      }
      return checkCompatibility(p, { kind: m.metadata.kind, width: m.metadata.width, height: m.metadata.height, bytes: m.bytes, durationSeconds: m.metadata.durationSeconds, animated: m.metadata.animated }).length === 0;
    }
    // Linked image or text-only: rendered as a native card, which the placement must accept.
    return p.formats.includes("native");
  }).sort((a, b) => Number(!!b.placementId) - Number(!!a.placementId));
}

function placementFits(cr: Creative, p: Placement, ctx: ValidationContext): boolean {
  if (cr.type === "native-text" || cr.type === "article-card") {
    if (p.formats.includes("native")) return true;
  }
  return variantsFor(cr, p, ctx).length > 0;
}
