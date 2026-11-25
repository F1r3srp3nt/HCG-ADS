import type { ContentItem, ContentPage } from "@hcg-ads/contracts";
import type { BrowseOptions, ContentSourceAdapter, ItemLookup } from "./adapter.ts";

/**
 * HCG Store content source (products).
 *
 * Reads HCG Store's PUBLIC catalogue (`catalogue/products.json`, schema in the Store's
 * docs/CATALOGUE.md). Only listed products become items: a product is listed unless its
 * `visibility` is `draft`. Drafts — products HCG has named but not described, e.g.
 * "HCG Representation" — are never listed, searched, linked or promoted, exactly as the
 * Store treats them. Nothing is invented: no prices, ratings, download counts or release
 * claims; only the catalogue's own name, summary, description, artwork and status.
 * Products are never modified.
 */
export interface HcgStoreSourceConfig {
  /** HTTPS URL of the Store's public catalogue JSON, on an HCG host. Not published by the Store yet. */
  catalogueUrl: string | null;
  /** Public Store origin used for product pages and artwork. */
  siteUrl?: string;
}

const HCG_HOST = /^(?:[a-z0-9-]+\.)*hakmicapitalgroup\.com$/i;
const CACHE_MS = 5 * 60_000;

export function validateStoreUrl(raw: string | null | undefined, what: string): { url: URL | null; problem: string | null } {
  if (!raw) return { url: null, problem: `${what} is not configured.` };
  let url: URL;
  try { url = new URL(raw); } catch { return { url: null, problem: `${what} is not a valid URL.` }; }
  if (url.protocol !== "https:") return { url: null, problem: `${what} must use https://.` };
  if (!HCG_HOST.test(url.hostname) || url.username || url.password) return { url: null, problem: `${what} must be on an HCG host (*.hakmicapitalgroup.com).` };
  return { url, problem: null };
}

interface StoreArtwork { src?: string; alt?: string; width?: number; height?: number }
interface StoreProduct {
  id?: string; slug?: string; name?: string; summary?: string; description?: unknown;
  category?: string; developmentStatus?: string; visibility?: string; tags?: unknown;
  platforms?: Array<{ platform?: string }>; currentReleaseId?: string | null;
  registry?: { centralId?: string | null }; artwork?: { cover?: StoreArtwork; icon?: StoreArtwork };
}

