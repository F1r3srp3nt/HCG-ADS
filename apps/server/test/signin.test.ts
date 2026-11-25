import { describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { harness } from "./helpers.ts";

const ISSUER = "https://qggdyzoydveafkmjgkpq.supabase.co/auth/v1";
const CLIENT = "11111111-2222-4333-8444-555555555555";
const SUB = "ecf223e3-13d9-4186-ac84-06fb9a058cd6";
const ORG = "2bdefe45-3bf4-466a-865e-8d4b4ac17462";
const BASE = "http://127.0.0.1:7800";

/**
 * A simulated HCG Connect identity provider and Ecosystem API, following the verified
 * contracts (managed OAuth discovery, PKCE S256, nonce, `aud` = client for ID tokens and
 * `authenticated` for access tokens, `/me`, `/check`). Real ES256 signatures.
 */
async function fakeHcg(opts: { roles?: Record<string, boolean>; webClient?: boolean } = {}) {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256" }] });
  const pending = new Map<string, { challenge: string; nonce: string; redirect: string }>();
  const refreshTokens = new Set<string>();
  const state = { tokenCalls: 0, refreshCalls: 0, checks: [] as any[], wrongNonce: false, revoked: false, accessTtl: 3600 };

  const sign = (claims: Record<string, unknown>, aud: string, ttl: number) => new SignJWT(claims).setProtectedHeader({ alg: "ES256", kid: "k1" })
    .setIssuer(ISSUER).setAudience(aud).setSubject(SUB).setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) + ttl).sign(privateKey);
  const issue = async (nonce: string | null) => {
    const refresh = randomUUID();
    refreshTokens.add(refresh);
    return Response.json({
      access_token: await sign({ role: "authenticated", client_id: CLIENT, email: "founder@example.com", session_id: randomUUID() }, "authenticated", state.accessTtl),
      id_token: nonce === null ? undefined : await sign({ nonce: state.wrongNonce ? "other" : nonce, email: "founder@example.com" }, CLIENT, 3600),
      refresh_token: refresh, token_type: "bearer", expires_in: state.accessTtl,
    });
  };

  const fetchImpl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/.well-known/openid-configuration")) {
      return Response.json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/oauth/authorize`, token_endpoint: `${ISSUER}/oauth/token`,
        jwks_uri: `${ISSUER}/.well-known/jwks.json`, userinfo_endpoint: `${ISSUER}/oauth/userinfo`, code_challenge_methods_supported: ["S256", "plain"],
        token_endpoint_auth_methods_supported: ["none", "client_secret_post"] });
    }
    if (url.pathname.endsWith("/oauth/token")) {
      const p = new URLSearchParams(String(init.body));
      if (p.get("client_id") !== CLIENT) return Response.json({ error: "invalid_client" }, { status: 401 });
      if (p.get("grant_type") === "authorization_code") {
        state.tokenCalls++;
        const req = pending.get(p.get("code") ?? "");
        pending.delete(p.get("code") ?? "");
        const verifier = p.get("code_verifier") ?? "";
        if (!req || req.redirect !== p.get("redirect_uri") || createHash("sha256").update(verifier).digest("base64url") !== req.challenge) {
          return Response.json({ error: "invalid_grant" }, { status: 400 });
        }
        return issue(req.nonce);
      }
      if (p.get("grant_type") === "refresh_token") {
        state.refreshCalls++;
        const rt = p.get("refresh_token") ?? "";
        if (state.revoked || !refreshTokens.delete(rt)) return Response.json({ error: "invalid_grant" }, { status: 400 });
        return issue(null);
      }
    }
    if (url.pathname.endsWith("/ecosystem/v1/me")) {
      if (state.revoked) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
      return Response.json({ api_version: "v1", user: { id: SUB, email: "founder@example.com", display_name: "F1r3srp3nt - CEO & Founder" },
        organisations: [{ org_id: ORG, slug: "hcg", name: "Hakmi Capital Group" }], product_policy: { active: true }, revalidate_after_seconds: 60 });
    }
    if (url.pathname.endsWith("/ecosystem/v1/check")) {
      const b = JSON.parse(String(init.body));
      state.checks.push(b);
      if (state.revoked) return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
      const roles = opts.roles ?? { "ads.founder": true };
      return Response.json({ api_version: "v1", allowed: roles[b.feature_key] === true, layer: null, reason: null });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;

  /** The person approves consent at HCG: returns the callback URL HCG would redirect to. */
  const consent = (authorizeUrl: string) => {
    const u = new URL(authorizeUrl);
    const code = randomUUID();
    pending.set(code, { challenge: u.searchParams.get("code_challenge")!, nonce: u.searchParams.get("nonce")!, redirect: u.searchParams.get("redirect_uri")! });
    return `/auth/callback?code=${code}&state=${encodeURIComponent(u.searchParams.get("state")!)}`;
  };

  const h = await harness({
    fetch: fetchImpl, jwks,
    config: {
      identity: { mode: "hcg-connect", hcgConnect: {
        contractVersion: "hcg.ads.connect/1", issuer: ISSUER, jwksEndpoint: `${ISSUER}/.well-known/jwks.json`,
        apiBaseUrl: "https://beta.hakmicapitalgroup.com", ecosystemApiPath: "/api/public/ecosystem/v1", productId: "hcg.ads",
        roleFeatures: { founder: "ads.founder", campaign_manager: "ads.campaign_manager", analytics_viewer: "ads.analytics_viewer" },
        trustedClientIds: [], organisationId: ORG,
        webClient: opts.webClient === false ? null : { clientId: CLIENT, redirectUri: `${BASE}/auth/callback` },
      } },
    },
  });
  return { h, state, consent, fetchImpl };
}

const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];

describe("HCG Connect web sign-in (authorization code + PKCE, server-owned session)", () => {
  it("signs in, keeps tokens server-side, and authorises from ERP App Access", async () => {
    const { h, state, consent } = await fakeHcg();
    const login = await h.app.request("/auth/login?return=/%23/campaigns");
    expect(login.status).toBe(302);
    const authorize = new URL(login.headers.get("location")!);
    expect(authorize.origin + authorize.pathname).toBe(`${ISSUER}/oauth/authorize`);
    const q = authorize.searchParams;
    expect(Object.fromEntries(q)).toMatchObject({ response_type: "code", client_id: CLIENT, redirect_uri: `${BASE}/auth/callback`, scope: "openid email profile", code_challenge_method: "S256" });
    expect(q.get("state")!.length).toBeGreaterThan(30);
    expect(q.get("nonce")!.length).toBeGreaterThan(30);

    const cb = await h.app.request(consent(login.headers.get("location")!));
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toBe("/#/campaigns");
    const setCookie = cb.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/^hcg_ads_session=[A-Za-z0-9_-]{40,};/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).not.toMatch(/eyJ/); // no token in the cookie
    const cookie = cookieOf(cb);
    expect(state.tokenCalls).toBe(1);

    // Tokens are stored sealed, never in plain text.
    const row = h.ctx.db.get<{ access_token_enc: string }>("SELECT access_token_enc FROM web_sessions");
    expect(row!.access_token_enc).not.toMatch(/eyJ/);

    const session = await h.api("GET", "/admin/v1/session", undefined, { cookie });
    expect(session.status).toBe(200);
    expect(session.body.principal).toMatchObject({ subject: SUB, displayName: "F1r3srp3nt - CEO & Founder", authority: "hcg-connect", roles: ["founder"], organisationId: ORG });
    expect(session.body.csrfToken).toBeTruthy();
    expect(JSON.stringify(session.body)).not.toMatch(/eyJ/); // tokens never reach the browser
    expect(state.checks.every((c) => c.org_id === ORG && c.product_id === "hcg.ads")).toBe(true);

    // State-changing requests need the session's CSRF token and HCG ADS's own origin.
    const body = { active: false };
    expect((await h.api("POST", "/admin/v1/governance/emergency", body, { cookie })).body.error.code).toBe("csrf");
    expect((await h.api("POST", "/admin/v1/governance/emergency", body, { cookie, "x-hcg-ads-csrf": session.body.csrfToken, origin: "https://evil.example" })).body.error.code).toBe("bad_origin");
    const before = state.checks.length;
    const ok = await h.api("POST", "/admin/v1/governance/emergency", body, { cookie, "x-hcg-ads-csrf": session.body.csrfToken, origin: BASE });
    expect(ok.status).toBe(200);
    expect(state.checks.length).toBeGreaterThan(before); // fresh central check for a consequential action

    // The state is single-use.
    const replay = await h.app.request(`/auth/callback?code=x&state=${encodeURIComponent(q.get("state")!)}`);
    expect(replay.status).toBe(400);

    // Sign-out ends the HCG ADS session (HCG offers no end-session endpoint).
    const out = await h.app.request("/auth/logout", { method: "POST", headers: { cookie, origin: BASE } });
    expect(await out.json()).toMatchObject({ signedOut: true, hcgSessionEnded: false });
    expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect((await h.api("GET", "/admin/v1/session", undefined, { cookie })).status).toBe(401);
  });

  it("refuses a wrong nonce, a forged state and open redirects", async () => {
    const { h, state, consent } = await fakeHcg();
    state.wrongNonce = true;
    const login = await h.app.request("/auth/login");
    expect((await h.app.request(consent(login.headers.get("location")!))).status).toBe(401);
    expect(h.ctx.db.get<{ n: number }>("SELECT count(*) n FROM web_sessions")!.n).toBe(0);
    expect((await h.app.request("/auth/callback?code=x&state=forged")).status).toBe(400);
    state.wrongNonce = false;
    for (const target of ["https://evil.example", "//evil.example", "/\\evil", "javascript:alert(1)"]) {
      const l = await h.app.request(`/auth/login?return=${encodeURIComponent(target)}`);
      const cb = await h.app.request(consent(l.headers.get("location")!));
      expect(cb.headers.get("location")).toBe("/");
    }
  });

  it("refreshes an expiring access token and ends the session when HCG revokes it", async () => {
    const { h, state, consent } = await fakeHcg();
    h.clock.set(new Date()); // token times come from the real clock in this test
    state.accessTtl = 30; // already within the refresh window
    const login = await h.app.request("/auth/login");
    const cookie = cookieOf(await h.app.request(consent(login.headers.get("location")!)));
    expect((await h.api("GET", "/admin/v1/session", undefined, { cookie })).status).toBe(200);
    expect(state.refreshCalls).toBe(1);
    state.revoked = true;
    const r = await h.api("GET", "/admin/v1/session", undefined, { cookie });
    expect(r.status).toBe(401);
    expect(h.ctx.db.get<{ n: number }>("SELECT count(*) n FROM web_sessions")!.n).toBe(0);
  });

  it("an account without an HCG ADS role gets nothing", async () => {
    const { h, consent } = await fakeHcg({ roles: {} });
    const login = await h.app.request("/auth/login");
    const cookie = cookieOf(await h.app.request(consent(login.headers.get("location")!)));
    const r = await h.api("GET", "/admin/v1/session", undefined, { cookie });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("no_hcg_ads_role");
  });

  it("is unavailable, not improvised, until HCG issues the web client", async () => {
    const { h } = await fakeHcg({ webClient: false });
    const r = await h.api("GET", "/auth/login");
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("sign_in_unavailable");
    expect((await h.api("GET", "/auth/status")).body).toMatchObject({ mode: "hcg-connect", signInAvailable: false });
  });
});
