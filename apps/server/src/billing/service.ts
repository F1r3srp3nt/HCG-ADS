import { z } from "zod";
import type { Database } from "../db/database.ts";
import type { Clock } from "../core/clock.ts";
import type { AuditActor, AuditLog } from "../core/audit.ts";
import { newId } from "../core/ids.ts";
import type { CampaignService } from "../campaigns/service.ts";

/**
 * Revenue and Billing — TEST MODE ONLY.
 *
 * No money moves. HCG ADS never processes payments itself: commercial
 * functionality is delegated to HCG Payments through `PaymentsGateway`, which
 * is not connected in this version. Every figure here is test-mode data.
 */
export interface PaymentsGateway {
  readonly name: string;
  readonly live: boolean;
  status(): { connected: boolean; message: string };
}

export class TestModePaymentsGateway implements PaymentsGateway {
  readonly name = "test-mode";
  readonly live = false;
  status() { return { connected: false, message: "TEST MODE — HCG Payments is not connected. No charges, invoices or payouts are real." }; }
}

export const LedgerInput = z.object({
  kind: z.enum(["prepaid_credit", "invoice", "refund", "adjustment"]),
  advertiserId: z.string().nullable().default(null),
  campaignId: z.string().nullable().default(null),
  amountMinor: z.number().int(),
  currency: z.string().length(3).default("NOK"),
  description: z.string().min(2).max(200),
});

/** Default publisher revenue share used for test-mode projections. */
export const PUBLISHER_SHARE = 0.7;

export class BillingService {
  constructor(private db: Database, private clock: Clock, private audit: AuditLog, private campaigns: CampaignService, readonly gateway: PaymentsGateway) {}

  summary() {
    const rows = this.campaigns.list().filter((c) => c.kind === "external" || c.pricing.model !== "none");
    const perCampaign = rows.map((c) => {
      const imps = this.db.get<{ n: number }>("SELECT COUNT(*) n FROM events WHERE campaign_id = ? AND type = 'impression' AND simulated = 0 AND invalid_reason IS NULL", c.id)!.n;
      const clicks = this.db.get<{ n: number }>("SELECT COUNT(*) n FROM events WHERE campaign_id = ? AND type = 'click' AND simulated = 0 AND invalid_reason IS NULL", c.id)!.n;
      const rate = c.pricing.rateMinor ?? 0;
      let spend = 0;
      if (c.pricing.model === "cpm") spend = Math.round((imps / 1000) * rate);
      else if (c.pricing.model === "cpc") spend = clicks * rate;
      else if (c.pricing.model === "fixed") spend = c.pricing.budgetMinor ?? 0;
      if (c.pricing.budgetMinor != null) spend = Math.min(spend, c.pricing.budgetMinor);
      return {
        campaignId: c.id, name: c.name, model: c.pricing.model, currency: c.pricing.currency, budgetMinor: c.pricing.budgetMinor,
        rateMinor: c.pricing.rateMinor, impressions: imps, clicks, spendMinor: spend, publisherShareMinor: Math.round(spend * PUBLISHER_SHARE),
      };
    });
    const ledger = this.db.all<Record<string, unknown>>("SELECT * FROM ledger_entries ORDER BY at DESC LIMIT 200").map((r) => ({
      id: r.id, at: r.at, kind: r.kind, campaignId: r.campaign_id, advertiserId: r.advertiser_id, amountMinor: r.amount_minor,
      currency: r.currency, testMode: r.test_mode === 1, description: r.description,
    }));
    return {
      mode: "test" as const,
      gateway: this.gateway.status(),
      publisherSharePercent: PUBLISHER_SHARE * 100,
      totals: {
        spendMinor: perCampaign.reduce((a, b) => a + b.spendMinor, 0),
        publisherShareMinor: perCampaign.reduce((a, b) => a + b.publisherShareMinor, 0),
      },
      campaigns: perCampaign,
      ledger,
    };
  }

  addEntry(input: unknown, actor: AuditActor) {
    const e = LedgerInput.parse(input);
    const id = newId("led");
    this.db.run(
      "INSERT INTO ledger_entries (id, at, kind, campaign_id, advertiser_id, amount_minor, currency, test_mode, description, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
      id, this.clock.now().toISOString(), e.kind, e.campaignId, e.advertiserId, e.amountMinor, e.currency, `[TEST] ${e.description}`, actor.subject,
    );
    this.audit.record(actor, "billing.test_entry", "ledger", id, `Test-mode ${e.kind}: ${e.amountMinor / 100} ${e.currency}`);
    return id;
  }
}
