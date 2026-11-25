import type { ContentItem, ContentPage } from "@hcg-ads/contracts";
import type { HcgNewsConfig } from "../config.ts";
import type { BrowseOptions, ContentSourceAdapter, ItemLookup } from "./adapter.ts";

/**
 * HCG News content source.
 *
 * Reads the publication exactly the way the HCG News website and iOS app do:
 * the `news_articles` / `news_categories` tables of the shared HCG project,
 * through PostgREST, as the anonymous role with the public client key, under
 * row-level security. Only published rows whose publication time has passed
 * and only reader-facing columns are requested (never `created_by`, SEO
 * fields or view counts). Articles are never written.
 */
export class HcgNewsAdapter implements ContentSourceAdapter {
  readonly kind = "hcg-news" as const;
  readonly name = "HCG News";
  readonly description = "Published articles from news.hakmicapitalgroup.com (read-only).";
  readonly configured: boolean;

  static readonly columns = [
    "id", "title", "subtitle", "slug", "excerpt", "status", "content_type", "published_at", "updated_at",
    "featured_image_url", "featured_image_alt", "is_featured", "is_breaking", "is_demo", "reading_time", "tags",
    "category:news_categories(id,name,slug)",
  ].join(",");

  private categoryCache: { at: number; value: Array<{ id: string; name: string; slug: string }> } | null = null;

  constructor(
    private config: HcgNewsConfig | null,
    readonly configurationProblems: string[],
    private fetchImpl: typeof fetch = fetch,
    private now: () => Date = () => new Date(),
  ) {
    this.configured = !!config;
  }

  private async rest(path: string, params: Record<string, string>): Promise<unknown[]> {
    if (!this.config) throw new Error("HCG News is not configured.");
    const url = new URL(`${this.config.projectURL.replace(/\/$/, "")}/rest/v1/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.append(k, v);
    const res = await this.fetchImpl(url, {
      headers: {
        apikey: this.config.publicClientKey,
        authorization: `Bearer ${this.config.publicClientKey}`,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HCG News answered HTTP ${res.status}.`);
    const body = await res.json();
    if (!Array.isArray(body)) throw new Error("HCG News returned an unexpected response.");
    return body;
  }

  private published(): Record<string, string> {
    return { status: "eq.published", published_at: `lte.${this.now().toISOString()}` };
  }

  async verify() {
    try {
      const rows = await this.rest("news_articles", { ...this.published(), select: "id", limit: "1" });
      return rows.length
        ? { ok: true, message: "Connected to HCG News. Published articles are readable." }
        : { ok: false, message: "HCG News answered, but no published articles are readable." };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async categories() {
    if (this.categoryCache && Date.now() - this.categoryCache.at < 5 * 60_000) return this.categoryCache.value;
    const rows = (await this.rest("news_categories", { select: "id,name,slug,sort_order", order: "sort_order.asc.nullslast,name.asc" })) as Array<Record<string, unknown>>;
    const value = rows.filter((r) => r.id && r.slug && r.name).map((r) => ({ id: String(r.id), name: String(r.name), slug: String(r.slug) }));
    this.categoryCache = { at: Date.now(), value };
    return value;
  }

  async browse(sourceId: string, o: BrowseOptions): Promise<ContentPage> {
    const limit = Math.min(Math.max(o.limit ?? 20, 1), 50);
    const offset = o.cursor ? Number.parseInt(o.cursor, 10) || 0 : 0;
    const params: Record<string, string> = {
      ...this.published(),
      select: HcgNewsAdapter.columns,
      order: "published_at.desc,id.desc",
      limit: String(limit + 1),
      offset: String(offset),
    };
    if (o.query?.trim()) {
      const q = o.query.trim().replace(/[*,()"\\]/g, " ").slice(0, 80);
      params.or = `(title.ilike.*${q}*,excerpt.ilike.*${q}*,subtitle.ilike.*${q}*)`;
    }
    if (o.category) {
      const cat = (await this.categories()).find((c) => c.slug === o.category || c.id === o.category);
      if (!cat) return { items: [], nextCursor: null };
      params.category_id = `eq.${cat.id}`;
    }
    const rows = (await this.rest("news_articles", params)) as Array<Record<string, unknown>>;
    const items = rows.slice(0, limit).map((r) => this.map(sourceId, r)).filter((i): i is ContentItem => !!i);
    return { items, nextCursor: rows.length > limit ? String(offset + limit) : null };
  }

  async lookup(sourceId: string, externalId: string): Promise<ItemLookup> {
    if (!/^[0-9a-f-]{36}$/i.test(externalId)) return { found: false, reason: "not_found" };
    try {
      const rows = (await this.rest("news_articles", {
        ...this.published(),
        id: `eq.${externalId}`,
        select: HcgNewsAdapter.columns,
        limit: "1",
      })) as Array<Record<string, unknown>>;
      const item = rows[0] ? this.map(sourceId, rows[0]) : null;
      // Under RLS an unpublished, scheduled or deleted article is simply not returned.
      return item ? { found: true, item } : { found: false, reason: "unpublished" };
    } catch (e) {
      return { found: false, reason: "source_error", message: (e as Error).message };
    }
  }

  /** Re-checks every row on our side too: only published, due articles become items. */
  map(sourceId: string, r: Record<string, unknown>): ContentItem | null {
    const id = typeof r.id === "string" ? r.id : null;
    const title = typeof r.title === "string" ? r.title.trim() : "";
    if (!id || !title || r.status !== "published") return null;
    const publishedAt = typeof r.published_at === "string" ? r.published_at : null;
    if (!publishedAt || new Date(publishedAt).getTime() > this.now().getTime()) return null;
    const cat = r.category as Record<string, unknown> | null;
    const category = cat && cat.id && cat.slug && cat.name ? { id: String(cat.id), name: String(cat.name), slug: String(cat.slug) } : null;
    const slug = typeof r.slug === "string" && r.slug ? r.slug : null;
    const base = this.config!.publicationURL.replace(/\/$/, "");
    const image = typeof r.featured_image_url === "string" && r.featured_image_url.startsWith("https://") ? r.featured_image_url : null;
    const nonEmpty = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    return {
      externalId: id,
      sourceId,
      kind: "article",
      headline: title,
      description: nonEmpty(r.excerpt) ?? nonEmpty(r.subtitle),
      imageUrl: image,
      imageAlt: nonEmpty(r.featured_image_alt),
      canonicalUrl: slug ? `${base}/${encodeURIComponent(category?.slug ?? "news")}/${encodeURIComponent(slug)}` : null,
      category,
      contentType: nonEmpty(r.content_type),
      publishedAt,
      updatedAt: typeof r.updated_at === "string" ? r.updated_at : null,
      status: "published",
      isDemo: r.is_demo === true,
      promotional: {
        isFeatured: r.is_featured === true,
        isBreaking: r.is_breaking === true,
        readingTimeMinutes: typeof r.reading_time === "number" ? r.reading_time : null,
        tags: Array.isArray(r.tags) ? (r.tags as unknown[]).filter((t) => typeof t === "string").slice(0, 10).join(", ") : null,
      },
    };
  }
}
