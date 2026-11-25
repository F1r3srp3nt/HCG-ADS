import type { Database } from "../db/database.ts";
import type { Clock } from "../core/clock.ts";
import { Sealer, randomToken, sha256 } from "../core/sealing.ts";

export interface WebSession {
  idHash: string;
  subject: string;
  displayName: string;
  email: string | null;
  organisationId: string | null;
  founderPolicy: boolean;
  accessToken: string;
  refreshToken: string | null;
  accessExpiresAt: Date;
  csrfToken: string;
  expiresAt: Date;
}

/** Absolute session lifetime and idle timeout. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;
export const AUTH_REQUEST_TTL_MS = 10 * 60 * 1000;

/**
 * Server-owned HCG Connect sessions. The browser only holds an opaque, random
 * session identifier in an HttpOnly cookie; the database stores its SHA-256 and the
 * HCG tokens sealed with AES-256-GCM. Tokens never reach browser JavaScript or URLs.
 */
export class WebSessionStore {
  private sealer: Sealer;
  constructor(private db: Database, private clock: Clock, secret: Buffer) {
    this.sealer = new Sealer(secret, "web-session-tokens");
  }

  createAuthRequest(input: { state: string; nonce: string; verifier: string; returnTo: string }) {
    const now = this.clock.now();
    this.db.run("DELETE FROM auth_requests WHERE expires_at < ?", now.toISOString());
    this.db.run("INSERT INTO auth_requests (state_hash, nonce, verifier_enc, return_to, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      sha256(input.state), input.nonce, this.sealer.seal(input.verifier), input.returnTo, now.toISOString(),
      new Date(now.getTime() + AUTH_REQUEST_TTL_MS).toISOString());
  }

  /** One-time: the request is deleted whether or not it is still valid. */
  consumeAuthRequest(state: string): { nonce: string; verifier: string; returnTo: string } | null {
    const h = sha256(state);
    const r = this.db.get<{ nonce: string; verifier_enc: string; return_to: string; expires_at: string }>("SELECT * FROM auth_requests WHERE state_hash = ?", h);
    this.db.run("DELETE FROM auth_requests WHERE state_hash = ?", h);
    if (!r || new Date(r.expires_at) < this.clock.now()) return null;
    return { nonce: r.nonce, verifier: this.sealer.open(r.verifier_enc), returnTo: r.return_to };
  }

  create(s: Omit<WebSession, "idHash" | "csrfToken" | "expiresAt">): { sessionId: string; session: WebSession } {
    const sessionId = randomToken(32);
    const now = this.clock.now();
    const session: WebSession = { ...s, idHash: sha256(sessionId), csrfToken: randomToken(24), expiresAt: new Date(now.getTime() + SESSION_TTL_MS) };
    this.db.run(
      `INSERT INTO web_sessions (id_hash, subject, display_name, email, organisation_id, founder_policy, access_token_enc, refresh_token_enc,
         access_expires_at, csrf_token, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      session.idHash, s.subject, s.displayName, s.email, s.organisationId, s.founderPolicy ? 1 : 0, this.sealer.seal(s.accessToken),
      s.refreshToken ? this.sealer.seal(s.refreshToken) : null, s.accessExpiresAt.toISOString(), session.csrfToken,
      now.toISOString(), now.toISOString(), session.expiresAt.toISOString(),
    );
    return { sessionId, session };
  }

  load(sessionId: string): WebSession | null {
    if (!sessionId || sessionId.length > 200) return null;
    const r = this.db.get<Record<string, string | number | null>>("SELECT * FROM web_sessions WHERE id_hash = ?", sha256(sessionId));
    if (!r) return null;
    const now = this.clock.now();
    if (new Date(String(r.expires_at)) < now || now.getTime() - new Date(String(r.last_seen_at)).getTime() > SESSION_IDLE_MS) {
      this.db.run("DELETE FROM web_sessions WHERE id_hash = ?", r.id_hash);
      return null;
    }
    this.db.run("UPDATE web_sessions SET last_seen_at = ? WHERE id_hash = ?", now.toISOString(), r.id_hash);
    return {
      idHash: String(r.id_hash), subject: String(r.subject), displayName: String(r.display_name), email: (r.email as string) ?? null,
      organisationId: (r.organisation_id as string) ?? null, founderPolicy: r.founder_policy === 1,
      accessToken: this.sealer.open(String(r.access_token_enc)), refreshToken: r.refresh_token_enc ? this.sealer.open(String(r.refresh_token_enc)) : null,
      accessExpiresAt: new Date(String(r.access_expires_at)), csrfToken: String(r.csrf_token), expiresAt: new Date(String(r.expires_at)),
    };
  }

  updateTokens(idHash: string, accessToken: string, refreshToken: string | null, accessExpiresAt: Date) {
    this.db.run("UPDATE web_sessions SET access_token_enc = ?, refresh_token_enc = COALESCE(?, refresh_token_enc), access_expires_at = ? WHERE id_hash = ?",
      this.sealer.seal(accessToken), refreshToken ? this.sealer.seal(refreshToken) : null, accessExpiresAt.toISOString(), idHash);
  }

  destroy(sessionId: string) {
    this.db.run("DELETE FROM web_sessions WHERE id_hash = ?", sha256(sessionId));
  }

  destroyByHash(idHash: string) {
    this.db.run("DELETE FROM web_sessions WHERE id_hash = ?", idHash);
  }
}
