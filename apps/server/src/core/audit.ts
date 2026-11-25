import type { Principal } from "@hcg-ads/contracts";
import type { Database } from "../db/database.ts";
import { json } from "../db/database.ts";
import type { Clock } from "./clock.ts";
import { newId } from "./ids.ts";

export interface AuditActor {
  subject: string;
  displayName: string;
  authority: string;
}

export const SYSTEM_ACTOR: AuditActor = { subject: "system", displayName: "HCG ADS (automatic)", authority: "system" };

export function actorOf(p: Principal): AuditActor {
  return { subject: p.subject, displayName: p.displayName, authority: p.authority };
}

/** Append-only audit trail for every consequential operation. */
export class AuditLog {
  constructor(private db: Database, private clock: Clock) {}

  record(actor: AuditActor, action: string, entityType: string, entityId: string | null, summary: string, details?: unknown): void {
    this.db.run(
      `INSERT INTO audit_log (id, at, actor_subject, actor_name, authority, action, entity_type, entity_id, summary, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId("aud"), this.clock.now().toISOString(), actor.subject, actor.displayName, actor.authority,
      action, entityType, entityId, summary, details === undefined ? null : json.str(details),
    );
  }

  list(opts: { limit?: number; entityType?: string; entityId?: string } = {}) {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (opts.entityType) { where.push("entity_type = ?"); params.push(opts.entityType); }
    if (opts.entityId) { where.push("entity_id = ?"); params.push(opts.entityId); }
    const sql = `SELECT * FROM audit_log ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY at DESC, rowid DESC LIMIT ?`;
    params.push(Math.min(opts.limit ?? 100, 500));
    return this.db.all<Record<string, unknown>>(sql, ...params).map((r) => ({
      id: r.id, at: r.at, actor: { subject: r.actor_subject, name: r.actor_name, authority: r.authority },
      action: r.action, entityType: r.entity_type, entityId: r.entity_id, summary: r.summary,
      details: json.parse(r.details, null),
    }));
  }
}
