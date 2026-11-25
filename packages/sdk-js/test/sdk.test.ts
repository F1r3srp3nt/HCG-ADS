import { describe, expect, it, vi, beforeEach } from "vitest";
import { HCGAdsClient } from "../src/client";
import { FrequencyStore, FREQUENCY_KEY } from "../src/frequency";
import { cropStyle, cropAspect, layoutFor } from "../src/layout";
import { renderAd } from "../src/render";
import type { DeliveryResponse, RenderableAd } from "../src/types";

const ad = (over: Partial<RenderableAd> = {}): RenderableAd => ({
  deliveryId: "d1", campaignId: "cmp_1", creativeId: "crv_1", type: "article-card",
  headline: "HCG Moves Towards a Connected Ecosystem", description: "An excerpt", callToAction: "Read on HCG News",
  clickUrl: "https://ads.example/delivery/v1/click/tok", displayUrl: "news.hakmicapitalgroup.com", disclosure: "Promoted by HCG",
  sponsorName: "Hakmi Capital Group", media: { kind: "image", url: "https://img.example/a.png", width: null, height: null, mime: null, posterUrl: null, crop: null, alt: "Cover" },
  frequency: null, beacons: { impression: "https://ads.example/delivery/v1/events/tok/impression", viewable: "https://ads.example/delivery/v1/events/tok/viewable", video: "https://ads.example/delivery/v1/events/tok/video" },
  preview: false, ...over,
});
const placement = { id: "plc_pub_x", width: 300, height: 250, responsive: "fixed" as const, fallback: "collapse" as const };
const response = (r: Partial<DeliveryResponse>): DeliveryResponse => ({ contractVersion: "1", placement, ad: null, ...r });
const fetchReturning = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

