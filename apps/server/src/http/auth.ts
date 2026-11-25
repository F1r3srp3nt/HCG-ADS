import { Hono, type Context } from "hono";
import type { AppContext } from "../context.ts";
import { AppError } from "../core/errors.ts";
import { randomToken } from "../core/sealing.ts";
import { pkcePair } from "../identity/oauth.ts";
import { HcgConnectIdentityProvider, SESSION_COOKIE, readCookie } from "../identity/provider.ts";
import { SYSTEM_ACTOR } from "../core/audit.ts";

export function sessionCookie(ctx: AppContext) {
  const secure = ctx.config.publicBaseUrl.startsWith("https://");
  return { name: secure ? `__Host-${SESSION_COOKIE}` : SESSION_COOKIE, secure };
}

function setCookie(c: Context, ctx: AppContext, value: string, maxAgeSeconds: number) {
  const { name, secure } = sessionCookie(ctx);
  c.header("set-cookie", `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`, { append: true });
}

/** Only same-application relative paths may be returned to after sign-in. */
export function safeReturn(raw: string | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || /[\r\n]/.test(raw) || raw.length > 300) return "/";
  return raw;
}

/** HCG Connect sign-in for the HCG ADS web application (authorization code + PKCE S256, server-owned session). */
export function authRoutes(ctx: AppContext) {
  const app = new Hono();
  const hcg = () => (ctx.identity instanceof HcgConnectIdentityProvider ? ctx.identity : null);

  app.use("*", async (c, next) => {
    c.header("cache-control", "no-store");
    c.header("referrer-policy", "no-referrer");
    await next();
  });

  app.get("/status", (c) => c.json(ctx.identity.status()));

  app.get("/login", async (c) => {
    const p = hcg();
    if (!p?.oauth || !p.sessions) {
      throw new AppError(503, "sign_in_unavailable", ctx.identity.mode === "development"
        ? "This local development build uses the labelled development identity; HCG Connect sign-in is not used."
        : "HCG Connect sign-in is not available yet: HCG has not issued the HCG ADS web client (see docs/HCG-CONNECT-REGISTRATION-REQUEST.md).");
    }
    const state = randomToken(32), nonce = randomToken(32);
    const { verifier, challenge } = pkcePair();
    p.sessions.createAuthRequest({ state, nonce, verifier, returnTo: safeReturn(c.req.query("return")) });
    return c.redirect(await p.oauth.authorizationUrl(state, nonce, challenge), 302);
  });

  app.get("/callback", async (c) => {
    const p = hcg();
    if (!p?.oauth || !p.sessions) throw new AppError(503, "sign_in_unavailable", "HCG Connect sign-in is not available.");
    const state = c.req.query("state") ?? "";
    const pending = state ? p.sessions.consumeAuthRequest(state) : null;
    if (!pending) throw new AppError(400, "invalid_state", "This sign-in link is invalid or has expired. Start again.");
    if (c.req.query("error")) {
      return c.redirect(`/?signin=${encodeURIComponent(c.req.query("error") === "access_denied" ? "denied" : "failed")}`, 302);
    }
    const code = c.req.query("code");
    if (!code) throw new AppError(400, "invalid_request", "HCG Connect returned no authorization code.");
    const tokens = await p.oauth.exchange(code, pending.verifier, pending.nonce);
    const subject = String(tokens.accessClaims.sub);
    const me = await p.meFor(subject, tokens.accessToken);
    const { sessionId } = p.sessions.create({
      subject,
      displayName: me.displayName ?? String(tokens.idClaims?.name ?? tokens.idClaims?.email ?? "HCG account"),
      email: me.email ?? (typeof tokens.idClaims?.email === "string" ? tokens.idClaims.email : null),
      organisationId: p.organisationFor(me) === "00000000-0000-0000-0000-000000000000" ? null : p.organisationFor(me),
      founderPolicy: me.founderPolicy,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessExpiresAt: tokens.expiresAt,
    });
    ctx.audit.record({ subject, displayName: me.displayName ?? subject, authority: "hcg-connect" }, "auth.sign_in", "session", null, "Signed in with HCG Connect");
    setCookie(c, ctx, sessionId, 12 * 60 * 60);
    return c.redirect(pending.returnTo, 302);
  });

  /** Ends the HCG ADS session. HCG offers no end-session endpoint, so HCG itself is not signed out. */
  app.post("/logout", (c) => {
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(ctx.config.publicBaseUrl).origin && !ctx.config.adminOrigins.includes(origin)) {
      throw new AppError(403, "bad_origin", "Sign-out must come from HCG ADS.");
    }
    const p = hcg();
    const sid = readCookie(c.req.raw.headers, SESSION_COOKIE);
    if (sid && p?.sessions) p.sessions.destroy(sid);
    setCookie(c, ctx, "", 0);
    void SYSTEM_ACTOR;
    return c.json({ signedOut: true, hcgSessionEnded: false, note: "HCG Connect has no end-session endpoint; your HCG account session elsewhere is unchanged." });
  });

  return app;
}
