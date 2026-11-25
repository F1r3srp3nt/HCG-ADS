import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Campaign } from "@hcg-ads/contracts";
import type { PaymentsGateway } from "./service.ts";

/**
 * HCG Payments client for HCG ADS (test mode only).
 *
 * Contract: HCG Payments `docs/API.md` (signed commerce clients, Idempotency-Key) and
 * `docs/contracts/ADS-AND-MARKETPLACE.md` (purposes). HCG ADS never talks to a payment
 * provider directly, never sends an amount (HCG Payments prices server-side), and never
 * treats payment state as a delivery decision.
 *
 * Purposes, as HCG Payments enforces them in code:
 *   ads.internal_campaign → never charged (HCG ADS does not even call HCG Payments)
 *   ads.fixed_placement / ads.campaign_budget / ads.usage_billing → inactive until approved
 *   ads.prepaid_credits → legal review (HCG ADS offers no prepaid credits)
 */
export const PaymentsConfigSchema = z.object({
  contractVersion: z.literal("hcg.ads.payments/1"),
  baseUrl: z.string().url(),
  /** The commerce client HCG Payments registers for HCG ADS (bound to one organisation). */
  clientId: z.string().min(2),
  /** Environment variable or file holding the client secret (secret store; never committed). */
  secretEnv: z.string().regex(/^[A-Z][A-Z0-9_]+$/).optional(),
  secretFile: z.string().optional(),
  /** HCG Payments product and price IDs for each advertising purpose (as HCG Payments publishes them). */
  productId: z.string().min(2),
  prices: z.record(z.enum(["ads.fixed_placement", "ads.campaign_budget", "ads.usage_billing"]), z.string()).default({}),
  returnOrigin: z.string().url(),
}).strict().refine((c) => c.secretEnv || c.secretFile, "secretEnv or secretFile is required");
export type PaymentsConfig = z.infer<typeof PaymentsConfigSchema>;

export type AdsPurpose = "ads.internal_campaign" | "ads.fixed_placement" | "ads.campaign_budget" | "ads.usage_billing";

export function purposeFor(c: Pick<Campaign, "kind" | "pricing">): AdsPurpose {
  if (c.kind === "internal" || c.pricing.model === "none") return "ads.internal_campaign";
  if (c.pricing.model === "fixed") return "ads.fixed_placement";
  return "ads.usage_billing"; // CPM/CPC: invoiced in arrears from delivered usage, never prepaid
}

export interface CheckoutDecision {
  purpose: AdsPurpose;
  /** "no_payment_required" | "refused" | "checkout_created" | "unavailable" */
  outcome: string;
  code: string | null;
  message: string;
  mode: "test" | null;
  orderId?: string;
  checkoutUrl?: string;
  amountMinor?: number;
  currency?: string;
}

export class HcgPaymentsGateway implements PaymentsGateway {
  readonly name = "hcg-payments";
  readonly live = false;
  private lastHealth: { connected: boolean; message: string } = { connected: false, message: "HCG Payments has not been contacted yet." };

  constructor(private cfg: PaymentsConfig, private fetchImpl: typeof fetch = fetch, private secretOverride?: string) {}

  private secret(): string {
    const s = this.secretOverride ?? (this.cfg.secretEnv ? process.env[this.cfg.secretEnv] : undefined)
      ?? (this.cfg.secretFile ? readFileSync(this.cfg.secretFile, "utf8").trim() : undefined);
    if (!s) throw new Error("The HCG Payments client secret is not available from the secret store.");
    return s;
  }