function client(body: unknown, extra: Record<string, unknown> = {}) {
  const beacons: string[] = [];
  const c = new HCGAdsClient().init({
    endpoint: "https://ads.example", fetch: fetchReturning(body), shadowMode: "open", autoScan: false,
    sendBeacon: (u) => { beacons.push(u); return true; }, ...extra,
  });
  return { c, beacons };
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("rendering", () => {
  it("renders ad text as text only — no HTML injection", async () => {
    const evil = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>';
    const { c } = client(response({ ad: ad({ headline: evil, description: evil, sponsorName: evil, callToAction: evil, disclosure: evil }) }));
    const el = document.createElement("div");
    document.body.appendChild(el);
    await c.render(el, { placement: "plc_pub_x" });
    const root = el.shadowRoot!;
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelectorAll("img").length).toBe(1); // only the creative's own image
    expect(root.querySelector(".headline")!.textContent).toBe(evil);
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("always shows the disclosure and links with sponsored rel", async () => {
    const { c } = client(response({ ad: ad() }));
    const el = document.createElement("div");
    document.body.appendChild(el);
    await c.render(el, { placement: "plc_pub_x" });
    const root = el.shadowRoot!;
    expect(root.querySelector(".chip")!.textContent).toBe("Promoted by HCG");
    const a = root.querySelector("a")!;
    expect(a.getAttribute("rel")).toBe("noopener sponsored");
    expect(a.getAttribute("href")).toBe("https://ads.example/delivery/v1/click/tok");
    expect(el.getAttribute("data-hcg-ads-state")).toBe("rendered");
  });

  it("refuses javascript: URLs in ad data", () => {
    const host = document.createElement("div");
    renderAd(host, ad({ media: { kind: "image", url: "javascript:alert(1)", width: null, height: null, mime: null, posterUrl: null, crop: null, alt: null } }), placement, { clickUrl: "javascript:alert(1)" });
    expect(host.querySelector("a")!.getAttribute("href")).toBe("#");
    expect(host.querySelector("img")).toBeNull();
  });

  it("appends m=0 to the click URL without measurement consent", async () => {
    const { c } = client(response({ ad: ad() }), { consent: { storage: false, measurement: false } });
    const el = document.createElement("div");
    await c.render(el, { placement: "plc_pub_x" });
    expect(el.shadowRoot!.querySelector("a")!.getAttribute("href")).toBe("https://ads.example/delivery/v1/click/tok?m=0");
  });
});

describe("fallback", () => {
  it("collapses the placement when nothing is delivered", async () => {
    const onEmpty = vi.fn();
    const { c } = client(response({ ad: null, reason: "no_eligible_campaign" }), { onEmpty });
    const el = document.createElement("div");
    document.body.appendChild(el);
    await c.render(el, { placement: "plc_pub_x" });
    expect(el.style.display).toBe("none");
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(onEmpty).toHaveBeenCalledWith(expect.objectContaining({ reason: "no_eligible_campaign" }));
  });

  it("keeps the space when the placement asks for it", async () => {
    const { c } = client({ contractVersion: "1", placement: { ...placement, fallback: "keep-space" }, ad: null });
    const el = document.createElement("div");
    await c.render(el, { placement: "plc_pub_x" });
    expect(el.style.display).not.toBe("none");
    expect(el.style.minHeight).toBe("250px");
  });

  it("treats an unknown contract version as empty", async () => {
    const { c } = client({ contractVersion: "2", placement, ad: ad() });
    const el = document.createElement("div");
    const out = await c.render(el, { placement: "plc_pub_x" });
    expect(out).toBeNull();
    expect(el.getAttribute("data-hcg-ads-state")).toBe("empty");
  });

  it("never throws into the host when the network fails", async () => {
    const onError = vi.fn();
    const c = new HCGAdsClient().init({ endpoint: "https://ads.example", autoScan: false, shadowMode: "open", onError, fetch: (async () => { throw new Error("offline"); }) as unknown as typeof fetch });
    const el = document.createElement("div");
    await expect(c.render(el, { placement: "plc_pub_x" })).resolves.toBeNull();
    expect(el.style.display).toBe("none");
    expect(onError).toHaveBeenCalled();
  });
});

describe("measurement", () => {
  it("sends each beacon at most once per delivery", async () => {
    const { c, beacons } = client(response({ ad: ad() }));
    const el = document.createElement("div");
    await c.render(el, { placement: "plc_pub_x" });
    expect(beacons.filter((u) => u.endsWith("/impression"))).toHaveLength(1);
    expect(c.beacon(ad(), "impression")).toBe(false);
    expect(c.beacon(ad(), "video_25")).toBe(true);
    expect(c.beacon(ad(), "video_25")).toBe(false);
    expect(beacons).toContain("https://ads.example/delivery/v1/events/tok/video_25");
  });

  it("sends nothing without measurement consent or for previews", async () => {
    const { c, beacons } = client(response({ ad: ad() }), { consent: { storage: false, measurement: false } });
    await c.render(document.createElement("div"), { placement: "plc_pub_x" });
    expect(beacons).toHaveLength(0);
    c.setConsent({ storage: false, measurement: true });
    expect(c.beacon(ad({ deliveryId: "p", preview: true }), "impression")).toBe(false);
  });
});

describe("frequency limits", () => {
  it("excludes capped campaigns and prunes to the window", () => {
    const f = new FrequencyStore(() => false);
    const t0 = 1_000_000_000_000;
    f.record("cmp_a", { count: 2, windowHours: 1 }, t0);
    expect(f.capped(t0)).toEqual([]);
    f.record("cmp_a", { count: 2, windowHours: 1 }, t0 + 1000);
    expect(f.capped(t0 + 2000)).toEqual(["cmp_a"]);
    expect(f.capped(t0 + 3600_000 + 2000)).toEqual([]);
  });

  it("persists only with storage consent", () => {
    let consent = false;
    const f = new FrequencyStore(() => consent);
    f.record("cmp_a", { count: 1, windowHours: 24 });
    expect(localStorage.getItem(FREQUENCY_KEY)).toBeNull();
    consent = true;
    f.record("cmp_b", { count: 1, windowHours: 24 });
    expect(JSON.parse(localStorage.getItem(FREQUENCY_KEY)!)).toHaveProperty("cmp_b");
  });

  it("sends capped campaigns as exclude", async () => {
    const fetchMock = fetchReturning(response({ ad: ad({ frequency: { count: 1, windowHours: 24 } }) }));
    const c = new HCGAdsClient().init({ endpoint: "https://ads.example", fetch: fetchMock, autoScan: false, shadowMode: "open", sendBeacon: () => true });
    await c.render(document.createElement("div"), { placement: "plc_pub_x" });
    await c.render(document.createElement("div"), { placement: "plc_pub_x" });
    const second = JSON.parse((fetchMock as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[1][1].body as string);
    expect(second.exclude).toEqual(["cmp_1"]);
    expect(second.sdk.name).toBe("hcg-ads-js");
  });

  it("survives a broken localStorage", () => {
    const broken = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); }, removeItem() { throw new Error("denied"); } } as unknown as Storage;
    const f = new FrequencyStore(() => true, () => broken);
    f.record("cmp_a", { count: 1, windowHours: 1 });
    expect(() => f.capped()).not.toThrow();
  });
});

