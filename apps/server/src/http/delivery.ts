import { Hono } from "hono";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DeliveryRequest, EventType } from "@hcg-ads/contracts";
import { CONTRACT_VERSION } from "@hcg-ads/contracts";
import type { AppContext } from "../context.ts";
import { RateLimiter } from "./rate-limit.ts";

const EVENT_TYPES = new Set<EventType>(["impression", "viewable", "click", "video_start", "video_25", "video_50", "video_75", "video_complete", "error"]);
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

function originOf(headers: Headers): string | null {
  const o = headers.get("origin");
  if (o && o !== "null") return o;
  const ref = headers.get("referer");
  if (!ref) return null;
  try { return new URL(ref).origin; } catch { return null; }
}

/**
 * Public delivery API (/delivery/v1). Separate from administration; it needs
 * no keys. Placement identifiers are public. Every failure answers with an
 * empty ad so the host website or app keeps working.
 */
export function deliveryRoutes(ctx: AppContext, limiter = new RateLimiter(600, 60_000)) {
  const app = new Hono<{ Bindings: { incoming?: { socket?: { remoteAddress?: string } } } }>();

  app.use("*", async (c, next) => {
    c.header("access-control-allow-origin", "*");
    c.header("access-control-allow-methods", "GET, POST, OPTIONS");
    c.header("access-control-allow-headers", "content-type, x-hcg-app-id");
    c.header("access-control-max-age", "600");
    c.header("x-content-type-options", "nosniff");
    c.header("referrer-policy", "no-referrer");
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    // The address is used only in memory for abuse limits; it is never stored.
    const ip = c.env?.incoming?.socket?.remoteAddress ?? "unknown";
    if (!limiter.allow(ip)) return c.json({ contractVersion: CONTRACT_VERSION, placement: null, ad: null, reason: "rate_limited" }, 429);
    await next();
  });

  app.get("/health", (c) => c.json({ status: "ok", contractVersion: CONTRACT_VERSION }));

  const handle = async (req: DeliveryRequest, headers: Headers) => {
    try {
      return await ctx.delivery.request(req, { origin: originOf(headers), appId: headers.get("x-hcg-app-id") });
    } catch (e) {
      console.error("delivery failed", e);
      return { contractVersion: CONTRACT_VERSION, placement: null, ad: null, reason: "delivery_error" };
    }
  };

  app.post("/ad", async (c) => {
    const req = (await c.req.json().catch(() => null)) as DeliveryRequest | null;
    if (!req || typeof req.placement !== "string") return c.json({ contractVersion: CONTRACT_VERSION, placement: null, ad: null, reason: "bad_request" }, 400);
    c.header("cache-control", "no-store");
    return c.json(await handle(req, c.req.raw.headers));
  });

  app.get("/ad", async (c) => {
    c.header("cache-control", "no-store");
    return c.json(await handle({
      placement: c.req.query("placement") ?? "",
      device: c.req.query("device") as DeliveryRequest["device"],
      context: { category: c.req.query("category") },
      exclude: c.req.query("exclude")?.split(",").filter(Boolean),
    }, c.req.raw.headers));
  });

  const event = (token: string, type: string, headers: Headers) => {
    if (!EVENT_TYPES.has(type as EventType)) return { counted: false, reason: "unknown_event" };
    const r = ctx.delivery.recordEvent(token, type as EventType, { userAgent: headers.get("user-agent") });
    return { counted: r.counted, reason: r.reason };
  };
  app.post("/events/:token/:type", (c) => c.json(event(c.req.param("token"), c.req.param("type"), c.req.raw.headers)));
  app.get("/events/:token/:type", (c) => {
    event(c.req.param("token"), c.req.param("type"), c.req.raw.headers);
    return new Response(new Uint8Array(PIXEL), { headers: { "content-type": "image/gif", "cache-control": "no-store" } });
  });

  /** Records the click (unless measurement consent is withheld) and redirects to the validated destination. */
  app.get("/click/:token", (c) => {
    const token = c.req.param("token");
    const claims = ctx.delivery.verifyToken(token);
    const dest = ctx.delivery.destinationFor(claims);
    if (!dest) return c.text("This advertisement is no longer available.", 410);
    if (c.req.query("m") !== "0") ctx.delivery.recordEvent(token, "click", { userAgent: c.req.header("user-agent") });
    c.header("cache-control", "no-store");
    return c.redirect(dest, 302);
  });

  /** Approved public media only. Unapproved uploads are never reachable here. */
  app.get("/media/:key", async (c) => {
    const key = c.req.param("key");
    if (!/^[A-Za-z0-9_-]{20,40}\.(png|jpg|gif|webp|mp4|webm)(\.poster\.jpg)?$/.test(key)) return c.notFound();
    const m = await ctx.media.readPublic(key);
    if (!m) return c.notFound();
    return new Response(new Uint8Array(m.data), {
      headers: {
        "content-type": m.mime, "cache-control": "public, max-age=86400, immutable", "content-security-policy": "default-src 'none'; sandbox",
        "access-control-allow-origin": "*", "cross-origin-resource-policy": "cross-origin", "accept-ranges": "none",
      },
    });
  });

  const sdkDir = resolve(fileURLToPath(new URL("../../../../packages/sdk-js/dist", import.meta.url)));
  app.get("/sdk/:file{hcg-ads(\\.min)?\\.js(\\.map)?}", (c) => {
    const p = resolve(sdkDir, c.req.param("file"));
    if (!p.startsWith(sdkDir) || !existsSync(p)) return c.text("// HCG ADS SDK has not been built. Run: npm run build -w @hcg-ads/sdk", 404);
    return new Response(readFileSync(p), { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=300", "access-control-allow-origin": "*" } });
  });

  return app;
}
