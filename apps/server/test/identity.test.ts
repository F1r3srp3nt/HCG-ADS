import { describe, expect, it } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from "jose";
import { HcgConnectIdentityProvider } from "../src/identity/provider.ts";
import { assertSafe, validateHcgConnectConfig, validateHcgNewsConfig } from "../src/config.ts";
import { checkDestinationUrl } from "../src/core/url-policy.ts";
import { harness, testConfig, ANON_KEY } from "./helpers.ts";

const ISSUER = "https://qggdyzoydveafkmjgkpq.supabase.co/auth/v1";
const SUB = "3f1c2b8e-1111-4222-8333-944455556666";
const cfg = {
  contractVersion: "hcg.ads.connect/1" as const, issuer: ISSUER, jwksEndpoint: `${ISSUER}/.well-known/jwks.json`,
  apiBaseUrl: "https://beta.hakmicapitalgroup.com", ecosystemApiPath: "/api/public/ecosystem/v1", productId: "hcg.ads",
  roleFeatures: { campaign_manager: "ads.campaign_manager", creative_reviewer: "ads.creative_reviewer" }, trustedClientIds: [], organisationId: null, webClient: null,
};

async function setup(answer: (feature: string) => Response | Promise<Response>) {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256" };
  const jwks = createLocalJWKSet({ keys: [jwk] });
  const calls: any[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    if (String(url).endsWith("/me")) {
      return Response.json({ api_version: "v1", user: { id: SUB, email: "founder@example.com", display_name: "Founder" },
        organisations: [{ org_id: "2bdefe45-3bf4-466a-865e-8d4b4ac17462", slug: "hcg" }], product_policy: { active: false } });
    }
    const body = JSON.parse(String(init.body));
    calls.push({ body, auth: (init.headers as Record<string, string>).authorization });
    return answer(body.feature_key);
  }) as unknown as typeof fetch;
  const provider = new HcgConnectIdentityProvider(cfg, [], fetchImpl, Date.now, jwks);
  const token = (claims: Record<string, unknown> = {}, exp = "5m") => new SignJWT({ role: "authenticated", email: "founder@example.com", ...claims })
    .setProtectedHeader({ alg: "ES256", kid: "k1" }).setIssuer(ISSUER).setAudience("authenticated").setSubject(SUB).setIssuedAt().setExpirationTime(exp).sign(privateKey);
  return { provider, token, calls };
}
const h = (t: string) => new Headers({ authorization: `Bearer ${t}` });

describe("HCG Connect identity (fails closed)", () => {
  it("grants exactly the roles ERP App Access allows, using the caller's own token", async () => {
    const { provider, token, calls } = await setup((f) => Response.json({ allowed: f === "ads.campaign_manager" }));
    const t = await token();
    const p = await provider.authenticate(h(t));
    expect(p.roles).toEqual(["campaign_manager"]);
    expect(p.permissions).toContain("campaigns.write");
    expect(p.permissions).not.toContain("campaigns.approve");
    expect(p.authority).toBe("hcg-connect");
    expect(calls.every((c) => c.auth === `Bearer ${t}` && c.body.product_id === "hcg.ads" && c.body.org_id === "2bdefe45-3bf4-466a-865e-8d4b4ac17462")).toBe(true);
    expect(p.displayName).toBe("Founder");
    expect(p.organisationId).toBe("2bdefe45-3bf4-466a-865e-8d4b4ac17462");
  });

  it("refuses missing, forged, expired and wrong-issuer tokens", async () => {
    const { provider, token } = await setup(() => Response.json({ allowed: true }));
    await expect(provider.authenticate(new Headers())).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(provider.authenticate(h("a.b.c"))).rejects.toMatchObject({ code: "invalid_token" });
    await expect(provider.authenticate(h(await token({}, "-10m")))).rejects.toMatchObject({ code: "token_expired" });
    await expect(provider.authenticate(h(await token({ role: "anon" })))).rejects.toMatchObject({ code: "invalid_token" });
  });

  it("an account without an HCG ADS role gets nothing; an outage allows nothing", async () => {
    const none = await setup(() => Response.json({ allowed: false }));
    await expect(none.provider.authenticate(h(await none.token()))).rejects.toMatchObject({ code: "no_hcg_ads_role" });
    const down = await setup(() => new Response("bad gateway", { status: 502 }));
    await expect(down.provider.authenticate(h(await down.token()))).rejects.toMatchObject({ code: "hcg_unavailable" });
    const ended = await setup(() => new Response("{}", { status: 401 }));
    await expect(ended.provider.authenticate(h(await ended.token()))).rejects.toMatchObject({ code: "hcg_session_ended" });
  });

  it("without configuration every administration request is refused", async () => {
    const x = await harness({ identity: new HcgConnectIdentityProvider(null, ["not configured"]) });
    const r = await x.api("GET", "/admin/v1/session");
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("hcg_connect_not_configured");
    // Public delivery stays separate and keyless.
    expect((await x.api("GET", "/delivery/v1/health")).status).toBe(200);
  });
});

