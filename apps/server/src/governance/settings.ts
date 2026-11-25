import type { Database } from "../db/database.ts";
import { json } from "../db/database.ts";
import type { Clock } from "../core/clock.ts";
import type { AuditActor, AuditLog } from "../core/audit.ts";
import { invalid } from "../core/errors.ts";

/** Governance settings. Stored centrally in HCG ADS; changes are audited. */
export interface GovernanceSettings {
  /** Emergency advertising shutdown: nothing is delivered anywhere while true. */
  emergencyShutdown: { active: boolean; reason: string | null; at: string | null; by: string | null };
  /** Days measured events are kept before aggregation-only purge. */
  analyticsRetentionDays: number;
  /** Days deleted media is kept before it is purged from storage. */
  mediaRetentionDays: number;
  /** Default consent assumed when a publisher sends none. */
  defaultConsent: { storage: boolean; measurement: boolean };
  /** Labels allowed for paid/sponsored/promotional disclosures. */
  disclosureLabels: string[];
  /** Phrases that may imitate system/security prompts; creatives containing them are refused. */
  blockedPhrases: string[];
  /** Upload limits. */
  maxImageBytes: number;
  maxVideoBytes: number;
  maxVideoSeconds: number;
  defaultAdvertiserQuotaBytes: number;
}

export const DEFAULT_SETTINGS: GovernanceSettings = {
  emergencyShutdown: { active: false, reason: null, at: null, by: null },
  analyticsRetentionDays: 395,
  mediaRetentionDays: 30,
  defaultConsent: { storage: false, measurement: true },
  disclosureLabels: ["Sponsored", "Promoted", "Advertisement", "Promoted by HCG", "Paid partnership"],
  blockedPhrases: [
    "virus detected", "your computer is infected", "security alert", "system alert", "system warning",
    "your device is at risk", "update required", "critical update", "click to clean", "your iphone has been",
    "your mac is infected", "windows defender", "apple security", "account suspended", "battery damaged",
    "you have won", "congratulations you won", "verify your account", "enter your password",
  ],
  maxImageBytes: 5 * 1024 * 1024,
  maxVideoBytes: 100 * 1024 * 1024,
  maxVideoSeconds: 60,
  defaultAdvertiserQuotaBytes: 500 * 1024 * 1024,
};

export class SettingsService {
  private cache: GovernanceSettings | null = null;
  constructor(private db: Database, private clock: Clock, private audit: AuditLog) {}

  get(): GovernanceSettings {
    if (this.cache) return this.cache;
    const rows = this.db.all<{ key: string; value: string }>("SELECT key, value FROM settings");
    const stored = Object.fromEntries(rows.map((r) => [r.key, json.parse(r.value, null)]));
    this.cache = { ...DEFAULT_SETTINGS, ...stored } as GovernanceSettings;
    return this.cache;
  }

  update(patch: Partial<GovernanceSettings>, actor: AuditActor): GovernanceSettings {
    const allowed = Object.keys(DEFAULT_SETTINGS).filter((k) => k !== "emergencyShutdown");
    const now = this.clock.now().toISOString();
    for (const [k, v] of Object.entries(patch)) {
      if (!allowed.includes(k)) throw invalid(`Unknown or protected setting: ${k}`);
      if (k.endsWith("Days") && (typeof v !== "number" || v < 1 || v > 3650)) throw invalid(`${k} must be between 1 and 3650 days.`);
      if (k === "disclosureLabels" && (!Array.isArray(v) || v.length === 0)) throw invalid("At least one disclosure label is required.");
      this.db.run(
        "INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
        k, json.str(v), now, actor.subject,
      );
    }
    this.cache = null;
    this.audit.record(actor, "settings.update", "settings", null, `Updated ${Object.keys(patch).join(", ")}`, patch);
    return this.get();
  }

  setEmergency(active: boolean, reason: string | null, actor: AuditActor): GovernanceSettings {
    const now = this.clock.now().toISOString();
    const value = { active, reason: active ? reason ?? "Emergency shutdown" : null, at: now, by: actor.displayName };
    this.db.run(
      "INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('emergencyShutdown', ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
      json.str(value), now, actor.subject,
    );
    this.cache = null;
    this.audit.record(actor, active ? "governance.emergency_on" : "governance.emergency_off", "settings", "emergencyShutdown",
      active ? `EMERGENCY SHUTDOWN: ${value.reason}` : "Emergency shutdown lifted");
    return this.get();
  }
}
