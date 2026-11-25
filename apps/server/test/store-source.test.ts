import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { HcgStoreAdapter, validateStoreUrl } from "../src/sources/hcg-store.ts";

// The real public catalogue from F1r3srp3nt/store (web-hcg-store/catalogue/products.json).
const catalogue = JSON.parse(readFileSync(new URL("./fixtures/store-products.json", import.meta.url), "utf8"));
const URL_OK = "https://store.hakmicapitalgroup.com/catalogue/products.json";

function adapter(doc: unknown = catalogue) {
  const calls: string[] = [];
  let current = doc;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return Response.json(current);
  }) as typeof fetch;
  const a = new HcgStoreAdapter({ catalogueUrl: URL_OK }, fetchImpl);
  return { a, calls, set: (d: unknown) => { current = d; } };
}

describe("HCG Store content source", () => {
  it("lists only listed products; drafts such as HCG Representation and HCG ADS never appear", async () => {
    const { a } = adapter();
    const page = await a.browse("src_hcg_store", { limit: 50 });
    const drafts = catalogue.products.filter((p: { visibility?: string }) => p.visibility === "draft").map((p: { id: string }) => p.id);
    expect(drafts).toContain("hcg-representation");
    expect(page.items.length).toBe(catalogue.products.length - drafts.length);
    for (const id of drafts) expect(page.items.find((i) => i.externalId === id)).toBeUndefined();
    expect(page.items.find((i) => /representation/i.test(i.headline))).toBeUndefined();
    expect((await a.browse("src_hcg_store", { query: "Representation" })).items).toEqual([]);
  });

  it("maps catalogue facts honestly: name, summary, artwork, category, product page; no prices or ratings", async () => {
    const { a } = adapter();
    const lifeos = (await a.browse("src_hcg_store", { query: "LifeOS" })).items.find((i) => i.externalId === "hcg-lifeos")!;
    expect(lifeos).toMatchObject({
      kind: "product", headline: "HCG LifeOS", status: "published", isDemo: false,
      canonicalUrl: "https://store.hakmicapitalgroup.com/apps/hcg-lifeos",
      imageUrl: "https://store.hakmicapitalgroup.com/media/products/hcg-lifeos/banner-2000.webp",
      category: { id: "productivity", name: "Productivity", slug: "productivity" },
    });
    expect(lifeos.description).toMatch(/^Gamified, local-first productivity/);
    expect(lifeos.promotional).toEqual({ developmentStatus: "in-development", releaseAvailable: false, platforms: "macos", centralProductId: "hcg.lifeos" });
    const keys = JSON.stringify(Object.keys({ ...lifeos, ...lifeos.promotional }));
    expect(keys).not.toMatch(/price|rating|download|review/i);
  });

  it("filters by category and pages", async () => {
    const { a } = adapter();
    const cats = await a.categories();
    expect(cats.length).toBeGreaterThan(0);
    const first = await a.browse("src_hcg_store", { category: cats[0].slug, limit: 50 });
    expect(first.items.every((i) => i.category?.slug === cats[0].slug)).toBe(true);
    const p1 = await a.browse("src_hcg_store", { limit: 5 });
    expect(p1.items).toHaveLength(5);
    expect(p1.nextCursor).toBe("5");
  });

  it("lookup reports a product that became a draft as unpublished (campaigns are suspended)", async () => {
    const { a, set } = adapter();
    expect((await a.lookup("src_hcg_store", "hcg-lifeos")).found).toBe(true);
    set({ ...catalogue, products: catalogue.products.map((p: { id: string }) => (p.id === "hcg-lifeos" ? { ...p, visibility: "draft" } : p)) });
    expect(await a.lookup("src_hcg_store", "hcg-lifeos")).toEqual({ found: false, reason: "unpublished" });
    expect(await a.lookup("src_hcg_store", "hcg-representation")).toEqual({ found: false, reason: "unpublished" });
    expect(await a.lookup("src_hcg_store", "no-such-product")).toEqual({ found: false, reason: "not_found" });
  });

  it("a source outage is reported as an error, never as unpublication", async () => {
    const a = new HcgStoreAdapter({ catalogueUrl: URL_OK }, (async () => { throw new TypeError("fetch failed"); }) as typeof fetch);
    expect(await a.lookup("src_hcg_store", "hcg-lifeos")).toMatchObject({ found: false, reason: "source_error" });
    expect((await a.verify()).ok).toBe(false);
  });

  it("refuses catalogue URLs that are not HTTPS on an HCG host, and is unconfigured without one", () => {
    expect(validateStoreUrl("https://store.hakmicapitalgroup.com/x.json", "u").url).not.toBeNull();
    for (const bad of ["http://store.hakmicapitalgroup.com/x.json", "https://evil.example/x.json", "https://hakmicapitalgroup.com.evil.example/x.json",
      "https://user:pw@store.hakmicapitalgroup.com/x.json", "https://raw.githubusercontent.com/F1r3srp3nt/store/main/web-hcg-store/catalogue/products.json"]) {
      expect(validateStoreUrl(bad, "u").url, bad).toBeNull();
    }
    const none = new HcgStoreAdapter({ catalogueUrl: null });
    expect(none.configured).toBe(false);
    expect(none.configurationProblems.join(" ")).toMatch(/not published its catalogue/);
    expect(new HcgStoreAdapter({ catalogueUrl: "https://evil.example/products.json" }).configured).toBe(false);
  });

  it("never links artwork outside HCG hosts", () => {
    const { a } = adapter();
    const item = a.map("s", { id: "x", name: "X", artwork: { cover: { src: "https://evil.example/a.png" } } });
    expect(item?.imageUrl).toBeNull();
    expect(a.map("s", { id: "y", name: "Y", artwork: { cover: { src: "javascript:alert(1)" } } })?.imageUrl).toBeNull();
  });
});