  /** Signed request exactly as HCG Payments documents it (HMAC-SHA256 over ts, nonce, method, path, body hash, actor grant). */
  private async call(method: string, pathWithQuery: string, body?: unknown, idempotencyKey?: string): Promise<{ status: number; json: Record<string, unknown> }> {
    const raw = body === undefined ? "" : JSON.stringify(body);
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(18).toString("base64url");
    const toSign = `${ts}\n${nonce}\n${method}\n${pathWithQuery}\n${createHash("sha256").update(raw).digest("hex")}\n`;
    const headers: Record<string, string> = {
      accept: "application/json",
      "x-hcg-client": this.cfg.clientId,
      "x-hcg-timestamp": ts,
      "x-hcg-nonce": nonce,
      "x-hcg-signature": createHmac("sha256", this.secret()).update(toSign).digest("hex"),
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
    const res = await this.fetchImpl(`${this.cfg.baseUrl.replace(/\/$/, "")}${pathWithQuery}`, {
      method, headers, body: body === undefined ? undefined : raw, signal: AbortSignal.timeout(15_000),
    });
    const json = ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    return { status: res.status, json };
  }

  status() { return this.lastHealth; }

  /** Reads the products HCG Payments offers HCG ADS's organisation; refuses anything not in test mode. */
  async checkHealth(): Promise<{ connected: boolean; message: string; products: Array<{ id: string; mode: string; prices: unknown[] }> }> {
    try {
      const { status, json } = await this.call("GET", "/v1/products");
      if (status !== 200) throw new Error(`HTTP ${status} ${(json.error as { code?: string })?.code ?? ""}`.trim());
      const products = (Array.isArray(json.data) ? json.data : []) as Array<{ id: string; mode: string; prices: unknown[] }>;
      const live = products.filter((p) => p.mode !== "test");
      if (live.length) throw new Error(`HCG Payments reported a non-test mode for ${live.map((p) => p.id).join(", ")}; HCG ADS refuses it.`);
      this.lastHealth = { connected: true, message: `HCG Payments reachable (TEST MODE). ${products.length} product(s) for HCG ADS's organisation.` };
      return { ...this.lastHealth, products };
    } catch (e) {
      this.lastHealth = { connected: false, message: `HCG Payments not reachable or not configured: ${(e as Error).message}` };
      return { ...this.lastHealth, products: [] };
    }
  }

  /**
   * Asks HCG Payments to open a TEST-MODE checkout for a campaign booking. Internal
   * campaigns are never sent. HCG Payments decides whether the purpose is active; today
   * every paid advertising purpose is inactive, so the expected answer is a refusal.
   */
  async requestCheckout(c: Campaign, customerSub: string): Promise<CheckoutDecision> {
    const purpose = purposeFor(c);
    if (purpose === "ads.internal_campaign") {
      return { purpose, outcome: "no_payment_required", code: "no_payment_required", message: "Internal HCG campaigns are never charged.", mode: null };
    }
    const priceId = this.cfg.prices[purpose];
    if (!priceId) {
      return { purpose, outcome: "refused", code: "price_not_published", message: `HCG Payments has not published a price for ${purpose}.`, mode: null };
    }
    let res: { status: number; json: Record<string, unknown> };
    try {
      res = await this.call("POST", "/v1/checkout-sessions", {
        product_id: this.cfg.productId, price_id: priceId, customer: { sub: customerSub },
        success_url: `${this.cfg.returnOrigin.replace(/\/$/, "")}/#/revenue?checkout=done`,
        cancel_url: `${this.cfg.returnOrigin.replace(/\/$/, "")}/#/revenue?checkout=cancelled`,
      }, `hcgads_checkout_${c.id}`);
    } catch (e) {
      return { purpose, outcome: "unavailable", code: "hcg_payments_unavailable", message: (e as Error).message, mode: null };
    }
    const err = res.json.error as { code?: string; message?: string } | undefined;
    if (res.status === 200 || res.status === 201) {
      if (res.json.mode !== "test") return { purpose, outcome: "refused", code: "not_test_mode", message: "HCG ADS accepts test-mode checkouts only.", mode: null };
      const checkout = res.json.checkout as { url?: string } | undefined;
      return { purpose, outcome: "checkout_created", code: null, message: "TEST MODE checkout created by HCG Payments. No real payment is taken.", mode: "test",
        orderId: String(res.json.id), checkoutUrl: checkout?.url, amountMinor: Number(res.json.amount), currency: String(res.json.currency) };
    }
    return { purpose, outcome: res.status >= 500 ? "unavailable" : "refused", code: err?.code ?? `http_${res.status}`, message: err?.message ?? `HCG Payments answered HTTP ${res.status}.`, mode: null };
  }
}
