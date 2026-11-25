import { Hono } from "hono";
import { existsSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { PRODUCT_VERSION, CONTRACT_VERSION } from "@hcg-ads/contracts";
import type { AppContext } from "../context.ts";
import { AppError } from "../core/errors.ts";
import { adminRoutes } from "./admin.ts";
import { deliveryRoutes } from "./delivery.ts";
import { authRoutes } from "./auth.ts";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".json": "application/json", ".ico": "image/x-icon",
};

function staticFiles(dir: string, spaFallback: boolean) {
  return (path: string): Response | null => {
    const p = resolve(dir, "." + (path === "/" || path === "" ? "/index.html" : path));
    if (!(p + sep).startsWith(dir + sep) && p !== dir) return null;
    const file = existsSync(p) && !p.endsWith(sep) && extname(p) ? p : spaFallback ? resolve(dir, "index.html") : null;
    if (!file || !existsSync(file)) return null;
    return new Response(readFileSync(file), { headers: { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": file.endsWith("index.html") ? "no-cache" : "public, max-age=300" } });
  };
}

export function createApp(ctx: AppContext) {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof AppError) return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status as 400);
    if (err instanceof ZodError) {
      return c.json({ error: { code: "invalid", message: err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "), details: err.issues } }, 422);
    }
    console.error(err);
    return c.json({ error: { code: "internal", message: "Something went wrong. Nothing was changed unless stated otherwise." } }, 500);
  });

  app.use("*", async (c, next) => {
    await next();
    c.header("x-content-type-options", "nosniff");
    c.header("x-frame-options", c.req.path.startsWith("/testbed") ? "SAMEORIGIN" : "DENY");
    if (ctx.config.publicBaseUrl.startsWith("https://")) c.header("strict-transport-security", "max-age=31536000; includeSubDomains");
  });

  // Administration API: CORS only for the registered command-center origins.
  app.use("/admin/*", async (c, next) => {
    const origin = c.req.header("origin");
    if (origin && ctx.config.adminOrigins.includes(origin)) {
      c.header("access-control-allow-origin", origin);
      c.header("vary", "origin");
      c.header("access-control-allow-headers", "authorization, content-type, x-hcg-dev-roles, x-hcg-ads-csrf");
      c.header("access-control-allow-credentials", "true");
      c.header("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
    }
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    c.header("cache-control", "no-store");
    await next();
  });

  app.route("/auth", authRoutes(ctx));
  app.route("/admin/v1", adminRoutes(ctx));
  app.route("/delivery/v1", deliveryRoutes(ctx));

  /** Readiness for an operator: what is configured, without revealing any value. */
  app.get("/readyz", async (c) => {
    const id = ctx.identity.status();
    const storage = await ctx.media.storageStatus().catch((e: Error) => ({ ok: false, message: e.message }));
    const checks = {
      identity: { ok: id.mode === "hcg-connect" ? id.configured : ctx.config.env !== "production", detail: id.label },
      webSignIn: { ok: id.mode !== "hcg-connect" || id.signInAvailable === true, detail: id.signInAvailable ? "available" : "web client not issued" },
      storage: { ok: storage.ok, detail: ctx.media.storageName },
      hcgNews: { ok: !!ctx.config.hcgNews, detail: ctx.config.hcgNews ? "public read configured" : "not configured" },
      liveDelivery: { ok: true, detail: ctx.config.liveDeliveryEnabled ? "ENABLED" : "off (test origins only)" },
      payments: { ok: true, detail: ctx.config.payments ? "HCG Payments (test mode only)" : "local test-mode ledger" },
      emergencyShutdown: { ok: true, detail: ctx.settings.get().emergencyShutdown.active ? "ACTIVE" : "off" },
    };
    const ready = Object.values(checks).every((x) => x.ok);
    return c.json({ ready, environment: ctx.config.env, checks }, ready ? 200 : 503);
  });

  app.get("/healthz", (c) => c.json({ status: "ok", product: "hcg.ads", version: PRODUCT_VERSION, contractVersion: CONTRACT_VERSION, environment: ctx.config.env }));

  // HCG News test environment (development only): a local page that renders
  // real published HCG News articles with HCG ADS placements, via the SDK.
  const testbedDir = resolve(fileURLToPath(new URL("../../../../examples/hcg-news-testbed", import.meta.url)));
  if (ctx.config.env !== "production" && existsSync(testbedDir)) {
    const serve = staticFiles(testbedDir, false);
    app.get("/testbed", (c) => c.redirect("/testbed/"));
    app.get("/testbed/*", (c) => serve(c.req.path.slice("/testbed".length)) ?? c.notFound());
  }
  const storeTestbedDir = resolve(fileURLToPath(new URL("../../../../examples/hcg-store-testbed", import.meta.url)));
  if (ctx.config.env !== "production" && existsSync(storeTestbedDir)) {
    const serve = staticFiles(storeTestbedDir, false);
    app.get("/testbed-store", (c) => c.redirect("/testbed-store/"));
    app.get("/testbed-store/*", (c) => serve(c.req.path.slice("/testbed-store".length)) ?? c.notFound());
  }

  if (ctx.config.adminStaticDir) {
    const serve = staticFiles(ctx.config.adminStaticDir, true);
    app.get("*", (c) => serve(c.req.path) ?? c.notFound());
  } else {
    app.get("/", (c) => c.text("HCG ADS API is running. Start the command center with: npm run dev:admin"));
  }
  return app;
}
