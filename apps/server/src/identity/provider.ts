import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { ROLES, ROLE_PERMISSIONS, type Permission, type Principal, type Role } from "@hcg-ads/contracts";
import type { HcgConnectConfig } from "../config.ts";
import { AppError } from "../core/errors.ts";

/**
 * Identity is interchangeable: HCG Connect in every real deployment, and a
 * clearly labelled development identity on a loopback-only local build.
 * HCG ADS keeps no user database, passwords or role assignments of its own.
 */
export interface IdentityProvider {
  readonly mode: "hcg-connect" | "development";
  status(): { mode: string; configured: boolean; label: string; problems: string[] };
  authenticate(headers: Headers): Promise<Principal>;
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

/**
 * HCG Connect: verifies the caller's HCG access token (ES256, issuer JWKS) and
 * asks ERP App Access, through HCG's Ecosystem API with the caller's own token,
 * which HCG ADS roles the account holds. Same contract as HCG Server's Device Link.
 */
export class HcgConnectIdentityProvider implements IdentityProvider {
  readonly mode = "hcg-connect" as const;
  private jwks: JWTVerifyGetKey | null;
  private cache = new Map<string, CacheEntry>();

  constructor(
    private config: HcgConnectConfig | null,
    private problems: string[],
    private fetchImpl: typeof fetch = fetch,
    private now: () => number = Date.now,
    jwks?: JWTVerifyGetKey,
  ) {
    this.jwks = jwks ?? (config ? createRemoteJWKSet(new URL(config.jwksEndpoint), { cacheMaxAge: 10 * 60 * 1000 }) : null);
  }

  status() {
    return {
      mode: this.mode,
      configured: !!this.config,
      label: this.config ? "HCG Connect" : "HCG Connect — not configured",
      problems: this.problems,
    };
  }

  async authenticate(headers: Headers): Promise<Principal> {
    if (!this.config || !this.jwks) {
      throw new AppError(503, "hcg_connect_not_configured", "HCG Connect is not configured for HCG ADS. Nothing is allowed until it is.");
    }
    const auth = headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!token) throw new AppError(401, "unauthenticated", "Sign in with HCG Connect.");

    let claims: JWTPayload;
    try {
      ({ payload: claims } = await jwtVerify(token, this.jwks, {
        issuer: this.config.issuer,
        audience: "authenticated",
        clockTolerance: 60,
      }));
    } catch (e) {
      const expired = (e as { code?: string }).code === "ERR_JWT_EXPIRED";
      throw new AppError(401, expired ? "token_expired" : "invalid_token", expired ? "Your HCG sign-in has expired." : "The HCG Connect token was not accepted.");
    }
    if (claims.role !== "authenticated" || typeof claims.sub !== "string" || !UUID.test(claims.sub)) {
      throw new AppError(401, "invalid_token", "The HCG Connect token was not accepted.");
    }
    if (this.config.trustedClientIds.length && !this.config.trustedClientIds.includes(String(claims.client_id ?? ""))) {
      throw new AppError(403, "untrusted_client", "This application is not registered to use HCG ADS.");
    }

    const roles = await this.rolesFor(claims.sub, token);
    if (roles.length === 0) throw new AppError(403, "no_hcg_ads_role", "Your HCG account has no HCG ADS role. Access is granted centrally in HCG (ERP App Access).");
    const meta = (claims.user_metadata ?? {}) as Record<string, unknown>;
    return {
      subject: claims.sub,
      displayName: String(meta.full_name ?? meta.name ?? claims.email ?? "HCG account"),
      email: typeof claims.email === "string" ? claims.email : undefined,
      roles,
      permissions: permissionsFor(roles),
      authority: "hcg-connect",
      organisationId: this.config.organisationId,
    };
  }

  /** Every mapped role is checked; any undecided answer fails the whole check (fails closed). */
  private async rolesFor(subject: string, token: string): Promise<Role[]> {
    const c = this.config!;
    const entries = Object.entries(c.roleFeatures).filter(([r]) => (ROLES as readonly string[]).includes(r)) as Array<[Role, string]>;
    const results = await Promise.all(entries.map(async ([role, feature]) => [role, await this.check(subject, token, feature)] as const));
    return results.filter(([, ok]) => ok).map(([r]) => r);
  }

  private async check(subject: string, token: string, featureKey: string): Promise<boolean> {
    const c = this.config!;
    const key = `${subject}|${c.organisationId ?? ""}|${c.productId}|${featureKey}`;
    const hit = this.cache.get(key);
    if (hit && hit.expires > this.now()) return hit.allowed;

    let res: Response;
    try {
      res = await this.fetchImpl(`${c.apiBaseUrl.replace(/\/$/, "")}${c.ecosystemApiPath.replace(/\/$/, "")}/check`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ org_id: c.organisationId, product_id: c.productId, feature_key: featureKey }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AppError(503, "hcg_unavailable", "HCG could not be reached to check your access; nothing was allowed.");
    }
    if (res.status === 401) {
      this.forget(subject);
      throw new AppError(401, "hcg_session_ended", "HCG no longer accepts this sign-in. Sign in to HCG Connect again.");
    }
    let allowed = false;
    if (res.status === 200) {
      const body = (await res.json().catch(() => ({}))) as { allowed?: unknown };
      allowed = body.allowed === true;
    } else if (res.status === 403) {
      allowed = false;
    } else {
      throw new AppError(503, "hcg_unavailable", `HCG could not check your access (HTTP ${res.status}); nothing was allowed.`);
    }
    this.cache.set(key, { allowed, expires: this.now() + (allowed ? 60_000 : 10_000) });
    return allowed;
  }

  forget(subject: string) {
    for (const k of this.cache.keys()) if (k.startsWith(subject + "|")) this.cache.delete(k);
  }
}
