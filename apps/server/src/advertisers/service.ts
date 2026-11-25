import { z } from "zod";
import type { Advertiser } from "@hcg-ads/contracts";
import type { Database } from "../db/database.ts";
import type { Clock } from "../core/clock.ts";
import type { AuditActor, AuditLog } from "../core/audit.ts";
import { notFound } from "../core/errors.ts";
import { newId } from "../core/ids.ts";
import { checkDestinationUrl } from "../core/url-policy.ts";

export const HCG_INTERNAL_ADVERTISER_ID = "adv_hcg_internal";

export const AdvertiserInput = z.object({
  name: z.string().min(2).max(120),
  kind: z.enum(["internal", "external"]).default("external"),
  accountSubject: z.string().max(80).nullable().default(null),
  contactEmail: z.string().email().nullable().default(null),
  website: z.string().nullable().default(null).refine((v) => !v || checkDestinationUrl(v).ok, "The website must be an https:// URL."),
  storageQuotaBytes: z.number().int().min(0).optional(),
});

function map(r: Record<string, unknown>, used: number): Advertiser {
  return {
    id: String(r.id),
    name: String(r.name),
    kind: r.kind as Advertiser["kind"],
    status: r.status as Advertiser["status"],
    accountSubject: (r.account_subject as string) ?? null,
    contactEmail: (r.contact_email as string) ?? null,
    website: (r.website as string) ?? null,
    storageQuotaBytes: Number(r.storage_quota_bytes),
    storageUsedBytes: used,
    createdAt: String(r.created_at),
  };
}

/** Advertiser Manager. Advertiser accounts link to HCG Connect subjects; no separate account system. */
export class AdvertiserService {
  constructor(private db: Database, private clock: Clock, private audit: AuditLog, private defaultQuota: () => number) {
    if (!this.db.get("SELECT id FROM advertisers WHERE id = ?", HCG_INTERNAL_ADVERTISER_ID)) {
      this.db.run(
        "INSERT INTO advertisers (id, name, kind, status, storage_quota_bytes, created_at) VALUES (?, 'Hakmi Capital Group', 'internal', 'approved', ?, ?)",
        HCG_INTERNAL_ADVERTISER_ID, 5 * 1024 * 1024 * 1024, this.clock.now().toISOString(),
      );
    }
  }

  private used(id: string): number {
    return this.db.get<{ n: number }>("SELECT COALESCE(SUM(bytes), 0) n FROM media_assets WHERE owner_advertiser_id = ? AND deleted_at IS NULL", id)?.n ?? 0;
  }

  list(): Advertiser[] {
    return this.db.all<Record<string, unknown>>("SELECT * FROM advertisers ORDER BY kind DESC, created_at").map((r) => map(r, this.used(String(r.id))));
  }

  get(id: string): Advertiser {
    const r = this.db.get<Record<string, unknown>>("SELECT * FROM advertisers WHERE id = ?", id);
    if (!r) throw notFound("Advertiser");
    return map(r, this.used(id));
  }

  create(input: unknown, actor: AuditActor): Advertiser {
    const a = AdvertiserInput.parse(input);
    const id = newId("adv");
    this.db.run(
      "INSERT INTO advertisers (id, name, kind, status, account_subject, contact_email, website, storage_quota_bytes, created_at) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)",
      id, a.name, a.kind, a.accountSubject, a.contactEmail, a.website, a.storageQuotaBytes ?? this.defaultQuota(), this.clock.now().toISOString(),
    );
    this.audit.record(actor, "advertiser.create", "advertiser", id, `Registered advertiser ${a.name} (pending approval)`);
    return this.get(id);
  }

  update(id: string, input: unknown, actor: AuditActor): Advertiser {
    const cur = this.get(id);
    const a = AdvertiserInput.parse({ ...cur, ...(input as object) });
    this.db.run("UPDATE advertisers SET name = ?, account_subject = ?, contact_email = ?, website = ?, storage_quota_bytes = ? WHERE id = ?",
      a.name, a.accountSubject, a.contactEmail, a.website, a.storageQuotaBytes ?? cur.storageQuotaBytes, id);
    this.audit.record(actor, "advertiser.update", "advertiser", id, `Updated ${a.name}`);
    return this.get(id);
  }

  setStatus(id: string, status: Advertiser["status"], actor: AuditActor, note?: string): Advertiser {
    const cur = this.get(id);
    this.db.run("UPDATE advertisers SET status = ? WHERE id = ?", status, id);
    this.audit.record(actor, `advertiser.${status}`, "advertiser", id, `${cur.name}: ${cur.status} → ${status}${note ? ` (${note})` : ""}`);
    return this.get(id);
  }
}
