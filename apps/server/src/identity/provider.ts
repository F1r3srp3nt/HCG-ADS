import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { ROLES, ROLE_PERMISSIONS, type Permission, type Principal, type Role } from "@hcg-ads/contracts";
import type { HcgConnectConfig } from "../config.ts";
import { AppError } from "../core/errors.ts";
import { EcosystemClient, FOUNDER_NO_ORG, type EcosystemMe } from "./ecosystem.ts";
import type { HcgOAuthClient } from "./oauth.ts";
import type { WebSessionStore } from "./web-sessions.ts";

/**
 * Identity is interchangeable: HCG Connect in every real deployment, and a
 * clearly labelled development identity on a loopback-only local build.
 * HCG ADS keeps no user database, passwords or role assignments of its own.
 */
export interface IdentityProvider {
  readonly mode: "hcg-connect" | "development";
  status(): { mode: string; configured: boolean; label: string; problems: string[]; signInAvailable?: boolean };
  authenticate(headers: Headers, opts?: { fresh?: boolean }): Promise<Principal>;
}

export function permissionsFor(roles: Role[]): Permission[] {
  return [...new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r] ?? []))];
}

// ---------------------------------------------------------------------------

export class DevelopmentIdentityProvider implements IdentityProvider {
  readonly mode = "development" as const;

  status() {
    return {
      mode: this.mode,
      configured: true,
      label: "LOCAL DEVELOPMENT — not an HCG account",
      problems: ["HCG Connect is not used by this local build. Roles are simulated for development only."],
    };
  }

  async authenticate(headers: Headers): Promise<Principal> {
    // Tests and the role preview in the UI may narrow roles; never widen beyond the role list.
    const requested = (headers.get("x-hcg-dev-roles") ?? "founder")
      .split(",").map((s) => s.trim()).filter((r): r is Role => (ROLES as readonly string[]).includes(r));
    const roles: Role[] = requested.length ? requested : ["founder"];
    return {
      subject: "dev-local-founder",
      displayName: "Local development (not an HCG account)",
      roles,
      permissions: permissionsFor(roles),
      authority: "development",
      organisationId: null,
    };
  }
}

// ---------------------------------------------------------------------------

type CacheEntry = { allowed: boolean; expires: number };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SESSION_COOKIE = "hcg_ads_session";

export interface AuthenticateOptions {
  /** Consequential operations: never use a cached "yes" (authorization contract §4.3). */
  fresh?: boolean;
}

export interface HcgConnectOptions {
  sessions?: WebSessionStore;
  oauth?: HcgOAuthClient;
  ecosystem?: EcosystemClient;
}

export function readCookie(headers: Headers, name: string): string | null {
  const raw = headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name || k === `__Host-${name}`) return decodeURIComponent(v.join("="));
  }
  return null;
}

/**
 * HCG Connect. Two ways in, both verified server-side on every request:
 *  - the HCG ADS web application's server-owned session (HttpOnly cookie, PKCE sign-in);
 *  - an HCG Connect bearer token (API clients), verified against the issuer's JWKS.
 * Identity, organisations and the Founder policy come from HCG's `/me`; HCG ADS roles
 * come from ERP App Access through `/check` with the caller's own token. Nothing is
 * granted locally; any undecided answer fails closed.
 */
export class HcgConnectIdentityProvider implements IdentityProvider {
  readonly mode = "hcg-connect" as const;
  private jwks: JWTVerifyGetKey | null;
  private cache = new Map<string, CacheEntry>();
  private meCache = new Map<string, { me: EcosystemMe; expires: number }>();
  readonly sessions: WebSessionStore | null;
  readonly oauth: HcgOAuthClient | null;
  private ecosystem: EcosystemClient | null;

