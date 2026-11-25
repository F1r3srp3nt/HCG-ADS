#!/usr/bin/env node
/**
 * Browser check of HCG Connect web sign-in, end to end, against a LOCAL STAND-IN for
 * HCG Connect (loopback only, clearly not HCG). It proves the HCG ADS side: redirect to
 * the discovered authorize endpoint with PKCE S256/state/nonce, code exchange on the
 * server, HttpOnly session cookie, no token in the browser, CSRF on writes, sign-out.
 * It does not and cannot prove HCG's own consent page, which needs the real client.
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(join(ROOT, "apps/server/package.json"));
const { SignJWT, exportJWK, generateKeyPair } = req("jose");
const IDP_PORT = 7821, ADS_PORT = 7820;
const ISSUER = `http://127.0.0.1:${IDP_PORT}/auth/v1`;
const CLIENT = "11111111-2222-4333-8444-555555555555";
const SUB = "ecf223e3-13d9-4186-ac84-06fb9a058cd6";
const ADS = `http://127.0.0.1:${ADS_PORT}`;

const { publicKey, privateKey } = await generateKeyPair("ES256");
const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "ES256", use: "sig" };
const codes = new Map();
const sign = (claims, aud, ttl) => new SignJWT(claims).setProtectedHeader({ alg: "ES256", kid: "k1" }).setIssuer(ISSUER).setAudience(aud)
  .setSubject(SUB).setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) + ttl).sign(privateKey);
const seen = { authorize: null, tokenBody: null };

const idp = createServer(async (rq, rs) => {
  const url = new URL(rq.url, `http://127.0.0.1:${IDP_PORT}`);
  const json = (o, s = 200) => { rs.writeHead(s, { "content-type": "application/json" }); rs.end(JSON.stringify(o)); };
  let body = ""; for await (const c of rq) body += c;
  if (url.pathname === "/auth/v1/.well-known/openid-configuration") return json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/oauth/authorize`,
    token_endpoint: `${ISSUER}/oauth/token`, jwks_uri: `${ISSUER}/.well-known/jwks.json`, code_challenge_methods_supported: ["S256"] });
  if (url.pathname === "/auth/v1/.well-known/jwks.json") return json({ keys: [jwk] });
  if (url.pathname === "/auth/v1/oauth/authorize") {
    seen.authorize = Object.fromEntries(url.searchParams);
    // Stand-in consent page: one button, like HCG's consent screen.
    const code = randomUUID();
    codes.set(code, { challenge: url.searchParams.get("code_challenge"), nonce: url.searchParams.get("nonce"), redirect: url.searchParams.get("redirect_uri") });
    const back = `${url.searchParams.get("redirect_uri")}?code=${code}&state=${encodeURIComponent(url.searchParams.get("state"))}`;
    rs.writeHead(200, { "content-type": "text/html" });
    return rs.end(`<!doctype html><title>Local stand-in for HCG Connect consent</title><h1>LOCAL STAND-IN — not HCG</h1><a id="approve" href="${back}">Approve HCG ADS</a>`);
  }
  if (url.pathname === "/auth/v1/oauth/token") {
    const p = new URLSearchParams(body); seen.tokenBody = Object.fromEntries(p);
    const c = codes.get(p.get("code")); codes.delete(p.get("code"));
    if (!c || p.get("client_id") !== CLIENT || c.redirect !== p.get("redirect_uri")
      || createHash("sha256").update(p.get("code_verifier") ?? "").digest("base64url") !== c.challenge) return json({ error: "invalid_grant" }, 400);
    return json({ access_token: await sign({ role: "authenticated", client_id: CLIENT, email: "founder@example.com" }, "authenticated", 3600),
      id_token: await sign({ nonce: c.nonce, email: "founder@example.com" }, CLIENT, 3600), refresh_token: randomUUID(), token_type: "bearer", expires_in: 3600 });
  }
  if (url.pathname === "/api/public/ecosystem/v1/me") return json({ api_version: "v1", user: { id: SUB, email: "founder@example.com", display_name: "Founder (local stand-in)" },
    organisations: [{ org_id: "2bdefe45-3bf4-466a-865e-8d4b4ac17462", slug: "hcg" }], product_policy: { active: true } });
  if (url.pathname === "/api/public/ecosystem/v1/check") return json({ api_version: "v1", allowed: JSON.parse(body).feature_key === "ads.founder" });
  json({ error: "not found" }, 404);
}).listen(IDP_PORT, "127.0.0.1");

const cfg = mkdtempSync(join(tmpdir(), "hcg-ads-signin-cfg-"));
copyFileSync(join(ROOT, "config/hcg-news.json"), join(cfg, "hcg-news.json"));
writeFileSync(join(cfg, "hcg-connect.json"), JSON.stringify({
  contractVersion: "hcg.ads.connect/1", issuer: ISSUER, jwksEndpoint: `${ISSUER}/.well-known/jwks.json`,
  apiBaseUrl: `http://127.0.0.1:${IDP_PORT}`, ecosystemApiPath: "/api/public/ecosystem/v1", productId: "hcg.ads",
  roleFeatures: { founder: "ads.founder" }, organisationId: "2bdefe45-3bf4-466a-865e-8d4b4ac17462",
  webClient: { clientId: CLIENT, redirectUri: `${ADS}/auth/callback` },
}));
const server = spawn(process.execPath, ["--import", "tsx", join(ROOT, "apps/server/src/main.ts")], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, HCG_ADS_IDENTITY: "hcg-connect", HCG_ADS_CONFIG_DIR: cfg, HCG_ADS_PORT: String(ADS_PORT), HCG_ADS_PUBLIC_URL: ADS,
    HCG_ADS_DATA_DIR: mkdtempSync(join(tmpdir(), "hcg-ads-signin-data-")) } });
let log = ""; server.stdout.on("data", (d) => (log += d)); server.stderr.on("data", (d) => (log += d));
for (let i = 0; i < 100; i++) { try { if ((await fetch(`${ADS}/healthz`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }

let chromium;
for (const p of ["playwright", "/opt/node-tools/node_modules/playwright"]) { try { ({ chromium } = createRequire(import.meta.url)(p)); break; } catch {} }
const browser = await chromium.launch();
const page = await browser.newPage();
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };
try {
  await page.goto(`${ADS}/#/campaigns`);
  await page.getByRole("button", { name: "Sign in with HCG Connect" }).click();
  await page.waitForURL(/oauth\/authorize/);
  const a = seen.authorize;
  check("redirected to the discovered authorize endpoint", page.url().startsWith(`${ISSUER}/oauth/authorize`));
  check("PKCE S256, state, nonce, exact callback, minimal scopes", a.code_challenge_method === "S256" && a.state?.length > 30 && a.nonce?.length > 30
    && a.redirect_uri === `${ADS}/auth/callback` && a.scope === "openid email profile" && a.client_id === CLIENT);
  await page.click("#approve");
  await page.waitForURL(`${ADS}/#/campaigns`);
  await page.waitForSelector("text=Founder (local stand-in)");
  check("signed in and returned to the page the person came from", true, page.url());
  check("code exchanged with the PKCE verifier on the server", !!seen.tokenBody?.code_verifier && !seen.tokenBody?.client_secret);
  const cookies = await page.context().cookies();
  const sc = cookies.find((c) => c.name === "hcg_ads_session");
  check("session cookie is HttpOnly and SameSite=Lax, holds no token", !!sc && sc.httpOnly && sc.sameSite === "Lax" && !sc.value.startsWith("eyJ"));
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  check("no HCG token in browser storage", !/eyJ/.test(storage));
  const write = await page.evaluate(async () => {
    const s = await (await fetch("/admin/v1/session")).json();
    const without = await fetch("/admin/v1/governance/emergency", { method: "POST", headers: { "content-type": "application/json" }, body: '{"active":false}' });
    const withTok = await fetch("/admin/v1/governance/emergency", { method: "POST", headers: { "content-type": "application/json", "x-hcg-ads-csrf": s.csrfToken }, body: '{"active":false}' });
    return [without.status, withTok.status, JSON.stringify(s).includes("eyJ")];
  });
  check("writes need the CSRF token; the session response carries no token", write[0] === 403 && write[1] === 200 && write[2] === false, `without ${write[0]}, with ${write[1]}`);
  await page.goto(`${ADS}/#/settings`);
  await page.getByRole("button", { name: "Sign out of HCG ADS" }).click();
  await page.waitForSelector("text=Sign in with HCG Connect");
  check("sign-out ends the HCG ADS session", true);
} catch (e) {
  results.push(false); console.log("FAIL", e.message); console.log(log.split("\n").slice(-15).join("\n"));
} finally {
  await browser.close(); server.kill(); idp.close();
  const ok = results.every(Boolean);
  console.log(ok ? `\nALL ${results.length} CHECKS PASS (against a local stand-in, not HCG)` : "\nFAILED");
  process.exit(ok ? 0 : 1);
}
