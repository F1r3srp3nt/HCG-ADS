import { describe, expect, it } from "vitest";
import { harness, article } from "./helpers.ts";

const path = (u: string) => u.replace("http://127.0.0.1:7800", "");

describe("advertising transparency and reporting", () => {
  it("explains every delivered ad without personal data", async () => {
    const h = await harness();
    const { sidebar } = await h.connectNews();
    await h.liveInternalCampaign(article(1).id, [sidebar.id]);
    const ad = (await h.deliver(sidebar.publicKey)).ad;
    expect(ad.transparencyUrl).toMatch(/\/delivery\/v1\/transparency\//);
    const t = (await h.api("GET", path(ad.transparencyUrl) + "?format=json")).body;
    expect(t).toMatchObject({ isAdvertisement: true, disclosure: "Promoted by HCG", shownOnBehalfOf: "Hakmi Capital Group", kind: "internal" });
    expect(t.paidBy).toMatch(/own promotion, not paid/);
    expect(t.mainParameters.join(" ")).toMatch(/Article sidebar/);
    expect(t.personalDataUsed).toMatch(/^None\./);
    const html = await h.app.request(path(ad.transparencyUrl));
    expect(html.headers.get("content-type")).toMatch(/text\/html/);
    expect(html.headers.get("content-security-policy")).toMatch(/default-src 'none'/);
    const text = await html.text();
    expect(text).toContain("Why am I seeing this ad?");
    expect(text).not.toMatch(/<script/i);
    expect((await h.app.request("/delivery/v1/transparency/forged.token")).status).toBe(404);
  });

  it("collects anonymous reports, pauses on serious ones and supports review", async () => {
    const h = await harness();
    const { sidebar } = await h.connectNews();
    const c = await h.liveInternalCampaign(article(1).id, [sidebar.id]);
    const report = async (reason: string) => {
      const ad = (await h.deliver(sidebar.publicKey)).ad;
      return h.api("POST", path(ad.transparencyUrl).replace("/transparency/", "/reports/"), { reason, details: "<script>x</script> looks fake" });
    };
    expect((await report("nonsense")).status).toBe(422);
    expect((await report("misleading")).status).toBe(201);
    for (let i = 0; i < 2; i++) expect((await report("scam_or_malware")).status).toBe(201);
    expect((await h.api("GET", `/admin/v1/campaigns/${c.id}`)).body.state).toBe("active");
    expect((await report("imitates_system_warning")).status).toBe(201); // third serious report in 24 h
    const after = (await h.api("GET", `/admin/v1/campaigns/${c.id}`)).body;
    expect(after).toMatchObject({ state: "paused", stateReason: "reports" });
    expect((await h.deliver(sidebar.publicKey)).ad).toBeNull();
    const queue = (await h.api("GET", "/admin/v1/reports?status=open")).body.reports;
    expect(queue).toHaveLength(4);
    expect(queue[0].details).toBe("<script>x</script> looks fake"); // stored as text; rendered as text by the UI
    expect(Object.keys(queue[0]).some((k) => /ip|agent|cookie|device/i.test(k))).toBe(false);
    expect((await h.api("POST", `/admin/v1/reports/${queue[0].id}/resolve`, { action: "none", resolution: "" })).status).toBe(422);
    expect((await h.api("POST", `/admin/v1/reports/${queue[0].id}/resolve`, { action: "none", resolution: "Reviewed: HCG's own article" }, { "x-hcg-dev-roles": "analytics_viewer" })).status).toBe(403);
    expect((await h.api("POST", `/admin/v1/reports/${queue[0].id}/resolve`, { action: "none", resolution: "Reviewed: HCG's own article" })).status).toBe(200);
    expect((await h.api("POST", `/admin/v1/reports/${queue[0].id}/resolve`, { action: "none", resolution: "again" })).status).toBe(409);
  });
});
