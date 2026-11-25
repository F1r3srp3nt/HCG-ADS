import { describe, expect, it, vi, beforeEach } from "vitest";
import { HCGAdsClient } from "../src/client";
import { renderAd } from "../src/render";
import { THEMES, THEME_VARIABLES, chipContrast, contrastRatio, parseColor, themeVariables } from "../src/theme";
import type { RenderableAd } from "../src/types";

const ad = (over: Partial<RenderableAd> = {}): RenderableAd => ({
  deliveryId: "d1", campaignId: "cmp_1", creativeId: "crv_1", type: "article-card",
  headline: "HCG Store: software from Hakmi Capital Group", description: "Native apps for Mac and iPhone", callToAction: "Open in HCG Store",
  clickUrl: "https://ads.example/delivery/v1/click/tok", displayUrl: "store.hakmicapitalgroup.com", disclosure: "Promoted by HCG",
  sponsorName: "Hakmi Capital Group", media: { kind: "image", url: "https://img.example/a.png", width: 1200, height: 800, mime: "image/png", posterUrl: null, crop: null, alt: "Cover" },
  frequency: null, beacons: { impression: "https://ads.example/e/impression", viewable: "https://ads.example/e/viewable", video: "https://ads.example/e/video" },
  preview: false, ...over,
});
const fixed = { id: "plc", width: 300, height: 250, responsive: "fixed" as const, fallback: "collapse" as const };
const DEFAULT_CHIP = { bg: "rgba(17,20,24,.78)", text: "#ffffff" }; // the renderer's built-in values (hcg-news)

beforeEach(() => { document.body.innerHTML = ""; });

function render(theme?: Parameters<typeof renderAd>[3]["theme"], a = ad(), p: Parameters<typeof renderAd>[2] = fixed) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: "open" });
  renderAd(root, a, p, { clickUrl: a.clickUrl, ...(theme !== undefined ? { theme } : {}) });
  return root.querySelector<HTMLElement>(".hcg-ad")!;
}

describe("themes", () => {
  it("the default (no theme) renders exactly as before: no theme variables, no attribute", () => {
    const el = render();
    expect(el.getAttribute("data-theme")).toBeNull();
    for (const v of THEME_VARIABLES) expect(el.style.getPropertyValue(v)).toBe("");
  });

  it("hcg-news sets nothing (the light editorial look is the renderer's own)", () => {
    const el = render("hcg-news");
    expect(el.getAttribute("data-theme")).toBe("hcg-news");
    for (const v of THEME_VARIABLES) expect(el.style.getPropertyValue(v)).toBe("");
  });

  it("hcg-store applies the Store's tokens", () => {
    const el = render("hcg-store");
    expect(el.getAttribute("data-theme")).toBe("hcg-store");
    expect(el.style.getPropertyValue("--hcg-ads-surface")).toBe("#0d1016");
    expect(el.style.getPropertyValue("--hcg-ads-text")).toBe("#f4f6f9");
    expect(el.style.getPropertyValue("--hcg-ads-focus")).toBe("#45e1f5");
    expect(el.style.getPropertyValue("--hcg-ads-radius")).toBe("14px");
  });

  it("custom accepts only --hcg-ads-* variables and refuses unsafe values", () => {
    const vars = themeVariables({ name: "custom", vars: {
      "--hcg-ads-surface": "#101010", "--hcg-ads-text": "url(https://evil.example/x)", "color": "red",
      "--hcg-ads-accent": "#123456; background: red", "--hcg-ads-muted": "expression(alert(1))", "--hcg-ads-border": "1px solid #333",
    } });
    expect(vars).toEqual({ "--hcg-ads-surface": "#101010", "--hcg-ads-border": "1px solid #333" });
  });

  it("an unknown theme name falls back to the default", () => {
    expect(themeVariables("neon" as never)).toEqual({});
  });

  it("never stretches media in either theme: fixed box, contain or explicit crop", () => {
    for (const theme of ["hcg-news", "hcg-store"] as const) {
      const imageAd = ad({ type: "image", media: { kind: "image", url: "https://img.example/b.png", width: 600, height: 500, mime: "image/png", posterUrl: null, crop: null, alt: "x" } });
      const el = render(theme, imageAd);
      expect(el.classList.contains("box-fixed")).toBe(true);
      const img = el.querySelector("img")!;
      expect(img.className).toBe("contain");
      expect(img.style.width).toBe("");
      expect(img.style.height).toBe("");
      const cropped = render(theme, ad({ type: "image", media: { kind: "image", url: "https://img.example/c.png", width: 1200, height: 800, mime: "image/png", posterUrl: null, crop: { x: 0.1, y: 0, width: 0.5, height: 0.625 }, alt: "x" } }));
      const c = cropped.querySelector("img")!;
      expect(c.className).toBe("cropped");
      expect(c.style.height).toBe(""); // height follows width: uniform scaling
    }
  });

  it("keeps the disclosure chip at ≥ 4.5:1 contrast in every theme, over any image", () => {
    expect(chipContrast(DEFAULT_CHIP.bg, DEFAULT_CHIP.text)).toBeGreaterThanOrEqual(4.5);
    const store = THEMES["hcg-store"];
    expect(chipContrast(store["--hcg-ads-chip"], store["--hcg-ads-chip-text"])).toBeGreaterThanOrEqual(4.5);
    // Store body text and CTA text on their surfaces too.
    expect(contrastRatio(parseColor(store["--hcg-ads-text"])!.slice(0, 3) as never, parseColor(store["--hcg-ads-surface"])!.slice(0, 3) as never)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(parseColor(store["--hcg-ads-muted"])!.slice(0, 3) as never, parseColor(store["--hcg-ads-surface"])!.slice(0, 3) as never)).toBeGreaterThanOrEqual(4.5);
    // CTA text on the darkest stop of the metal gradient (#b9c2ce).
    expect(contrastRatio([5, 7, 10], [0xb9, 0xc2, 0xce])).toBeGreaterThanOrEqual(4.5);
    // A low-contrast chip is detected.
    expect(chipContrast("rgba(255,255,255,0.2)", "#ffffff")).toBeLessThan(4.5);
  });

  it("selects theme per placement (data attribute) over the page theme", async () => {
    const body = { contractVersion: "1", placement: fixed, ad: ad() };
    const c = new HCGAdsClient().init({ endpoint: "https://ads.example", autoScan: false, shadowMode: "open", theme: "hcg-store",
      fetch: vi.fn(async () => new Response(JSON.stringify(body))) as unknown as typeof fetch, sendBeacon: () => true });
    document.body.innerHTML = `<div id="a" data-hcg-ads-placement="k1" data-hcg-ads-theme="hcg-news"></div><div id="b" data-hcg-ads-placement="k2"></div>`;
    c.scan();
    await new Promise((r) => setTimeout(r, 20));
    const themeOf = (id: string) => document.getElementById(id)!.shadowRoot!.querySelector(".hcg-ad")!.getAttribute("data-theme");
    expect(themeOf("a")).toBe("hcg-news");
    expect(themeOf("b")).toBe("hcg-store");
  });
});
