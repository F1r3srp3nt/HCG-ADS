import { describe, expect, it } from "vitest";
import { harness, article } from "./helpers.ts";

describe("HCG News content source", () => {
  it("synchronises metadata and suspends campaigns when an article is unpublished", async () => {
    const h = await harness();
    const { sidebar } = await h.connectNews();
    const c = await h.liveInternalCampaign(article(1).id, [sidebar.id]);

    h.news.articles[0].title = "Article 1 (updated)";
    let report = (await h.api("POST", "/admin/v1/content-sources/src_hcg_news/sync")).body;
    expect(report).toMatchObject({ checked: 1, refreshed: 1, unavailable: [] });
    expect(h.ctx.sources.cached("src_hcg_news", article(1).id)?.headline).toBe("Article 1 (updated)");

    // An outage is not unpublication: nothing is suspended.
    h.news.failing = true;
    report = (await h.api("POST", "/admin/v1/content-sources/src_hcg_news/sync")).body;
    expect(report).toMatchObject({ errors: 1, suspendedCampaigns: [] });
    expect((await h.api("GET", `/admin/v1/campaigns/${c.id}`)).body.state).toBe("active");

    h.news.failing = false;
    h.news.articles[0].status = "draft";
    report = (await h.api("POST", "/admin/v1/content-sources/src_hcg_news/sync")).body;
    expect(report.suspendedCampaigns).toEqual([c.id]);
    const after = (await h.api("GET", `/admin/v1/campaigns/${c.id}`)).body;
    expect(after).toMatchObject({ state: "paused", stateReason: "source_unavailable" });
    expect((await h.deliver(sidebar.publicKey)).ad).toBeNull();
    // Cannot be reactivated until the article is back.
    expect((await h.api("POST", `/admin/v1/campaigns/${c.id}/activate`)).body.error.code).toBe("source_unavailable");
    h.news.articles[0].status = "published";
    await h.api("POST", "/admin/v1/content-sources/src_hcg_news/sync");
    expect((await h.api("POST", `/admin/v1/campaigns/${c.id}/activate`)).body.state).toBe("active");
  });

  it("searches and filters by category, and pages", async () => {
    const h = await harness();
    await h.connectNews();
    h.news.articles = Array.from({ length: 25 }, (_, i) => article(i + 1));
    const p1 = (await h.api("GET", "/admin/v1/content-sources/src_hcg_news/items?limit=20")).body;
    expect(p1.items).toHaveLength(20);
    expect(p1.nextCursor).toBe("20");
    const p2 = (await h.api("GET", `/admin/v1/content-sources/src_hcg_news/items?limit=20&cursor=20`)).body;
    expect(p2.items).toHaveLength(5);
    expect(p2.nextCursor).toBeNull();
    const q = (await h.api("GET", "/admin/v1/content-sources/src_hcg_news/items?q=Article%2012")).body;
    expect(q.items.map((i: any) => i.headline)).toEqual(["Article 12"]);
    const cat = (await h.api("GET", "/admin/v1/content-sources/src_hcg_news/items?category=technology")).body;
    expect(cat.items.length).toBeGreaterThan(0);
    const none = (await h.api("GET", "/admin/v1/content-sources/src_hcg_news/items?category=nope")).body;
    expect(none.items).toEqual([]);
  });

  it("reports unconfigured sources honestly", async () => {
    const h = await harness({ config: { hcgNews: null, hcgNewsProblems: ["config/hcg-news.json is not installed."] } });
    const r = await h.api("POST", "/admin/v1/integrations/hcg-news/connect", {});
    expect(r.status).toBe(409);
    const list = (await h.api("GET", "/admin/v1/content-sources")).body.sources;
    expect(list.find((s: any) => s.id === "src_hcg_store")).toMatchObject({ status: "not_configured", configured: false });
  });
});
