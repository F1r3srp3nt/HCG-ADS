#!/usr/bin/env node
/**
 * HCG ADS — first end-to-end acceptance test (12 steps), in a real browser.
 *
 * Runs a throwaway HCG ADS server (fresh local database, loopback only) against
 * the LIVE, published HCG News articles (read-only, public API), drives the
 * command center UI, displays the ad in the HCG News test environment via the
 * web SDK, records a real impression and click, pauses from HCG ADS and checks
 * that delivery stops. Nothing is written to HCG News; nothing is published live.
 *
 * Requires: `npm run build` first; Playwright with Chromium.
 * Behind an HTTPS proxy the browser uses HTTPS_PROXY (bypassing loopback).
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.ACCEPTANCE_PORT ?? 7810);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = resolve(process.env.ACCEPTANCE_OUT ?? join(ROOT, "test-results/acceptance"));
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
mkdirSync(OUT, { recursive: true });

function loadPlaywright() {
  const req = createRequire(import.meta.url);
  for (const p of ["playwright", "/opt/node-tools/node_modules/playwright"]) {
    try { return req(p); } catch { /* next */ }
  }
  throw new Error("Playwright is not installed. Install it (npm i -D playwright) and run `npx playwright install chromium`.");
}

for (const f of ["apps/admin/dist/index.html", "packages/sdk-js/dist/hcg-ads.js"]) {
  if (!existsSync(join(ROOT, f))) { console.error(`Missing ${f}. Run: npm run build`); process.exit(2); }
}

const results = [];
const record = (n, name, ok, evidence) => {
  results.push({ step: n, name, ok, evidence });
  console.log(`${ok ? "PASS" : "FAIL"}  ${String(n).padStart(2)}. ${name} — ${evidence}`);
  if (!ok) throw new Error(`Step ${n} failed: ${evidence}`);
};
const api = async (method, path, body) => {
  const r = await fetch(`${BASE}/admin/v1${path}`, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  return r.json();
};

// ---- Server ---------------------------------------------------------------
const dataDir = mkdtempSync(join(tmpdir(), "hcg-ads-acceptance-"));
const server = spawn(process.execPath, ["--import", "tsx", join(ROOT, "apps/server/src/main.ts")], {
  cwd: ROOT,
  env: { ...process.env, NODE_USE_ENV_PROXY: "1", HCG_ADS_ENV: "development", HCG_ADS_PORT: String(PORT), HCG_ADS_DATA_DIR: dataDir, HCG_ADS_PUBLIC_URL: BASE },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));
const stop = () => { try { server.kill(); } catch { /* gone */ } };
process.on("exit", stop);

for (let i = 0; i < 100; i++) {
  try { if ((await fetch(`${BASE}/healthz`)).ok) break; } catch { /* starting */ }
  await new Promise((r) => setTimeout(r, 200));
}

const { chromium } = loadPlaywright();
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined;
const browser = await chromium.launch(proxy ? { proxy } : {});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: UA });
const problems = [];
let exitCode = 0;

/** Reads text inside the SDK's closed shadow roots (CDP pierce). */
async function shadowTexts(page, cls) {
  const cdp = await page.context().newCDPSession(page);
  const { root } = await cdp.send("DOM.getDocument", { depth: -1, pierce: true });
  const nodes = [];
  const walk = (n, inShadow) => {
    const attrs = n.attributes ?? [];
    const c = attrs[attrs.indexOf("class") + 1] ?? "";
    if (inShadow && attrs.includes("class") && c.split(" ").includes(cls)) nodes.push(n);
    (n.children ?? []).forEach((x) => walk(x, inShadow));
    (n.shadowRoots ?? []).forEach((x) => walk(x, true));
  };
  walk(root, false);
  const out = [];
  for (const n of nodes) out.push((await cdp.send("DOM.getOuterHTML", { nodeId: n.nodeId })).outerHTML.replace(/<[^>]+>/g, "").trim());
  return out;
}

