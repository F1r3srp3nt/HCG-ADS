import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { FixedClock } from "../src/core/clock.ts";
import type { ServerConfig } from "../src/config.ts";
import { createContext, type AppContext, type ContextOverrides } from "../src/context.ts";
import { createApp } from "../src/http/app.ts";
import { LocalStorageProvider } from "../src/media/local-storage.ts";
import { BasicProcessor } from "../src/media/processor.ts";

export const ANON_KEY = [
  Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
  Buffer.from(JSON.stringify({ iss: "supabase", ref: "qggdyzoydveafkmjgkpq", role: "anon" })).toString("base64url"),
  "signature",
].join(".");

export interface FakeArticle {
  id: string; title: string; slug: string; excerpt?: string | null; subtitle?: string | null; status: string; published_at: string;
  updated_at?: string; featured_image_url?: string | null; is_demo?: boolean; content_type?: string; category_id?: string;
  category?: { id: string; name: string; slug: string } | null; created_by?: string;
}

export const CATEGORY = { id: "684b45e0-c4c8-4854-9528-0a052a6fd310", name: "Technology", slug: "technology" };

export function article(n: number, over: Partial<FakeArticle> = {}): FakeArticle {
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return {
    id, title: `Article ${n}`, slug: `article-${n}`, excerpt: `Excerpt ${n}`, status: "published",
    published_at: "2026-11-20T10:00:00.000Z", updated_at: "2026-11-21T10:00:00.000Z",
    featured_image_url: `https://qggdyzoydveafkmjgkpq.supabase.co/storage/v1/object/sign/hcg-news-media/a${n}.png?token=x`,
    is_demo: false, content_type: "news", category_id: CATEGORY.id, category: CATEGORY, created_by: "secret-author", ...over,
  };
}

/**
 * A fake of the HCG News PostgREST surface that behaves like row-level security
 * for the anonymous role: only published, due rows are ever returned.
 */
export class FakeHcgNews {
  articles: FakeArticle[] = [];
  requests: URL[] = [];
  failing = false;

  fetch: typeof fetch = async (input) => {
    const url = new URL(String(input));
    this.requests.push(url);
    if (this.failing) throw new TypeError("fetch failed");
    const p = url.searchParams;
    if (url.pathname.endsWith("/news_categories")) return Response.json([{ ...CATEGORY, sort_order: 1 }]);
    if (!url.pathname.endsWith("/news_articles")) return new Response("[]", { status: 404 });
    const now = new Date((p.get("published_at") ?? "lte.2100-01-01").slice(4));
    let rows = this.articles.filter((a) => a.status === "published" && new Date(a.published_at) <= now);
    if (p.get("id")) rows = rows.filter((a) => a.id === p.get("id")!.slice(3));
    if (p.get("category_id")) rows = rows.filter((a) => a.category_id === p.get("category_id")!.slice(3));
    const q = p.get("or")?.match(/ilike\.\*(.*?)\*/)?.[1];
    if (q) rows = rows.filter((a) => a.title.toLowerCase().includes(q.toLowerCase()));
    const offset = Number(p.get("offset") ?? 0), limit = Number(p.get("limit") ?? 100);
    const cols = (p.get("select") ?? "").split(",");
    return Response.json(rows.slice(offset, offset + limit).map((a) => {
      const o: Record<string, unknown> = {};
      for (const c of cols) {
        if (c.startsWith("category:")) o.category = a.category ?? null;
        else if (c in a) o[c] = (a as unknown as Record<string, unknown>)[c];
        else o[c] = null;
      }
      return o;
    }));
  };
}