const titleCase = (s: string) => s.split(/[-_\s]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

export class HcgStoreAdapter implements ContentSourceAdapter {
  readonly kind = "hcg-store" as const;
  readonly name = "HCG Store";
  readonly description = "Listed products from store.hakmicapitalgroup.com (read-only; drafts are never shown).";
  readonly configured: boolean;
  readonly configurationProblems: string[];
  private catalogueUrl: URL | null;
  private site: URL;
  private cache: { at: number; products: StoreProduct[] } | null = null;

  constructor(config: HcgStoreSourceConfig | null, private fetchImpl: typeof fetch = fetch, private now: () => number = Date.now) {
    const problems: string[] = [];
    const cat = validateStoreUrl(config?.catalogueUrl, "The HCG Store catalogue URL");
    if (cat.problem) problems.push(cat.problem + (config?.catalogueUrl ? "" : " HCG Store has not published its catalogue at a public URL yet."));
    const site = validateStoreUrl(config?.siteUrl ?? "https://store.hakmicapitalgroup.com", "The HCG Store site URL");
    if (site.problem) problems.push(site.problem);
    this.catalogueUrl = cat.url;
    this.site = site.url ?? new URL("https://store.hakmicapitalgroup.com");
    this.configurationProblems = problems;
    this.configured = problems.length === 0;
  }

  private async load(force = false): Promise<StoreProduct[]> {
    if (!this.catalogueUrl) throw new Error("HCG Store catalogue is not configured.");
    if (!force && this.cache && this.now() - this.cache.at < CACHE_MS) return this.cache.products;
    const res = await this.fetchImpl(this.catalogueUrl, { headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HCG Store answered HTTP ${res.status}.`);
    const doc = (await res.json()) as { products?: unknown };
    if (!doc || !Array.isArray(doc.products)) throw new Error("HCG Store returned an unexpected catalogue.");
    this.cache = { at: this.now(), products: doc.products as StoreProduct[] };
    return this.cache.products;
  }

  static isListed(p: StoreProduct): boolean {
    return (p.visibility ?? "listed") === "listed" && typeof p.id === "string" && typeof p.name === "string" && !!p.name.trim();
  }

  async verify() {
    try {
      const listed = (await this.load(true)).filter(HcgStoreAdapter.isListed);
      return listed.length
        ? { ok: true, message: `Connected to HCG Store. ${listed.length} listed products are readable.` }
        : { ok: false, message: "HCG Store answered, but no listed products are readable." };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async categories() {
    const cats = new Set((await this.load()).filter(HcgStoreAdapter.isListed).map((p) => p.category).filter((c): c is string => !!c));
    return [...cats].sort().map((c) => ({ id: c, name: titleCase(c), slug: c }));
  }

  async browse(sourceId: string, o: BrowseOptions): Promise<ContentPage> {
    const limit = Math.min(Math.max(o.limit ?? 20, 1), 50);
    const offset = o.cursor ? Number.parseInt(o.cursor, 10) || 0 : 0;
    const q = o.query?.trim().toLowerCase();
    const items = (await this.load())
      .filter(HcgStoreAdapter.isListed)
      .filter((p) => !o.category || p.category === o.category)
      .filter((p) => !q || `${p.name} ${p.summary ?? ""}`.toLowerCase().includes(q))
      .map((p) => this.map(sourceId, p))
      .filter((i): i is ContentItem => !!i)
      .sort((a, b) => a.headline.localeCompare(b.headline));
    return { items: items.slice(offset, offset + limit), nextCursor: items.length > offset + limit ? String(offset + limit) : null };
  }

  async lookup(sourceId: string, externalId: string): Promise<ItemLookup> {
    try {
      const p = (await this.load(true)).find((x) => x.id === externalId);
      if (!p) return { found: false, reason: "not_found" };
      if (!HcgStoreAdapter.isListed(p)) return { found: false, reason: "unpublished" };
      const item = this.map(sourceId, p);
      return item ? { found: true, item } : { found: false, reason: "unpublished" };
    } catch (e) {
      return { found: false, reason: "source_error", message: (e as Error).message };
    }
  }

  private asset(src: string | undefined): string | null {
    if (!src || /^[a-z]+:/i.test(src) && !src.startsWith("https://")) return null;
    try {
      const u = new URL(src, this.site.origin + "/");
      return u.protocol === "https:" && HCG_HOST.test(u.hostname) ? u.toString() : null;
    } catch {
      return null;
    }
  }

  map(sourceId: string, p: StoreProduct): ContentItem | null {
    if (!HcgStoreAdapter.isListed(p)) return null;
    const slug = p.slug || p.id!;
    const cover = p.artwork?.cover ?? p.artwork?.icon;
    const description = typeof p.summary === "string" && p.summary.trim()
      ? p.summary.trim()
      : Array.isArray(p.description) && typeof p.description[0] === "string" ? (p.description[0] as string).trim() : null;
    return {
      externalId: p.id!,
      sourceId,
      kind: "product",
      headline: p.name!.trim(),
      description,
      imageUrl: this.asset(cover?.src),
      imageAlt: cover?.alt || null,
      canonicalUrl: new URL(`/apps/${encodeURIComponent(slug)}`, this.site.origin).toString(),
      category: p.category ? { id: p.category, name: titleCase(p.category), slug: p.category } : null,
      contentType: "product",
      publishedAt: null,
      updatedAt: null,
      status: "published",
      isDemo: false,
      promotional: {
        developmentStatus: p.developmentStatus ?? null,
        releaseAvailable: !!p.currentReleaseId,
        platforms: Array.isArray(p.platforms) ? p.platforms.map((x) => x.platform).filter(Boolean).join(", ") || null : null,
        centralProductId: p.registry?.centralId ?? null,
      },
    };
  }
}