  constructor(
    private config: HcgConnectConfig | null,
    private problems: string[],
    private fetchImpl: typeof fetch = fetch,
    private now: () => number = Date.now,
    jwks?: JWTVerifyGetKey,
    options: HcgConnectOptions = {},
  ) {
    this.jwks = jwks ?? (config ? createRemoteJWKSet(new URL(config.jwksEndpoint), { cacheMaxAge: 10 * 60 * 1000 }) : null);
    this.sessions = options.sessions ?? null;
    this.oauth = options.oauth ?? null;
    this.ecosystem = options.ecosystem ?? (config ? new EcosystemClient(`${config.apiBaseUrl.replace(/\/$/, "")}${config.ecosystemApiPath.replace(/\/$/, "")}`, fetchImpl) : null);
  }

  get jwksGetter(): JWTVerifyGetKey | null { return this.jwks; }

  status() {
    const signIn = !!(this.config && this.oauth && this.sessions);
    return {
      mode: this.mode,
      configured: !!this.config,
      signInAvailable: signIn,
      label: this.config ? (signIn ? "HCG Connect" : "HCG Connect — web sign-in client not registered") : "HCG Connect — not configured",
      problems: this.problems,
    };
  }

  async authenticate(headers: Headers, opts: AuthenticateOptions = {}): Promise<Principal> {
    if (!this.config || !this.jwks || !this.ecosystem) {
      throw new AppError(503, "hcg_connect_not_configured", "HCG Connect is not configured for HCG ADS. Nothing is allowed until it is.");
    }
    const auth = headers.get("authorization") ?? "";
    if (auth.startsWith("Bearer ")) return this.fromBearer(auth.slice(7).trim(), opts);
    const sid = readCookie(headers, SESSION_COOKIE);
    if (sid && this.sessions) return this.fromSession(sid, opts);
    throw new AppError(401, "unauthenticated", "Sign in with HCG Connect.");
  }

  private async fromBearer(token: string, opts: AuthenticateOptions): Promise<Principal> {
    if (!token) throw new AppError(401, "unauthenticated", "Sign in with HCG Connect.");
    let claims: JWTPayload;
    try {
      ({ payload: claims } = await jwtVerify(token, this.jwks!, { issuer: this.config!.issuer, audience: "authenticated", clockTolerance: 60, currentDate: new Date(this.now()) }));
    } catch (e) {
      const expired = (e as { code?: string }).code === "ERR_JWT_EXPIRED";
      throw new AppError(401, expired ? "token_expired" : "invalid_token", expired ? "Your HCG sign-in has expired." : "The HCG Connect token was not accepted.");
    }
    if (claims.role !== "authenticated" || typeof claims.sub !== "string" || !UUID.test(claims.sub)) {
      throw new AppError(401, "invalid_token", "The HCG Connect token was not accepted.");
    }
    if (this.config!.trustedClientIds.length && !this.config!.trustedClientIds.includes(String(claims.client_id ?? ""))) {
      throw new AppError(403, "untrusted_client", "This application is not registered to use HCG ADS.");
    }
    const me = await this.meFor(claims.sub, token);
    const meta = (claims.user_metadata ?? {}) as Record<string, unknown>;
    return this.principal(claims.sub, me.displayName ?? String(meta.full_name ?? meta.name ?? claims.email ?? "HCG account"),
      me.email ?? (typeof claims.email === "string" ? claims.email : undefined), this.organisationFor(me), token, opts, undefined);
  }