describe("configuration safety", () => {
  it("never accepts placeholders or secrets for HCG Connect", () => {
    expect(validateHcgConnectConfig(undefined).config).toBeNull();
    expect(validateHcgConnectConfig({ ...cfg, productId: "<key>" }).problems.join()).toMatch(/placeholders/);
    expect(validateHcgConnectConfig({ ...cfg, client_secret: "x" }).problems.join()).toMatch(/credential fields/);
    expect(validateHcgConnectConfig(cfg).config).not.toBeNull();
  });

  it("accepts only the shared HCG project's public anon key for HCG News", () => {
    const base = { environment: "p", projectURL: "https://qggdyzoydveafkmjgkpq.supabase.co", publicClientKey: ANON_KEY, publicationURL: "https://news.hakmicapitalgroup.com", approvedByFounder: true };
    expect(validateHcgNewsConfig(base).config).not.toBeNull();
    const svc = [ANON_KEY.split(".")[0], Buffer.from(JSON.stringify({ role: "service_role", ref: "qggdyzoydveafkmjgkpq" })).toString("base64url"), "x"].join(".");
    expect(validateHcgNewsConfig({ ...base, publicClientKey: svc }).problems.join()).toMatch(/not an anon key/);
    expect(validateHcgNewsConfig({ ...base, projectURL: "https://evil.supabase.co" }).problems.join()).toMatch(/not the shared HCG project/);
    expect(validateHcgNewsConfig({ ...base, approvedByFounder: false }).config).toBeNull();
    expect(validateHcgNewsConfig({ ...base, service_role_key: "x" }).problems.join()).toMatch(/credential fields/);
  });

  it("refuses the development identity in production or off loopback", () => {
    expect(() => assertSafe(testConfig({ env: "production" }))).toThrow(/production/);
    expect(() => assertSafe(testConfig({ host: "0.0.0.0" }))).toThrow(/loopback/);
  });

  it("validates destination URLs", () => {
    expect(checkDestinationUrl("https://acme.example/x").ok).toBe(true);
    for (const bad of ["javascript:alert(1)", "http://acme.example", "https://user:pw@acme.example", "https://10.0.0.1/x", "https://bit.ly/abc", "data:text/html,hi"]) {
      expect(checkDestinationUrl(bad).ok, bad).toBe(false);
    }
    expect(checkDestinationUrl("http://127.0.0.1:7800/x", { allowLocalhost: true }).ok).toBe(true);
  });
});

describe("server-side authorisation", () => {
  it("checks permissions on every consequential operation", async () => {
    const x = await harness();
    const viewer = { "x-hcg-dev-roles": "analytics_viewer" };
    expect((await x.api("POST", "/admin/v1/integrations/hcg-news/connect", {}, viewer)).status).toBe(403);
    expect((await x.api("POST", "/admin/v1/governance/emergency", { active: true }, viewer)).status).toBe(403);
    expect((await x.api("POST", "/admin/v1/campaigns", { name: "x", kind: "internal" }, viewer)).status).toBe(403);
    expect((await x.api("GET", "/admin/v1/analytics", undefined, viewer)).status).toBe(200);
    const audit = (await x.api("GET", "/admin/v1/audit")).body.entries;
    expect(Array.isArray(audit)).toBe(true);
  });
});