try {
  const admin = await ctx.newPage();
  admin.on("pageerror", (e) => problems.push(`admin pageerror: ${e.message}`));
  admin.on("console", (m) => { if (m.type() === "error") problems.push(`admin console: ${m.text()}`); });

  // 1. Open HCG ADS
  await admin.goto(`${BASE}/#/command-center`);
  await admin.waitForSelector(".stats", { timeout: 20000 });
  record(1, "Open HCG ADS", true, `command center loaded at ${BASE} (${await admin.locator(".nav a, nav a").count()} navigation entries)`);
  await admin.screenshot({ path: join(OUT, "01-command-center.png") });

  // 2. Connect HCG News
  await admin.goto(`${BASE}/#/content-sources`);
  await admin.waitForSelector(".source-card");
  await admin.getByRole("button", { name: "Connect HCG News" }).click();
  await admin.waitForSelector(".article", { timeout: 60000 });
  const sources = (await api("GET", "/content-sources")).sources;
  const news = sources.find((s) => s.id === "src_hcg_news");
  const pubs = (await api("GET", "/publishers")).publishers;
  record(2, "Connect HCG News", news.status === "connected" && pubs.some((p) => p.id === "pub_hcg_news" && p.status === "active"),
    `content source ${news.status}; publisher HCG News ${pubs.find((p) => p.id === "pub_hcg_news")?.status}, delivery mode ${pubs.find((p) => p.id === "pub_hcg_news")?.deliveryMode}`);

  // 3. Browse actual published articles
  const live = (await api("GET", "/content-sources/src_hcg_news/items?limit=50")).items;
  const shown = await admin.locator(".article").count();
  record(3, "Browse actual published articles", shown > 0 && live.length > 0 && live.every((i) => i.status === "published" && i.canonicalUrl?.startsWith("https://news.hakmicapitalgroup.com/")),
    `${shown} live articles shown; newest: "${live[0]?.headline}" (${live[0]?.publishedAt?.slice(0, 10)})`);
  await admin.screenshot({ path: join(OUT, "03-articles.png") });

  // 4. Select an article
  const card = admin.locator(".article:not([disabled])").first();
  const headline = (await card.locator("h3, h4, .article-title, strong").first().innerText().catch(() => "")).trim();
  await card.click();
  const pressed = await card.getAttribute("aria-pressed");
  const article = live.find((i) => !i.isDemo);
  record(4, "Select an article", pressed === "true", `selected "${headline || article.headline}"`);

  // 5 + 6. Create an internal campaign, selecting an HCG News placement
  await admin.getByRole("button", { name: "Create campaign" }).click();
  await admin.waitForSelector(".modal .pick");
  await admin.locator(".modal .pick", { hasText: "300 × 250" }).first().click();
  await admin.screenshot({ path: join(OUT, "05-create-campaign.png") });
  await admin.getByRole("button", { name: "Create draft" }).click();
  await admin.waitForURL(/#\/campaigns\/cmp_/, { timeout: 30000 });
  const campaignId = admin.url().split("/").pop();
  let campaign = await api("GET", `/campaigns/${campaignId}`);
  const placements = (await api("GET", "/placements?publisherId=pub_hcg_news")).placements;
  const sidebar = placements.find((p) => p.slot === "article-sidebar");
  record(5, "Create an internal campaign", campaign.kind === "internal" && campaign.state === "draft" && campaign.creatives[0]?.type === "article-card",
    `${campaignId} "${campaign.name}" (internal, draft, article card → ${campaign.creatives[0]?.destinationUrl})`);
  record(6, "Select an HCG News placement", campaign.placementIds.includes(sidebar.id), `${sidebar.name} ${sidebar.width} × ${sidebar.height}, public key ${sidebar.publicKey}`);

  // 7. Preview the advertisement
  await admin.waitForSelector(".ad-host", { timeout: 20000 });
  await admin.waitForTimeout(800);
  const previewText = (await shadowTexts(admin, "headline")).join(" | ");
  await admin.screenshot({ path: join(OUT, "07-preview.png") });
  record(7, "Preview the advertisement", previewText.length > 0 && (await admin.getByText(/not counted/i).count()) > 0,
    `preview rendered by the SDK renderer in the ${sidebar.width} × ${sidebar.height} frame: "${previewText}" (not counted)`);

  // 8. Approve and activate (test environment)
  await admin.getByRole("button", { name: "Submit for approval" }).click();
  await admin.waitForSelector(".lifecycle .chip-amber", { timeout: 20000 });
  await admin.getByRole("button", { name: "Approve" }).first().click();
  await admin.locator(".modal").getByRole("button", { name: "Approve" }).click();
  await admin.waitForSelector(".lifecycle .chip-cyan", { timeout: 30000 });
  await admin.getByRole("button", { name: "Activate" }).first().click();
  await admin.locator(".modal").getByRole("button", { name: "Activate" }).click();
  await admin.waitForSelector(".lifecycle .chip-green", { timeout: 20000 });
  campaign = await api("GET", `/campaigns/${campaignId}`);
  await admin.screenshot({ path: join(OUT, "08-active.png") });
  record(8, "Approve and activate in a test environment", campaign.state === "active",
    `state ${campaign.state}; history: ${campaign.history.map((h) => h.action).join(" → ")}; HCG News delivery mode: test`);

  // 9. Display the advertisement on HCG News (test environment)
  const keys = Object.fromEntries(placements.map((p) => [p.slot, p.publicKey]));
  const q = new URLSearchParams({ leaderboard: keys["home-leaderboard"], sidebar: keys["article-sidebar"], inarticle: keys["in-article"], related: keys["related-article"], mobile: keys["mobile-banner"] });
  const before = (await api("GET", `/analytics?campaignId=${campaignId}`)).totals;
  const news1 = await ctx.newPage();
  news1.on("pageerror", (e) => problems.push(`testbed pageerror: ${e.message}`));
  await ctx.route("https://news.hakmicapitalgroup.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<h1>HCG News destination (intercepted by the acceptance test)</h1>" }));
  await news1.goto(`${BASE}/testbed/?article=${article.externalId}&${q}`);
  await news1.waitForSelector(".article .headline", { timeout: 30000 });
  const sidebarHost = news1.locator("#slot-sidebar .ad-host");
  await news1.waitForFunction(() => document.querySelector("#slot-sidebar .ad-host")?.getAttribute("data-hcg-ads-state") === "rendered", null, { timeout: 15000 });
  await sidebarHost.scrollIntoViewIfNeeded();
  await news1.waitForLoadState("networkidle").catch(() => undefined);
  const shownAd = (await shadowTexts(news1, "headline")).join(" | ");
  const chips = (await shadowTexts(news1, "chip")).join(" | ");
  await news1.screenshot({ path: join(OUT, "09-hcg-news-testbed.png") });
  record(9, "Display the advertisement on HCG News", shownAd.length > 0 && /Promoted by HCG/.test(chips),
    `article page "${(await news1.textContent(".article .headline")).trim()}" shows "${shownAd}" labelled "${chips.split(" | ")[0]}"`);

  // 10. Record an actual impression and click
  await news1.waitForTimeout(2500); // viewability: ≥50% visible for ≥1 s
  const box = await sidebarHost.boundingBox();
  const [popup] = await Promise.all([ctx.waitForEvent("page"), news1.mouse.click(box.x + box.width / 2, box.y + box.height / 2)]);
  await popup.waitForLoadState();
  const landed = popup.url();
  await popup.close();
  await news1.waitForTimeout(800);
  const after = (await api("GET", `/analytics?campaignId=${campaignId}`)).totals;
  record(10, "Record an actual impression and click",
    after.impressions - before.impressions >= 1 && after.clicks - before.clicks === 1 && after.invalid === 0 && landed === campaign.creatives[0].destinationUrl,
    `impressions ${before.impressions}→${after.impressions}, viewable ${before.viewable}→${after.viewable}, clicks ${before.clicks}→${after.clicks}, invalid ${after.invalid}; click landed on ${landed}`);

  // 11. Pause the campaign from HCG ADS
  await admin.bringToFront();
  await admin.reload();
  await admin.waitForSelector(".lifecycle");
  await admin.getByRole("button", { name: "Pause now" }).click();
  await admin.waitForSelector(".lifecycle .chip-orange", { timeout: 20000 });
  campaign = await api("GET", `/campaigns/${campaignId}`);
  record(11, "Pause the campaign from HCG ADS", campaign.state === "paused", `state ${campaign.state} (reason ${campaign.stateReason})`);

  // 12. Verify that the advertisement stops being delivered
  await news1.reload();
  await news1.waitForSelector(".article .headline", { timeout: 30000 });
  await news1.waitForFunction(() => ["empty", "error"].includes(document.querySelector("#slot-sidebar .ad-host")?.getAttribute("data-hcg-ads-state") ?? ""), null, { timeout: 15000 });
  const state = await sidebarHost.getAttribute("data-hcg-ads-state");
  const display = await sidebarHost.evaluate((e) => getComputedStyle(e).display);
  const direct = await (await fetch(`${BASE}/delivery/v1/ad`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ placement: sidebar.publicKey }) })).json();
  await news1.screenshot({ path: join(OUT, "12-after-pause.png") });
  record(12, "Verify that the advertisement stops being delivered", state === "empty" && display === "none" && direct.ad === null,
    `placement ${state}, collapsed (display: ${display}); delivery API: ad ${direct.ad}, reason ${direct.reason}`);

  if (problems.length) console.log("\nBrowser problems:\n" + problems.join("\n"));
} catch (e) {
  exitCode = 1;
  console.error(`\n${e.message}`);
  if (problems.length) console.error("Browser problems:\n" + problems.join("\n"));
  console.error("\nServer log (tail):\n" + serverLog.split("\n").slice(-20).join("\n"));
} finally {
  writeFileSync(join(OUT, "results.json"), JSON.stringify({ at: new Date().toISOString(), base: BASE, results, problems }, null, 2));
  await browser.close();
  stop();
  console.log(`\n${results.filter((r) => r.ok).length}/12 steps passed. Screenshots and results.json: ${OUT}`);
  process.exit(exitCode || (results.length === 12 && results.every((r) => r.ok) ? 0 : 1));
}
