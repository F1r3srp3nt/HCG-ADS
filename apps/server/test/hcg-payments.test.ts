import { describe, expect, it } from "vitest";
import { HcgPaymentsGateway, PaymentsConfigSchema, purposeFor } from "../src/billing/hcg-payments.ts";
import type { Campaign } from "@hcg-ads/contracts";

const cfg = PaymentsConfigSchema.parse({
  contractVersion: "hcg.ads.payments/1", baseUrl: process.env.HCG_PAYMENTS_URL ?? "http://127.0.0.1:8790", clientId: "hcg-ads",
  secretEnv: "HCG_PAYMENTS_CLIENT_SECRET_HCG_ADS", productId: "hcg-ads-test",
  prices: { "ads.fixed_placement": "price_ads_fixed_test", "ads.campaign_budget": "price_ads_budget_test", "ads.usage_billing": "price_ads_usage_test" },
  returnOrigin: "http://127.0.0.1:7800",
});
const campaign = (over: Partial<Campaign>): Campaign => ({
  id: "cmp_test", name: "t", kind: "external", advertiserId: "adv", objective: "traffic", state: "approved", stateReason: null, priority: 5,
  startAt: null, endAt: null, publisherIds: [], placementIds: [], rotation: "even", impressionLimit: null, dailyImpressionLimit: null, frequencyLimit: null,
  contextual: { categories: [], keywords: [] }, pricing: { model: "fixed", budgetMinor: 50000, rateMinor: null, currency: "NOK" }, disclosureLabel: "Sponsored",
  createdBy: "x", createdAt: "", updatedAt: "", ...over,
});
const SUB = "ecf223e3-13d9-4186-ac84-06fb9a058cd6";

describe("HCG Payments client (contract: HCG Payments API v1 + ADS purposes)", () => {
  it("maps campaigns to HCG Payments purposes and never charges internal campaigns", async () => {
    expect(purposeFor(campaign({ kind: "internal", pricing: { model: "none", budgetMinor: null, rateMinor: null, currency: "NOK" } }))).toBe("ads.internal_campaign");
    expect(purposeFor(campaign({}))).toBe("ads.fixed_placement");
    expect(purposeFor(campaign({ pricing: { model: "cpm", budgetMinor: null, rateMinor: 5000, currency: "NOK" } }))).toBe("ads.usage_billing");
    let calls = 0;
    const gw = new HcgPaymentsGateway(cfg, (async () => { calls++; return Response.json({}); }) as unknown as typeof fetch, "s");
    const d = await gw.requestCheckout(campaign({ kind: "internal", pricing: { model: "none", budgetMinor: null, rateMinor: null, currency: "NOK" } }), SUB);
    expect(d).toMatchObject({ outcome: "no_payment_required" });
    expect(calls).toBe(0);
  });

  it("signs requests as HCG Payments documents and never sends an amount", async () => {
    const seen: any[] = [];
    const gw = new HcgPaymentsGateway(cfg, (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers, body: init.body });
      return Response.json({ error: { code: "purpose_not_activated", message: "not activated" } }, { status: 422 });
    }) as unknown as typeof fetch, "secret");
    const d = await gw.requestCheckout(campaign({}), SUB);
    expect(d).toMatchObject({ outcome: "refused", code: "purpose_not_activated" });
    const h = seen[0].headers as Record<string, string>;
    expect(h["x-hcg-client"]).toBe("hcg-ads");
    expect(h["x-hcg-signature"]).toMatch(/^[0-9a-f]{64}$/);
    expect(h["idempotency-key"]).toBe("hcgads_checkout_cmp_test");
    const body = JSON.parse(String(seen[0].body));
    expect(body).toEqual(expect.objectContaining({ product_id: "hcg-ads-test", price_id: "price_ads_fixed_test", customer: { sub: SUB } }));
    expect(JSON.stringify(body)).not.toMatch(/amount|currency/);
  });

  it("refuses a non-test-mode answer", async () => {
    const gw = new HcgPaymentsGateway(cfg, (async () => Response.json({ id: "ord_1", mode: "live", checkout: { url: "x" } }, { status: 201 })) as unknown as typeof fetch, "s");
    expect(await gw.requestCheckout(campaign({}), SUB)).toMatchObject({ outcome: "refused", code: "not_test_mode" });
  });
});

/** Runs against the REAL HCG Payments service (test mode) when HCG_PAYMENTS_URL is set. */
describe.skipIf(!process.env.HCG_PAYMENTS_URL)("HCG Payments live (local test-mode service)", () => {
  const secret = process.env.HCG_PAYMENTS_CLIENT_SECRET_HCG_ADS!;
  it("is reachable in test mode with a signed client", async () => {
    const h = await new HcgPaymentsGateway(cfg, fetch, secret).checkHealth();
    expect(h.connected, h.message).toBe(true);
    expect(h.products.map((p) => p.id)).toContain("hcg-ads-test");
  });
  it("every paid advertising purpose is refused until the Owner activates it", async () => {
    const gw = new HcgPaymentsGateway(cfg, fetch, secret);
    expect(await gw.requestCheckout(campaign({ id: "cmp_fixed" }), SUB)).toMatchObject({ outcome: "refused", code: "purpose_not_activated" });
    expect(await gw.requestCheckout(campaign({ id: "cmp_cpm", pricing: { model: "cpm", budgetMinor: null, rateMinor: 5000, currency: "NOK" } }), SUB))
      .toMatchObject({ outcome: "refused", code: "purpose_not_activated" });
  });
  it("a wrong secret is refused by HCG Payments", async () => {
    const h = await new HcgPaymentsGateway(cfg, fetch, "wrong-secret").checkHealth();
    expect(h.connected).toBe(false);
    expect(h.message).toMatch(/unauthenticated|401/);
  });
});