describe("layout math", () => {
  it("positions the crop rectangle to fill the box with uniform scaling", () => {
    expect(cropStyle({ x: 0, y: 0, width: 1, height: 1 })).toEqual({ width: "100%", left: "0%", top: "0%" });
    expect(cropStyle({ x: 0.25, y: 0.5, width: 0.5, height: 0.25 })).toEqual({ width: "200%", left: "-50%", top: "-200%" });
  });

  it("computes the crop's aspect ratio from the media size", () => {
    // A 1200×1200 image cropped to the full width and 12.5% height is 8:1 (e.g. 728×91).
    expect(cropAspect({ x: 0, y: 0.4, width: 1, height: 0.125 }, 1200, 1200)).toBe(8);
  });

  it("chooses horizontal layouts for wide fixed placements", () => {
    expect(layoutFor({ ...placement, width: 728, height: 90 }).layout).toBe("horizontal");
    expect(layoutFor({ ...placement, width: 320, height: 50 }).density).toBe("micro");
    expect(layoutFor(placement).layout).toBe("stacked");
    expect(layoutFor({ ...placement, width: null, height: null, responsive: "responsive-native" }).layout).toBe("responsive");
  });
});

describe("auto-scan", () => {
  it("renders data-hcg-ads-placement elements with their context", async () => {
    document.body.innerHTML = '<div id="a" data-hcg-ads-placement="plc_pub_x" data-hcg-ads-category="technology"></div>';
    const fetchMock = fetchReturning(response({ ad: ad() }));
    new HCGAdsClient().init({ endpoint: "https://ads.example", fetch: fetchMock, shadowMode: "open", sendBeacon: () => true });
    await vi.waitFor(() => expect(document.getElementById("a")!.getAttribute("data-hcg-ads-state")).toBe("rendered"));
    const body = JSON.parse((fetchMock as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0][1].body as string);
    expect(body.context.category).toBe("technology");
    expect(body.placement).toBe("plc_pub_x");
  });
});

describe("Why this ad?", () => {
  it("adds an information link beside the ad (never nested inside it) and refuses unsafe URLs", () => {
    const host = document.createElement("div");
    renderAd(host, ad({ transparencyUrl: "https://ads.example/delivery/v1/transparency/tok" }), { id: "p", width: 300, height: 250, responsive: "fixed", fallback: "collapse" }, { clickUrl: "https://ads.example/click" });
    const why = host.querySelector("a.why") as HTMLAnchorElement;
    expect(why.href).toBe("https://ads.example/delivery/v1/transparency/tok");
    expect(why.closest("a.hcg-ad")).toBeNull();
    expect(why.getAttribute("aria-label")).toMatch(/^Why this ad\?/);
    const bad = document.createElement("div");
    renderAd(bad, ad({ transparencyUrl: "javascript:alert(1)" }), null, { clickUrl: "https://ads.example/click" });
    expect(bad.querySelector("a.why")).toBeNull();
  });
});
