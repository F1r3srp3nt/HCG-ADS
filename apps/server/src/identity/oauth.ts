import { createHash } from "node:crypto";
import { jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { AppError } from "../core/errors.ts";
import { randomToken } from "../core/sealing.ts";

/**
 * HCG Connect managed OAuth client for the HCG ADS web application, as the shared
 * authentication contract requires for separate web apps: authorization code with
 * PKCE S256, fresh state and nonce, scopes `openid email profile`, an exact
 * registered callback, endpoints taken from the provider's discovery, and
 * verification of issuer, signature, expiry and audience on every token.
 * The provider has no revocation or end-session endpoint; none is invented.
 */
export interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  code_challenge_methods_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
}

export interface WebClientConfig {
  clientId: string;
  redirectUri: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  idClaims: JWTPayload | null;
  accessClaims: JWTPayload;
}

export const SCOPES = "openid email profile";

export function pkcePair() {
  const verifier = randomToken(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export class HcgOAuthClient {
  private discovery: Discovery | null = null;

  constructor(
    private issuer: string,
    private client: WebClientConfig,
    private jwks: () => JWTVerifyGetKey,
    private fetchImpl: typeof fetch = fetch,
    private now: () => Date = () => new Date(),
  ) {}

  /** Loads and checks the provider's OpenID discovery (cached for the process lifetime). */
  async discover(): Promise<Discovery> {
    if (this.discovery) return this.discovery;
    const url = `${this.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
    let d: Discovery;
    try {
      const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(10_000), headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      d = (await res.json()) as Discovery;
    } catch (e) {
      throw new AppError(503, "hcg_unavailable", `HCG Connect discovery could not be read (${(e as Error).message}). Sign-in is unavailable.`);
    }
    const base = this.issuer.replace(/\/$/, "");
    const under = (u?: string) => typeof u === "string" && u.startsWith(base + "/");
    if (d.issuer !== base || !under(d.authorization_endpoint) || !under(d.token_endpoint) || !under(d.jwks_uri)) {
      throw new AppError(503, "discovery_mismatch", "HCG Connect discovery does not match the configured issuer. Sign-in refused.");
    }
    if (d.code_challenge_methods_supported && !d.code_challenge_methods_supported.includes("S256")) {
      throw new AppError(503, "discovery_mismatch", "HCG Connect does not advertise PKCE S256. Sign-in refused.");
    }
    this.discovery = d;
    return d;
  }

  async authorizationUrl(state: string, nonce: string, challenge: string): Promise<string> {
    const d = await this.discover();
    const u = new URL(d.authorization_endpoint);
    u.search = new URLSearchParams({
      response_type: "code",
      client_id: this.client.clientId,
      redirect_uri: this.client.redirectUri,
      scope: SCOPES,
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    return u.toString();
  }

  private async tokenRequest(params: Record<string, string>): Promise<Record<string, unknown>> {
    const d = await this.discover();
    let res: Response;
    try {
      res = await this.fetchImpl(d.token_endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({ ...params, client_id: this.client.clientId }).toString(),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new AppError(503, "hcg_unavailable", "HCG Connect could not be reached.");
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new AppError(401, "token_exchange_failed", "HCG Connect did not accept the sign-in. Please sign in again.");
    return body;
  }

  /** Exchanges the authorization code (with the PKCE verifier) and verifies both tokens. */
  async exchange(code: string, verifier: string, nonce: string): Promise<TokenSet> {
    const t = await this.tokenRequest({ grant_type: "authorization_code", code, redirect_uri: this.client.redirectUri, code_verifier: verifier });
    return this.verifyTokens(t, nonce);
  }

  async refresh(refreshToken: string): Promise<TokenSet> {
    const t = await this.tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
    return this.verifyTokens(t, null);
  }

  private async verifyTokens(t: Record<string, unknown>, nonce: string | null): Promise<TokenSet> {
    const d = await this.discover();
    if (typeof t.access_token !== "string") throw new AppError(401, "token_exchange_failed", "HCG Connect returned no access token.");
    const fail = () => new AppError(401, "invalid_token", "The HCG Connect tokens could not be verified. Sign-in refused.");
    let idClaims: JWTPayload | null = null;
    if (nonce !== null) {
      if (typeof t.id_token !== "string") throw fail();
      try {
        ({ payload: idClaims } = await jwtVerify(t.id_token, this.jwks(), { issuer: d.issuer, audience: this.client.clientId, clockTolerance: 60, currentDate: this.now() }));
      } catch { throw fail(); }
      if (idClaims.nonce !== nonce) throw fail();
    }
    let accessClaims: JWTPayload;
    try {
      ({ payload: accessClaims } = await jwtVerify(t.access_token, this.jwks(), { issuer: d.issuer, audience: "authenticated", clockTolerance: 60, currentDate: this.now() }));
    } catch { throw fail(); }
    if (accessClaims.role !== "authenticated" || typeof accessClaims.sub !== "string") throw fail();
    if (idClaims && idClaims.sub !== accessClaims.sub) throw fail();
    if (accessClaims.client_id !== undefined && accessClaims.client_id !== this.client.clientId) throw fail();
    const exp = typeof accessClaims.exp === "number" ? new Date(accessClaims.exp * 1000) : new Date(this.now().getTime() + 300_000);
    return { accessToken: t.access_token, refreshToken: typeof t.refresh_token === "string" ? t.refresh_token : null, expiresAt: exp, idClaims, accessClaims };
  }
}