export function testConfig(over: Partial<ServerConfig> = {}): ServerConfig {
  const dataDir = mkdtempSync(join(tmpdir(), "hcg-ads-test-"));
  return {
    env: "test", host: "127.0.0.1", port: 0, publicBaseUrl: "http://127.0.0.1:7800", adminOrigins: [], dataDir,
    deliverySecret: Buffer.alloc(32, 7), identity: { mode: "development" }, hcgConnectProblems: [],
    storage: { provider: "local" },
    hcgNews: { environment: "test", projectURL: "https://qggdyzoydveafkmjgkpq.supabase.co", publicClientKey: ANON_KEY, publicationURL: "https://news.hakmicapitalgroup.com", approvedByFounder: true },
    hcgNewsProblems: [], knownProjectRefs: ["qggdyzoydveafkmjgkpq"], syncIntervalMs: 60_000, adminStaticDir: null, ...over,
  };
}

export interface Harness {
  ctx: AppContext;
  app: ReturnType<typeof createApp>;
  clock: FixedClock;
  news: FakeHcgNews;
  api<T = any>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: T }>;
  deliver(placementKey: string, extra?: Record<string, unknown>, origin?: string): Promise<any>;
  /** Connects HCG News, returns the article-sidebar and in-article placements. */
  connectNews(): Promise<{ sidebar: any; inArticle: any; leaderboard: any; placements: any[] }>;
  liveInternalCampaign(articleId: string, placementIds: string[], extra?: Record<string, unknown>): Promise<any>;
}

export async function harness(over: ContextOverrides & { config?: Partial<ServerConfig> } = {}): Promise<Harness> {
  const config = testConfig(over.config);
  const clock = new FixedClock(new Date("2026-11-25T12:00:00.000Z"));
  const news = new FakeHcgNews();
  news.articles = [article(1), article(2), article(3, { status: "draft" }), article(4, { published_at: "2026-12-30T00:00:00Z" }), article(5, { is_demo: true })];
  const ctx = await createContext(config, {
    clock, fetch: news.fetch, dbPath: ":memory:", storage: new LocalStorageProvider(join(config.dataDir, "media")),
    processor: new BasicProcessor(), ...over,
  });
  const app = createApp(ctx);
  const api: Harness["api"] = async (method, path, body, headers = {}) => {
    const isForm = body instanceof FormData;
    const res = await app.request(path, {
      method,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      headers: { ...(body !== undefined && !isForm ? { "content-type": "application/json" } : {}), ...headers },
    });
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, body: parsed as any };
  };
  const h: Harness = {
    ctx, app, clock, news, api,
    async deliver(placementKey, extra = {}, origin = "http://127.0.0.1:7800") {
      return (await api("POST", "/delivery/v1/ad", { placement: placementKey, ...extra }, { origin })).body;
    },
    async connectNews() {
      const r = await api("POST", "/admin/v1/integrations/hcg-news/connect", {});
      if (r.status !== 200) throw new Error(JSON.stringify(r.body));
      const placements = r.body.placements;
      const by = (slot: string) => placements.find((p: any) => p.slot === slot);
      return { sidebar: by("article-sidebar"), inArticle: by("in-article"), leaderboard: by("home-leaderboard"), placements };
    },
    async liveInternalCampaign(articleId, placementIds, extra = {}) {
      const r = await api("POST", "/admin/v1/campaigns/from-content", { sourceId: "src_hcg_news", externalIds: [articleId], placementIds, ...extra });
      if (r.status !== 201) throw new Error(JSON.stringify(r.body));
      const id = r.body.campaigns[0].id;
      for (const a of ["submit", "approve", "activate"]) {
        const x = await api("POST", `/admin/v1/campaigns/${id}/${a}`);
        if (x.status !== 200) throw new Error(`${a}: ${JSON.stringify(x.body)}`);
      }
      return (await api("GET", `/admin/v1/campaigns/${id}`)).body;
    },
  };
  return h;
}

export function hasFfmpeg(): boolean {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; }
}

/** Generates a real media file with ffmpeg's test source. */
export function makeMedia(dir: string, name: string, args: string[]): Buffer {
  const out = join(dir, name);
  execFileSync("ffmpeg", ["-v", "error", "-y", ...args, out]);
  return readFileSync(out);
}
