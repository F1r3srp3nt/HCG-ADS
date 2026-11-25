import { describe, expect, it } from "vitest";
import { harness, article } from "./helpers.ts";

const A1 = article(1).id;

describe("acceptance flow (HCG News → internal campaign → delivery → measurement → pause)", () => {
  it("runs the whole internal campaign lifecycle", async () => {
    const h = await harness();
    const { sidebar } = await h.connectNews();

    // Browse published articles only (drafts, scheduled are never shown).
    const items = await h.api("GET", "/admin/v1/content-sources/src_hcg_news/items");
    expect(items.status).toBe(200);
    expect(items.body.items.map((i: any) => i.headline)).toEqual(["Article 1", "Article 2", "Article 5"]);
    expect(items.body.items[0].canonicalUrl).toBe("https://news.hakmicapitalgroup.com/technology/article-1");
    // Reader columns only: never created_by.
    expect(h.news.requests.every((u) => !(u.searchParams.get("select") ?? "").includes("created_by"))).toBe(true);

    const created = await h.api("POST", "/admin/v1/campaigns/from-content", {
      sourceId: "src_hcg_news", externalIds: [A1], placementIds: [sidebar.id],
      overrides: { [A1]: { headline: "Custom headline", callToAction: "Read more" } },
    });
    expect(created.status).toBe(201);
    const cmp = created.body.campaigns[0];
    expect(cmp.state).toBe("draft");
    expect(cmp.kind).toBe("internal");
    expect(cmp.pricing.model).toBe("none");
    expect(cmp.disclosureLabel).toBe("Promoted by HCG");
    expect(cmp.creatives[0]).toMatchObject({ type: "article-card", headline: "Custom headline", callToAction: "Read more", destinationUrl: "https://news.hakmicapitalgroup.com/technology/article-1" });

    // Nothing is delivered before approval and activation.
    expect((await h.deliver(sidebar.publicKey)).ad).toBeNull();

    // Preview works before approval and is never counted.
    const preview = await h.api("GET", `/admin/v1/campaigns/${cmp.id}/preview?placementId=${sidebar.id}`);
    expect(preview.body.response.ad).toMatchObject({ headline: "Custom headline", preview: true, disclosure: "Promoted by HCG" });
    const pv = await h.api("POST", preview.body.response.ad.beacons.impression.replace("http://127.0.0.1:7800", ""));
    expect(pv.body).toEqual({ counted: false, reason: "preview" });

    for (const action of ["submit", "approve", "activate"]) {
      const r = await h.api("POST", `/admin/v1/campaigns/${cmp.id}/${action}`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    expect((await h.api("GET", `/admin/v1/campaigns/${cmp.id}`)).body.state).toBe("active");

    const res = await h.deliver(sidebar.publicKey);
    expect(res.ad).toMatchObject({ campaignId: cmp.id, headline: "Custom headline", disclosure: "Promoted by HCG", sponsorName: "Hakmi Capital Group" });
    expect(res.ad.clickUrl).toMatch(/\/delivery\/v1\/click\//);

    const path = (u: string) => u.replace("http://127.0.0.1:7800", "");
    expect((await h.api("POST", path(res.ad.beacons.impression))).body).toEqual({ counted: true });
    expect((await h.api("POST", path(res.ad.beacons.impression))).body).toEqual({ counted: false, reason: "duplicate" });
    h.clock.advance(2000);
    const click = await h.app.request(path(res.ad.clickUrl), { headers: { "user-agent": "Mozilla/5.0" } });
    expect(click.status).toBe(302);
    expect(click.headers.get("location")).toBe("https://news.hakmicapitalgroup.com/technology/article-1");

    const analytics = await h.api("GET", "/admin/v1/analytics");
    expect(analytics.body.dataset).toBe("measured");
    expect(analytics.body.totals).toMatchObject({ impressions: 1, clicks: 1, ctr: 100, requests: 2, filled: 1, invalid: 0 });

    expect((await h.api("POST", `/admin/v1/campaigns/${cmp.id}/pause`)).body.state).toBe("paused");
    const after = await h.deliver(sidebar.publicKey);
    expect(after.ad).toBeNull();
    expect(after.placement.fallback).toBe("collapse");

    const history = (await h.api("GET", `/admin/v1/campaigns/${cmp.id}`)).body.history.map((x: any) => x.action);
    expect(history).toEqual(["create", "submit", "approve", "activate", "pause"]);
  });

  it("refuses invalid transitions and edits after approval", async () => {
    const h = await harness();
    const { sidebar } = await h.connectNews();
    const c = (await h.api("POST", "/admin/v1/campaigns/from-content", { sourceId: "src_hcg_news", externalIds: [A1], placementIds: [sidebar.id] })).body.campaigns[0];
    expect((await h.api("POST", `/admin/v1/campaigns/${c.id}/activate`)).status).toBe(409);
    expect((await h.api("POST", `/admin/v1/campaigns/${c.id}/approve`)).status).toBe(409);
    await h.api("POST", `/admin/v1/campaigns/${c.id}/submit`);
    expect((await h.api("PATCH", `/admin/v1/campaigns/${c.id}`, { name: "x renamed" })).body.error.code).toBe("not_editable");
    expect((await h.api("POST", `/admin/v1/campaigns/${c.id}/reject`, {})).status).toBe(422); // note required
    expect((await h.api("POST", `/admin/v1/campaigns/${c.id}/reject`, { note: "Tone" })).body.state).toBe("rejected");
    expect((await h.api("PATCH", `/admin/v1/campaigns/${c.id}`, { name: "Renamed" })).body.name).toBe("Renamed");
    const dup = await h.api("POST", `/admin/v1/campaigns/${c.id}/duplicate`);
    expect(dup.status).toBe(201);
    expect(dup.body).toMatchObject({ state: "draft", name: "Renamed (copy)" });
    expect(dup.body.creatives).toHaveLength(1);
  });

  it("does not promote drafts, scheduled or demo articles", async () => {
    const h = await harness();
    const { sidebar } = await h.connectNews();
    for (const n of [3, 4]) {
      const r = await h.api("POST", "/admin/v1/campaigns/from-content", { sourceId: "src_hcg_news", externalIds: [article(n).id], placementIds: [sidebar.id] });
      expect(r.status).toBe(404);
    }
    const demo = await h.api("POST", "/admin/v1/campaigns/from-content", { sourceId: "src_hcg_news", externalIds: [article(5).id], placementIds: [sidebar.id] });
    expect(demo.status).toBe(422);
  });

  it("schedules, starts and completes campaigns on time", async () => {
    const h = await harness();
    const { sidebar } = await h.connectNews();
    const c = (await h.api("POST", "/admin/v1/campaigns/from-content", {
      sourceId: "src_hcg_news", externalIds: [A1], placementIds: [sidebar.id],
      startAt: "2026-11-26T00:00:00.000Z", endAt: "2026-11-28T00:00:00.000Z",
    })).body.campaigns[0];
    for (const a of ["submit", "approve"]) await h.api("POST", `/admin/v1/campaigns/${c.id}/${a}`);
    expect((await h.api("POST", `/admin/v1/campaigns/${c.id}/activate`)).body.state).toBe("scheduled");
    expect((await h.deliver(sidebar.publicKey)).ad).toBeNull();
    h.clock.set("2026-11-26T01:00:00.000Z");
    expect((await h.deliver(sidebar.publicKey)).ad?.campaignId).toBe(c.id);
    h.clock.set("2026-11-28T00:00:01.000Z");
    expect((await h.deliver(sidebar.publicKey)).ad).toBeNull();
    expect((await h.api("GET", `/admin/v1/campaigns/${c.id}`)).body.state).toBe("completed");
  });
});

import { clip } from "../src/campaigns/service.ts";
describe("generated copy", () => {
  it("shortens long headlines at a word boundary", () => {
    const long = "How Jensen Huang Lost $1.47 Trillion and Then Got It Almost Back: Inside the Affair, the Allegations and Jensen Huang's Extraordinary Comeback";
    const out = clip(long, 120)!;
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.endsWith("…")).toBe(true);
    expect(long.startsWith(out.slice(0, -1))).toBe(true);
    expect(long[out.length - 1]).toBe(" ");
    expect(clip("short", 120)).toBe("short");
  });
});
