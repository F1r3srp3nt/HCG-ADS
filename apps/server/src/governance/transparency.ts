import type { Database } from "../db/database.ts";
import type { Clock } from "../core/clock.ts";
import type { AuditActor, AuditLog } from "../core/audit.ts";
import { SYSTEM_ACTOR } from "../core/audit.ts";
import { AppError, invalid, notFound } from "../core/errors.ts";
import { newId } from "../core/ids.ts";
import type { CampaignService } from "../campaigns/service.ts";
import type { AdvertiserService } from "../advertisers/service.ts";
import type { PublisherService } from "../publishers/service.ts";

export const REPORT_REASONS = {
  misleading: "Misleading or false",
  imitates_system_warning: "Imitates a system or security warning",
  scam_or_malware: "Scam, phishing or malware",
  offensive: "Offensive or inappropriate",
  not_labelled: "Not clearly labelled as advertising",
  other: "Something else",
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;

/** Reasons serious enough to pause a campaign automatically, pending human review. */
const SERIOUS: ReportReason[] = ["imitates_system_warning", "scam_or_malware"];
export const AUTO_PAUSE_THRESHOLD = 3;

export interface Transparency {
  isAdvertisement: true;
  disclosure: string;
  shownOnBehalfOf: string;
  paidBy: string;
  kind: "internal" | "external";
  mainParameters: string[];
  personalDataUsed: string;
  reportUrl: string;
  reasons: typeof REPORT_REASONS;
}

/**
 * Advertising transparency and reporting (in the spirit of EU DSA Art. 26):
 * every ad says it is an ad, on whose behalf it is shown, who paid for it and the main
 * parameters used to show it; anyone can report it. Nothing about the reader is stored.
 */
export class TransparencyService {
  constructor(
    private db: Database, private clock: Clock, private audit: AuditLog,
    private campaigns: CampaignService, private advertisers: AdvertiserService, private publishers: PublisherService,
    private baseUrl: string,
  ) {}

  explain(claims: { c: string; p: string }, token: string): Transparency {
    const c = this.campaigns.get(claims.c);
    const adv = this.advertisers.get(c.advertiserId);
    const p = this.publishers.placement(claims.p);
    const params = [
      `It was booked for this placement (${p.name}${p.width && p.height ? `, ${p.width} × ${p.height}` : ""}) on ${this.publishers.get(p.publisherId).name}.`,
      ...(c.contextual.categories.length ? [`It targets pages in these sections: ${c.contextual.categories.join(", ")}.`] : ["It is not targeted by page section."]),
      ...(c.frequencyLimit ? [`It is shown at most ${c.frequencyLimit.count} time(s) per ${c.frequencyLimit.windowHours} hours; the count is kept on your device only if you allowed it.`] : []),
      "It was chosen by its priority among the campaigns booked here.",
    ];
    return {
      isAdvertisement: true,
      disclosure: c.disclosureLabel,
      shownOnBehalfOf: adv.name,
      paidBy: c.kind === "internal" ? `${adv.name} (own promotion, not paid)` : adv.name,
      kind: c.kind,
      mainParameters: params,
      personalDataUsed: "None. HCG ADS does not use your identity, browsing history, location or any profile to choose ads. It does not store your IP address, cookies or device identifiers.",
      reportUrl: `${this.baseUrl}/delivery/v1/reports/${token}`,
      reasons: REPORT_REASONS,
    };
  }

  /** Records a report. Serious reports pause the campaign once they reach the threshold, pending review. */
  report(claims: { c: string; r: string; p: string }, reason: string, details: unknown): { id: string; campaignPaused: boolean } {
    if (!(reason in REPORT_REASONS)) throw invalid("Choose a reason.");
    const text = typeof details === "string" ? details.trim().slice(0, 500) : null;
    const id = newId("rpt");
    const now = this.clock.now();
    this.db.run("INSERT INTO ad_reports (id, at, campaign_id, creative_id, placement_id, reason, details) VALUES (?, ?, ?, ?, ?, ?, ?)",
      id, now.toISOString(), claims.c, claims.r, claims.p, reason, text);
    let paused = false;
    if (SERIOUS.includes(reason as ReportReason)) {
      const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
      const n = this.db.get<{ n: number }>(
        `SELECT count(*) n FROM ad_reports WHERE campaign_id = ? AND status = 'open' AND at >= ? AND reason IN (${SERIOUS.map(() => "?").join(",")})`,
        claims.c, since, ...SERIOUS)!.n;
      const c = this.campaigns.get(claims.c);
      if (n >= AUTO_PAUSE_THRESHOLD && (c.state === "active" || c.state === "scheduled")) {
        this.campaigns.pause(c.id, SYSTEM_ACTOR, "reports", `${n} serious reports in 24 h; paused pending review`);
        paused = true;
      }
    }
    return { id, campaignPaused: paused };
  }

  list(status?: string) {
    const rows = this.db.all<Record<string, unknown>>(
      `SELECT r.*, c.name campaign_name, c.state campaign_state FROM ad_reports r LEFT JOIN campaigns c ON c.id = r.campaign_id
       ${status ? "WHERE r.status = ?" : ""} ORDER BY r.at DESC LIMIT 200`, ...(status ? [status] : []));
    return rows.map((r) => ({
      id: r.id, at: r.at, campaignId: r.campaign_id, campaignName: r.campaign_name, campaignState: r.campaign_state, creativeId: r.creative_id,
      placementId: r.placement_id, reason: r.reason, reasonLabel: REPORT_REASONS[r.reason as ReportReason] ?? r.reason, details: r.details,
      status: r.status, resolvedBy: r.resolved_by, resolvedAt: r.resolved_at, resolution: r.resolution,
    }));
  }

  resolve(id: string, resolution: string, action: "none" | "pause_campaign" | "reject_campaign", actor: AuditActor) {
    const r = this.db.get<{ campaign_id: string; status: string }>("SELECT campaign_id, status FROM ad_reports WHERE id = ?", id);
    if (!r) throw notFound("Report");
    if (r.status !== "open") throw new AppError(409, "already_resolved", "This report is already resolved.");
    if (!resolution?.trim()) throw invalid("Describe the outcome of the review.");
    if (action === "pause_campaign") {
      const c = this.campaigns.get(r.campaign_id);
      if (c.state === "active" || c.state === "scheduled") this.campaigns.pause(c.id, actor, "reports", resolution);
    }
    if (action === "reject_campaign") {
      const c = this.campaigns.get(r.campaign_id);
      if (c.state === "active" || c.state === "scheduled") this.campaigns.pause(c.id, actor, "reports", resolution);
      if (["paused", "approved", "pending_approval"].includes(this.campaigns.get(c.id).state)) this.campaigns.revise(c.id, actor);
    }
    this.db.run("UPDATE ad_reports SET status = 'resolved', resolved_by = ?, resolved_at = ?, resolution = ? WHERE id = ?",
      actor.displayName, this.clock.now().toISOString(), `${action}: ${resolution.trim()}`, id);
    this.audit.record(actor, "report.resolve", "ad_report", id, `Report resolved (${action}): ${resolution.trim()}`);
  }
}
