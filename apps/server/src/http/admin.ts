import { Hono, type Context } from "hono";
import { STANDARD_FORMATS, ROLE_LABELS, PRODUCT_VERSION, type Permission, type Principal } from "@hcg-ads/contracts";
import type { AppContext } from "../context.ts";
import { actorOf } from "../core/audit.ts";
import { AppError, forbidden, invalid } from "../core/errors.ts";
import { HCG_NEWS_PUBLISHER_ID } from "../publishers/service.ts";
import { SOURCE_IDS } from "../sources/registry.ts";
import { CALLS_TO_ACTION } from "../creatives/validate.ts";
import { dayOf } from "../core/clock.ts";
import { HcgPaymentsGateway } from "../billing/hcg-payments.ts";

type Env = { Variables: { principal: Principal } };

/** Administration API (/admin/v1). Every route is authenticated and authorised server-side. */
export function adminRoutes(ctx: AppContext) {
  const app = new Hono<Env>();

  // Signed, expiring media previews (used by <img>/<video>, which cannot send headers).
  app.get("/media/:id/content", async (c) => {
    const { data, mime } = await ctx.media.readSigned(c.req.param("id"), c.req.query("t") ?? "");
    return new Response(new Uint8Array(data), { headers: { "content-type": mime, "cache-control": "private, max-age=600", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" } });
  });

  app.use("*", async (c, next) => {
    const write = !["GET", "HEAD"].includes(c.req.method);
    // Consequential operations always get a fresh central decision (no cached "yes").
    const principal = await ctx.identity.authenticate(c.req.raw.headers, { fresh: write });
    if (write && principal.csrfToken) {
      // Cookie sessions: the request must come from HCG ADS itself and echo the session's CSRF token.
      const origin = c.req.header("origin");
      const allowed = [new URL(ctx.config.publicBaseUrl).origin, ...ctx.config.adminOrigins];
      if (origin && !allowed.includes(origin)) throw new AppError(403, "bad_origin", "This request did not come from HCG ADS.");
      if (c.req.header("x-hcg-ads-csrf") !== principal.csrfToken) throw new AppError(403, "csrf", "The request is missing its HCG ADS session token. Reload the page.");
    }
    c.set("principal", principal);
    await next();
  });

  const need = (c: Context<Env>, ...perms: Permission[]) => {
    const p = c.get("principal");
    for (const perm of perms) if (!p.permissions.includes(perm)) throw forbidden(`Your HCG ADS role does not allow ${perm}.`);
    return actorOf(p);
  };
  const body = async (c: Context<Env>) => {
    try { return await c.req.json(); } catch { throw invalid("The request body must be JSON."); }
  };

  // ---- Session / overview ------------------------------------------------

  app.get("/session", (c) => {
    const p = c.get("principal");
    return c.json({ principal: p, csrfToken: p.csrfToken ?? null, roleLabels: ROLE_LABELS, identity: ctx.identity.status(), environment: ctx.config.env, version: PRODUCT_VERSION });
  });

  app.get("/overview", async (c) => {
    need(c, "dashboard.read");
    const campaigns = ctx.campaigns.list();
    const byState = Object.fromEntries(["draft", "pending_approval", "approved", "scheduled", "active", "paused", "completed", "rejected", "archived"]
      .map((s) => [s, campaigns.filter((x) => x.state === s).length]));
    const today = dayOf(ctx.clock.now());
    const measured = ctx.analytics.report({ dataset: "measured", from: dayOf(new Date(ctx.clock.now().getTime() - 13 * 86400_000)), to: today });
    return c.json({
      campaigns: byState,
      activeCampaigns: campaigns.filter((x) => x.state === "active").map(({ creatives, ...x }) => ({ ...x, creativeCount: creatives?.length ?? 0 })),
      pendingApprovals: campaigns.filter((x) => x.state === "pending_approval").length
        + ctx.advertisers.list().filter((a) => a.status === "pending").length
        + ctx.publishers.list().filter((p) => p.status === "pending").length,
      suspended: campaigns.filter((x) => x.state === "paused" && x.stateReason === "source_unavailable").map((x) => ({ id: x.id, name: x.name })),
      publishers: ctx.publishers.list().length,
      placements: ctx.publishers.placements().length,
      advertisers: ctx.advertisers.list().length,
      mediaAssets: ctx.media.list().length,
      emergency: ctx.settings.get().emergencyShutdown,
      metrics: { dataset: "measured", totals: measured.totals, byDay: measured.byDay },
      recentActivity: ctx.audit.list({ limit: 12 }),
    });
  });

  app.get("/ecosystem", async (c) => {
    need(c, "dashboard.read");
    const storage = await ctx.media.storageStatus().catch((e: Error) => ({ ok: false, message: e.message }));
    const news = ctx.sources.get(SOURCE_IDS["hcg-news"]);
    const id = ctx.identity.status();
    return c.json({
      integrations: [
        { id: "hcg-connect", name: "HCG Connect", role: "Identity provider", state: id.mode === "hcg-connect" && id.configured ? "connected" : id.mode === "development" ? "development" : "not_configured", detail: id.label, problems: id.problems },
        { id: "hcg-news", name: "HCG News", role: "First publisher and content source", state: news.status, detail: news.lastSyncResult ?? news.description, problems: news.configurationProblems },
        { id: "hcg-server", name: "HCG Server", role: "Media storage", state: ctx.media.storageName === "hcg-server" ? (storage.ok ? "connected" : "degraded") : "available_adapter", detail: `${ctx.media.storageDescription()} — ${storage.message}`, problems: [] },
        { id: "media-processing", name: "Media processing", role: "Probe, thumbnails, optimisation, transcoding", state: ctx.media.processorInfo().name === "ffmpeg" ? "connected" : "degraded", detail: `Processor: ${ctx.media.processorInfo().name}`, problems: [] },
        { id: "hcg-payments", name: "HCG Payments", role: "Budgets, invoices (test mode only)", state: ctx.billing.gateway.status().connected ? "connected" : ctx.billing.gateway instanceof HcgPaymentsGateway ? "degraded" : "not_configured", detail: ctx.billing.gateway.status().message, problems: ctx.config.paymentsProblems },
        { id: "hcg-store", name: "HCG Store", role: "Content source (products)", state: "not_configured", detail: "Awaiting an HCG Store content contract.", problems: [] },
        { id: "hcg-ecc", name: "HCG Executive Control Center", role: "Central governance and reporting", state: "not_configured", detail: "Governance events are kept in the HCG ADS audit log until an ECC reporting contract exists.", problems: [] },
      ],
    });
  });

  // ---- Governance ----------------------------------------------------------

  app.get("/settings", (c) => { need(c, "governance.read"); return c.json(ctx.settings.get()); });
  app.patch("/settings", async (c) => c.json(ctx.settings.update(await body(c), need(c, "settings.write"))));
  app.post("/governance/emergency", async (c) => {
    const actor = need(c, "governance.emergency");
    const b = await body(c);
    if (typeof b.active !== "boolean") throw invalid("active must be true or false.");
    return c.json(ctx.settings.setEmergency(b.active, b.reason ?? null, actor));
  });
  app.get("/audit", (c) => {
    need(c, "audit.read");
    return c.json({ entries: ctx.audit.list({ limit: Number(c.req.query("limit") ?? 100), entityType: c.req.query("entityType"), entityId: c.req.query("entityId") }) });
  });
  app.post("/maintenance/retention", async (c) => {
    const actor = need(c, "settings.write");
    const events = ctx.analytics.purge(ctx.settings.get().analyticsRetentionDays, actor);
    const media = await ctx.media.purgeExpired(actor);
    return c.json({ eventsDeleted: events, mediaPurged: media });
  });

  // ---- Content sources ------------------------------------------------------

  app.get("/content-sources", (c) => { need(c, "content_sources.read"); return c.json({ sources: ctx.sources.list() }); });
  app.post("/content-sources/:id/connect", async (c) => c.json(await ctx.sources.connect(c.req.param("id"), need(c, "content_sources.write"))));
  app.post("/content-sources/:id/disconnect", async (c) => c.json(await ctx.sources.disconnect(c.req.param("id"), need(c, "content_sources.write"))));
  app.post("/content-sources/:id/sync", async (c) => c.json(await ctx.sources.sync(c.req.param("id"), need(c, "content_sources.write"))));
  app.get("/content-sources/:id/categories", async (c) => { need(c, "content_sources.read"); return c.json({ categories: await ctx.sources.categories(c.req.param("id")) }); });
  app.get("/content-sources/:id/items", async (c) => {
    need(c, "content_sources.read");
    return c.json(await ctx.sources.browse(c.req.param("id"), { cursor: c.req.query("cursor"), query: c.req.query("q"), category: c.req.query("category"), limit: Number(c.req.query("limit") ?? 20) }));
  });
  app.get("/content-sources/:id/items/:externalId", async (c) => {
    need(c, "content_sources.read");
    return c.json(await ctx.sources.fetchItem(c.req.param("id"), c.req.param("externalId")));
  });

  /** One step: connect HCG News as a content source and register it as the first publisher. */
  app.post("/integrations/hcg-news/connect", async (c) => {
    const actor = need(c, "content_sources.write", "publishers.write", "publishers.approve");
    const b = await c.req.json().catch(() => ({}));
    // Default test origin: this HCG ADS instance itself (which serves the HCG News test environment at /testbed/).
    const own = new URL(ctx.config.publicBaseUrl);
    const testOrigins: string[] = Array.isArray(b.testOrigins) ? b.testOrigins
      : [own.origin, ...(own.hostname === "127.0.0.1" ? [`${own.protocol}//localhost${own.port ? ":" + own.port : ""}`] : [])];
    const source = await ctx.sources.connect(SOURCE_IDS["hcg-news"], actor);
    const publisher = ctx.publishers.registerHcgNews(actor, testOrigins);
    return c.json({ source, publisher, placements: ctx.publishers.placements(HCG_NEWS_PUBLISHER_ID) });
  });

  // ---- Publishers & placements ---------------------------------------------

  app.get("/formats", (c) => c.json({ formats: STANDARD_FORMATS, callsToAction: CALLS_TO_ACTION }));
  app.get("/publishers", (c) => { need(c, "publishers.read"); return c.json({ publishers: ctx.publishers.list() }); });
  app.post("/publishers", async (c) => c.json(ctx.publishers.create(await body(c), need(c, "publishers.write")), 201));
  app.get("/publishers/:id", (c) => { need(c, "publishers.read"); return c.json({ ...ctx.publishers.get(c.req.param("id")), placements: ctx.publishers.placements(c.req.param("id")) }); });
  app.patch("/publishers/:id", async (c) => c.json(ctx.publishers.update(c.req.param("id"), await body(c), need(c, "publishers.write"))));
  app.post("/publishers/:id/status", async (c) => {
    const b = await body(c);
    if (!["active", "suspended", "rejected", "pending"].includes(b.status)) throw invalid("Unknown status.");
    const actor = need(c, ...(b.status === "active" || b.status === "rejected" ? ["publishers.approve" as const] : ["publishers.write" as const]));
    return c.json(ctx.publishers.setStatus(c.req.param("id"), b.status, actor, b.note));
  });
  app.post("/publishers/:id/delivery-mode", async (c) => {
    const p = c.get("principal");
    const actor = need(c, "publishers.approve");
    const b = await body(c);
    if (b.mode !== "test" && b.mode !== "live") throw invalid("mode must be test or live.");
    return c.json(ctx.publishers.setDeliveryMode(c.req.param("id"), b.mode, { ...actor, isFounder: p.roles.includes("founder") }, b.confirmation));
  });
  app.get("/placements", (c) => { need(c, "publishers.read"); return c.json({ placements: ctx.publishers.placements(c.req.query("publisherId")) }); });
  app.post("/publishers/:id/placements", async (c) => c.json(ctx.publishers.createPlacement(c.req.param("id"), await body(c), need(c, "placements.write")), 201));
  app.patch("/placements/:id", async (c) => c.json(ctx.publishers.updatePlacement(c.req.param("id"), await body(c), need(c, "placements.write"))));
  app.post("/placements/:id/status", async (c) => {
    const b = await body(c);
    if (b.status !== "active" && b.status !== "paused") throw invalid("status must be active or paused.");
    return c.json(ctx.publishers.setPlacementStatus(c.req.param("id"), b.status, need(c, "placements.write")));
  });

  // ---- Advertisers --------------------------------------------------------

  app.get("/advertisers", (c) => { need(c, "advertisers.read"); return c.json({ advertisers: ctx.advertisers.list() }); });
  app.post("/advertisers", async (c) => c.json(ctx.advertisers.create(await body(c), need(c, "advertisers.write")), 201));
  app.patch("/advertisers/:id", async (c) => c.json(ctx.advertisers.update(c.req.param("id"), await body(c), need(c, "advertisers.write"))));
  app.post("/advertisers/:id/status", async (c) => {
    const b = await body(c);
    if (!["approved", "suspended", "rejected", "pending"].includes(b.status)) throw invalid("Unknown status.");
    return c.json(ctx.advertisers.setStatus(c.req.param("id"), b.status, need(c, "advertisers.approve"), b.note));
  });

  // ---- Media --------------------------------------------------------------

  app.get("/media", (c) => { need(c, "media.read"); return c.json({ assets: ctx.media.list({ advertiserId: c.req.query("advertiserId") }), processor: ctx.media.processorInfo(), storage: ctx.media.storageName }); });
  app.get("/media/:id", (c) => { need(c, "media.read"); return c.json(ctx.media.get(c.req.param("id"))); });
  app.post("/media", async (c) => {
    const actor = need(c, "media.write");
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) throw invalid("Attach a file in the 'file' field.");
    const advertiserId = typeof form.advertiserId === "string" && form.advertiserId ? form.advertiserId : null;
    const previousVersionId = typeof form.previousVersionId === "string" && form.previousVersionId ? form.previousVersionId : undefined;
    const asset = await ctx.media.upload({ filename: file.name, data: Buffer.from(await file.arrayBuffer()), advertiserId, previousVersionId }, actor);
    return c.json(asset, 201);
  });
  app.delete("/media/:id", async (c) => { await ctx.media.delete(c.req.param("id"), need(c, "media.delete")); return c.body(null, 204); });

  // ---- Campaigns ----------------------------------------------------------

  app.get("/campaigns", (c) => {
    need(c, "campaigns.read");
    return c.json({ campaigns: ctx.campaigns.list({ state: c.req.query("state"), kind: c.req.query("kind"), advertiserId: c.req.query("advertiserId") }) });
  });
  app.post("/campaigns", async (c) => c.json(ctx.campaigns.create(await body(c), need(c, "campaigns.write")), 201));
  app.post("/campaigns/from-content", async (c) => c.json({ campaigns: await ctx.campaigns.createFromContent(await body(c), need(c, "campaigns.write")) }, 201));
  app.get("/campaigns/:id", (c) => {
    need(c, "campaigns.read");
    const id = c.req.param("id");
    const campaign = ctx.campaigns.get(id);
    const content = campaign.creatives.filter((cr) => cr.contentRef).map((cr) => ({ creativeId: cr.id, item: ctx.sources.cached(cr.contentRef!.sourceId, cr.contentRef!.externalId) }));
    return c.json({ ...campaign, history: ctx.campaigns.history(id), readiness: ["draft", "rejected", "pending_approval"].includes(campaign.state) ? ctx.campaigns.readiness(id) : [], content });
  });
  app.patch("/campaigns/:id", async (c) => c.json(ctx.campaigns.update(c.req.param("id"), await body(c), need(c, "campaigns.write"))));
  app.post("/campaigns/:id/creatives", async (c) => c.json(ctx.campaigns.addCreative(c.req.param("id"), await body(c), need(c, "creatives.write")), 201));
  app.patch("/creatives/:id", async (c) => c.json(ctx.campaigns.updateCreative(c.req.param("id"), await body(c), need(c, "creatives.write"))));
  app.delete("/creatives/:id", async (c) => { ctx.campaigns.removeCreative(c.req.param("id"), need(c, "creatives.write")); return c.body(null, 204); });

  app.post("/campaigns/:id/:action{submit|approve|reject|activate|pause|revise|archive|duplicate}", async (c) => {
    const id = c.req.param("id");
    const action = c.req.param("action");
    const b = await c.req.json().catch(() => ({} as Record<string, string>));
    switch (action) {
      case "submit": return c.json(ctx.campaigns.submit(id, need(c, "campaigns.submit")));
      case "approve": {
        const kind = ctx.campaigns.get(id).kind;
        return c.json(await ctx.campaigns.approve(id, need(c, "campaigns.approve", ...(kind === "external" ? ["creatives.moderate" as const] : [])), b.note));
      }
      case "reject": return c.json(ctx.campaigns.reject(id, need(c, "campaigns.approve"), b.note));
      case "activate": return c.json(ctx.campaigns.activate(id, need(c, "campaigns.activate")));
      case "pause": return c.json(ctx.campaigns.pause(id, need(c, "campaigns.pause"), "manual", b.note));
      case "revise": return c.json(ctx.campaigns.revise(id, need(c, "campaigns.write")));
      case "archive": return c.json(ctx.campaigns.archive(id, need(c, "campaigns.write")));
      case "duplicate": return c.json(ctx.campaigns.duplicate(id, need(c, "campaigns.write")), 201);
    }
    throw new AppError(404, "not_found", "Unknown action.");
  });

  /** Exact preview of a creative in a registered placement, before approval. Never counted. */
  app.get("/campaigns/:id/preview", async (c) => {
    need(c, "campaigns.read");
    const campaign = ctx.campaigns.get(c.req.param("id"));
    const placementId = c.req.query("placementId") ?? campaign.placementIds[0];
    if (!placementId) throw invalid("Select a placement to preview.");
    const placement = ctx.publishers.placement(placementId);
    const token = ctx.delivery.previewToken(campaign.id, c.req.query("creativeId") ?? undefined);
    const response = await ctx.delivery.request({ placement: placement.publicKey, preview: token, device: (c.req.query("device") as "desktop" | "mobile" | "tablet" | undefined) ?? "any" }, { origin: null, appId: null });
    return c.json({ placement, previewToken: token, response });
  });

  // ---- Approvals ----------------------------------------------------------

  app.get("/approvals", (c) => {
    need(c, "campaigns.read");
    return c.json({
      campaigns: ctx.campaigns.list({ state: "pending_approval" }).map((x) => ({ ...x, readiness: ctx.campaigns.readiness(x.id) })),
      advertisers: ctx.advertisers.list().filter((a) => a.status === "pending"),
      publishers: ctx.publishers.list().filter((p) => p.status === "pending"),
    });
  });

  // ---- Reports (moderation queue) -----------------------------------------------

  app.get("/reports", (c) => { need(c, "governance.read"); return c.json({ reports: ctx.transparency.list(c.req.query("status")) }); });
  app.post("/reports/:id/resolve", async (c) => {
    const actor = need(c, "creatives.moderate");
    const b = await body(c);
    if (!["none", "pause_campaign", "reject_campaign"].includes(b.action)) throw invalid("action must be none, pause_campaign or reject_campaign.");
    ctx.transparency.resolve(c.req.param("id"), String(b.resolution ?? ""), b.action, actor);
    return c.json({ resolved: true });
  });

  // ---- Analytics & revenue ----------------------------------------------------

  app.get("/analytics", (c) => {
    need(c, "analytics.read");
    const dataset = c.req.query("dataset") === "simulated" ? "simulated" : "measured";
    return c.json(ctx.analytics.report({ from: c.req.query("from"), to: c.req.query("to"), dataset, campaignId: c.req.query("campaignId"), publisherId: c.req.query("publisherId") }));
  });
  app.post("/analytics/simulate", async (c) => {
    const actor = need(c, "analytics.simulate");
    if (ctx.config.env === "production") throw new AppError(403, "not_in_production", "Simulated data is only available in development.");
    const b = await body(c);
    return c.json(ctx.analytics.simulate(String(b.campaignId), Number(b.days ?? 14), actor));
  });
  app.delete("/analytics/simulated", (c) => c.json({ deleted: ctx.analytics.clearSimulated(need(c, "analytics.simulate")) }));
  app.get("/revenue", async (c) => {
    need(c, "revenue.read");
    if (ctx.billing.gateway instanceof HcgPaymentsGateway) await ctx.billing.gateway.checkHealth();
    return c.json(ctx.billing.summary());
  });
  /**
   * TEST MODE: asks HCG Payments whether a campaign booking can be checked out. Internal campaigns
   * are never charged. Today HCG Payments refuses every paid advertising purpose until the Owner
   * activates it. Payment state never decides delivery.
   */
  app.post("/revenue/campaigns/:id/checkout-request", async (c) => {
    const actor = need(c, "revenue.write");
    if (ctx.config.env === "production") throw new AppError(403, "payments_disabled", "Payments are disabled in this release of HCG ADS.");
    const gw = ctx.billing.gateway;
    if (!(gw instanceof HcgPaymentsGateway)) throw new AppError(409, "hcg_payments_not_configured", "HCG Payments is not configured (config/payments.json). The local test-mode ledger is used.");
    const campaign = ctx.campaigns.get(c.req.param("id"));
    const decision = await gw.requestCheckout(campaign, c.get("principal").subject);
    ctx.audit.record(actor, "billing.checkout_request", "campaign", campaign.id, `HCG Payments (test mode): ${decision.outcome}${decision.code ? ` (${decision.code})` : ""}`, decision);
    return c.json(decision);
  });
  app.post("/revenue/ledger", async (c) => c.json({ id: ctx.billing.addEntry(await body(c), need(c, "revenue.write")) }, 201));

  return app;
}