  private async fromSession(sid: string, opts: AuthenticateOptions): Promise<Principal> {
    const s = this.sessions!.load(sid);
    if (!s) throw new AppError(401, "unauthenticated", "Your HCG ADS session has ended. Sign in with HCG Connect.");
    let token = s.accessToken;
    if (s.accessExpiresAt.getTime() - this.now() < 60_000) {
      if (!s.refreshToken || !this.oauth) {
        this.sessions!.destroyByHash(s.idHash);
        throw new AppError(401, "token_expired", "Your HCG sign-in has expired. Sign in again.");
      }
      try {
        const t = await this.oauth.refresh(s.refreshToken);
        if (t.accessClaims.sub !== s.subject) throw new AppError(401, "invalid_token", "Account changed during refresh.");
        this.sessions!.updateTokens(s.idHash, t.accessToken, t.refreshToken, t.expiresAt);
        token = t.accessToken;
      } catch (e) {
        if (e instanceof AppError && e.status === 503) throw e;
        this.sessions!.destroyByHash(s.idHash);
        throw new AppError(401, "hcg_session_ended", "HCG no longer accepts this sign-in. Sign in again.");
      }
    }
    try {
      return await this.principal(s.subject, s.displayName, s.email ?? undefined, s.organisationId ?? (s.founderPolicy ? FOUNDER_NO_ORG : null), token, opts, s.csrfToken);
    } catch (e) {
      if (e instanceof AppError && e.code === "hcg_session_ended") this.sessions!.destroyByHash(s.idHash);
      throw e;
    }
  }

  /** The organisation for central checks: the configured one if the account is a member, else its first. */
  organisationFor(me: EcosystemMe): string | null {
    const wanted = this.config!.organisationId;
    if (wanted && me.organisations.some((o) => o.orgId === wanted)) return wanted;
    if (me.organisations.length) return me.organisations[0].orgId;
    return me.founderPolicy ? FOUNDER_NO_ORG : null;
  }

  async meFor(subject: string, token: string): Promise<EcosystemMe> {
    const hit = this.meCache.get(subject);
    if (hit && hit.expires > this.now()) return hit.me;
    const me = await this.ecosystem!.me(token);
    if (me.userId !== subject) throw new AppError(401, "invalid_token", "HCG reported a different account for this token.");
    this.meCache.set(subject, { me, expires: this.now() + 60_000 });
    return me;
  }

  private async principal(subject: string, displayName: string, email: string | undefined, org: string | null, token: string,
                          opts: AuthenticateOptions, csrfToken: string | undefined): Promise<Principal> {
    if (!org) throw new AppError(403, "no_organisation", "Your HCG account has no organisation for HCG ADS. Access is governed centrally.");
    const roles = await this.rolesFor(subject, org, token, !!opts.fresh);
    if (roles.length === 0) throw new AppError(403, "no_hcg_ads_role", "Your HCG account has no HCG ADS role. Access is granted centrally in HCG (ERP App Access).");
    return {
      subject, displayName, email, roles, permissions: permissionsFor(roles), authority: "hcg-connect",
      organisationId: org === FOUNDER_NO_ORG ? null : org, ...(csrfToken ? { csrfToken } : {}),
    };
  }

  /** Every mapped role is checked; any undecided answer fails the whole check (fails closed). */
  private async rolesFor(subject: string, org: string, token: string, fresh: boolean): Promise<Role[]> {
    const c = this.config!;
    const entries = Object.entries(c.roleFeatures).filter(([r]) => (ROLES as readonly string[]).includes(r)) as Array<[Role, string]>;
    const results = await Promise.all(entries.map(async ([role, feature]) => [role, await this.check(subject, org, token, feature, fresh)] as const));
    return results.filter(([, ok]) => ok).map(([r]) => r);
  }

  private async check(subject: string, org: string, token: string, featureKey: string, fresh: boolean): Promise<boolean> {
    const c = this.config!;
    const key = `${subject}|${org}|${c.productId}|${featureKey}`;
    const hit = this.cache.get(key);
    if (!fresh && hit && hit.expires > this.now()) return hit.allowed;
    let allowed: boolean;
    try {
      allowed = await this.ecosystem!.check(token, org, c.productId, featureKey);
    } catch (e) {
      if (e instanceof AppError && (e.code === "hcg_session_ended" || e.code === "access_revoked")) this.forget(subject);
      throw e;
    }
    this.cache.set(key, { allowed, expires: this.now() + (allowed ? 60_000 : 10_000) });
    return allowed;
  }

  forget(subject: string) {
    for (const k of this.cache.keys()) if (k.startsWith(subject + "|")) this.cache.delete(k);
    this.meCache.delete(subject);
  }
}
