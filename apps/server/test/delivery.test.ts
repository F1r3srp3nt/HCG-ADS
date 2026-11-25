import { describe, expect, it } from "vitest";
import { harness, article } from "./helpers.ts";

const path = (u: string) => u.replace("http://127.0.0.1:7800", "");

describe("delivery engine", () => {
  it("never serves a real domain while the server-level live switch is off", async () => {
    const h = await harness();
    const { sidebar } = await h.connectNews();
    await h.liveInternalCampaign(article(1).id, [sidebar.id]);
    expect((await h.api("POST", "/admin/v1/publishers/pub_hcg_news/delivery-mode", { mode: "live", confirmation: "ENABLE LIVE HCG News" })).body.deliveryMode).toBe("live");
    expect((await h.deliver(sidebar.publicKey, {}, "https://news.hakmicapitalgroup.com")).reason).toBe("origin_not_registered_for_test");
    expect((await h.deliver(sidebar.publicKey)).ad).not.toBeNull(); // test origins keep working
  });

  it("authorises origins per delivery mode and never serves foreign sites", async () => {
    const h = await harness({ config: { liveDeliveryEnabled: true } });
    const { sidebar } = await h.connectNews();
    await h.liveInternalCampaign(article(1).id, [sidebar.id]);
    expect((await h.deliver(sidebar.publicKey, {}, "https://evil.example")).reason).toBe("origin_not_registered_for_test");
    // Test mode: the real domain is not served until the founder approves live delivery.
    expect((await h.deliver(sidebar.publicKey, {}, "https://news.hakmicapitalgroup.com")).reason).toBe("origin_not_registered_for_test");
    expect((await h.api("POST", "/admin/v1/publishers/pub_hcg_news/delivery-mode", { mode: "live", confirmation: "yes" })).status).toBe(422);
    const notFounder = await h.api("POST", "/admin/v1/publishers/pub_hcg_news/delivery-mode", { mode: "live", confirmation: "ENABLE LIVE HCG News" }, { "x-hcg-dev-roles": "ads_administrator" });
    expect(notFounder.status).toBe(403);
    expect((await h.api("POST", "/admin/v1/publishers/pub_hcg_news/delivery-mode", { mode: "live", confirmation: "ENABLE LIVE HCG News" })).body.deliveryMode).toBe("live");
    expect((await h.deliver(sidebar.publicKey, {}, "https://news.hakmicapitalgroup.com")).ad).not.toBeNull();
    expect((await h.deliver(sidebar.publicKey, {}, "http://news.hakmicapitalgroup.com")).ad).toBeNull();
    expect((await h.deliver("plc_pub_unknown")).reason).toBe("unknown_placement");
  });

  it("emergency shutdown stops all delivery immediately", async () => {
    const h = await harness();
    const { sidebar } = await h.connectNews();
    await h.liveInternalCampaign(article(1).id, [sidebar.id]);
    await h.api("POST", "/admin/v1/governance/emergency", { active: true, reason: "test" });
    expect((await h.deliver(sidebar.publicKey)).reason).toBe("emergency_shutdown");
    await h.api("POST", "/admin/v1/governance/emergency", { active: false });
    expect((await h.deliver(sidebar.publicKey)).ad).not.toBeNull();
  });

  it("prefers higher priority, honours client frequency exclusions and context", async () => {
    const h = await harness();
    const { sidebar } = await h.connectNews();
    const low = await h.liveInternalCampaign(article(1).id, [sidebar.id], { priority: 3 });
    const high = await h.liveInternalCampaign(article(2).id, [sidebar.id], { priority: 8 });
    for (let i = 0; i < 5; i++) expect((await h.deliver(sidebar.publicKey)).ad.campaignId).toBe(high.id);
    expect((await h.deliver(sidebar.publicKey, { exclude: [high.id] })).ad.campaignId).toBe(low.id);
    expect((await h.deliver(sidebar.publicKey, { exclude: [high.id, low.id] })).ad).toBeNull();
  });

  it("uses contextual categories, and an internal house ad as fallback when configured", async () => {
    const h = await harness();
    const { sidebar } = await h.connectNews();
    const r = await h.api("POST", "/admin/v1/campaigns/from-content", { sourceId: "src_hcg_news", externalIds: [article(1).id], placementIds: [sidebar.id] });
    const id = r.body.campaigns[0].id;
    await h.api("PATCH", `/admin/v1/campaigns/${id}`, { contextual: { categories: ["technology"], keywords: [] } });
    for (const a of ["submit", "approve", "activate"]) await h.api("POST", `/admin/v1/campaigns/${id}/${a}`);
    expect((await h.deliver(sidebar.publicKey, { context: { category: "technology" } })).ad?.campaignId).toBe(id);
    expect((await h.deliver(sidebar.publicKey, { context: { category: "markets" } })).ad).toBeNull();
    await h.api("PATCH", `/admin/v1/placements/${sidebar.id}`, { fallback: "house-ad" });
    expect((await h.deliver(sidebar.publicKey, { context: { category: "markets" } })).ad?.campaignId).toBe(id);
  });

  it("enforces total impression limits", async () => {
    const h = await harness();
    const { sidebar } = await h.connectNews();
    const r = await h.api("POST", "/admin/v1/campaigns/from-content", { sourceId: "src_hcg_news", externalIds: [article(1).id], placementIds: [sidebar.id] });
    const id = r.body.campaigns[0].id;
    await h.api("PATCH", `/admin/v1/campaigns/${id}`, { impressionLimit: 2 });
    for (const a of ["submit", "approve", "activate"]) await h.api("POST", `/admin/v1/campaigns/${id}/${a}`);
    for (let i = 0; i < 2; i++) {
      const ad = (await h.deliver(sidebar.publicKey)).ad;
      await h.api("POST", path(ad.beacons.impression));
    }
    expect((await h.deliver(sidebar.publicKey)).ad).toBeNull();
    expect((await h.api("GET", `/admin/v1/campaigns/${id}`)).body.state).toBe("completed");
  });

  it("separates invalid traffic and never double counts", async () => {
    const h = await harness();
    const { sidebar } = await h.connectNews();
    await h.liveInternalCampaign(article(1).id, [sidebar.id]);
    const ad1 = (await h.deliver(sidebar.publicKey)).ad;
    // Click without impression → invalid.
    h.clock.advance(1000);
    await h.app.request(path(ad1.clickUrl), { headers: { "user-agent": "Mozilla/5.0" } });
    // Bot impression → invalid.
    const ad2 = (await h.deliver(sidebar.publicKey)).ad;
    expect((await h.api("POST", path(ad2.beacons.impression), undefined, { "user-agent": "Googlebot/2.1" })).body.reason).toBe("automated_agent");
    // Expired token.
    const ad3 = (await h.deliver(sidebar.publicKey)).ad;
    h.clock.advance(2 * 60 * 60 * 1000);
    expect((await h.api("POST", path(ad3.beacons.impression))).body.reason).toBe("expired");
    // Forged token.
    expect((await h.api("POST", "/delivery/v1/events/abc.def/impression")).body.reason).toBe("invalid_token");
    // Consent withheld: click redirects without being recorded.
    const ad4 = (await h.deliver(sidebar.publicKey)).ad;
    const r = await h.app.request(path(ad4.clickUrl) + "?m=0");
    expect(r.status).toBe(302);
    const totals = (await h.api("GET", "/admin/v1/analytics")).body.totals;
    expect(totals).toMatchObject({ impressions: 0, clicks: 0, invalid: 3 });
  });

  it("native apps receive test delivery only when registered as an app test origin", async () => {
    const h = await harness();
    const { placements } = await h.connectNews();
    const ios = placements.find((p: any) => p.slot === "ios-native-card");
    await h.liveInternalCampaign(article(1).id, [ios.id]);
    const ask = async () => (await h.api("POST", "/delivery/v1/ad", { placement: ios.publicKey }, { "x-hcg-app-id": "com.hakmicapitalgroup.hcgnews" })).body;
    expect((await ask()).reason).toBe("app_not_registered_for_test");
    const pub = (await h.api("GET", "/admin/v1/publishers/pub_hcg_news")).body;
    const r = await h.api("PATCH", "/admin/v1/publishers/pub_hcg_news", { testOrigins: [...pub.testOrigins, "app://com.hakmicapitalgroup.hcgnews"] });
    expect(r.status).toBe(200);
    expect((await ask()).ad).not.toBeNull();
    expect((await h.api("PATCH", "/admin/v1/publishers/pub_hcg_news", { testOrigins: ["javascript://x"] })).status).toBe(422);
  });

  it("returns a safe empty response for malformed requests", async () => {
    const h = await harness();
    const r = await h.app.request("/delivery/v1/ad", { method: "POST", body: "not json", headers: { "content-type": "application/json" } });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ ad: null, reason: "bad_request" });
  });
});
