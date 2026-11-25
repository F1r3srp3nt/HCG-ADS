# Status — HCG ADS 0.2.0 (25 November 2026)

Development build. **Not deployed. No live advertisements. No payments.** Production advertising and payments are
disabled by default. Zero Lovable credits used.

## v0.2.0 production-readiness objectives

| Objective | State | Evidence |
|---|---|---|
| HCG Connect sign-in | **Implemented per HCG's verified contracts.** Authorization code + PKCE S256 + state + nonce against live-discovered endpoints; ID and access tokens verified; server-owned sessions (HttpOnly cookie, tokens sealed AES-256-GCM, never sent to the browser); CSRF + Origin on writes; refresh; `/me` for identity and organisations; roles from ERP App Access `/check`, fresh for consequential actions; founder role only from HCG's Founder policy. **Unavailable until HCG issues the web client** (no client invented). The old paste-a-token screen is removed. | `test/signin.test.ts` (simulated HCG, ES256) · `scripts/signin-browser-check.mjs`: 8/8 in Chromium against a **local stand-in** (HCG's real consent page not yet exercisable) |
| Central product and role registration | **Request prepared**: `hcg.ads` registry entry, 7 role feature keys, 2 web clients on the main site's §7 template | [HCG-CONNECT-REGISTRATION-REQUEST.md](HCG-CONNECT-REGISTRATION-REQUEST.md) |
| Production hosting preparation | **Prepared, not deployed.** Dockerfile (non-root, `/data` volume, healthcheck), `/readyz`, HSTS, production guards (https only, delivery secret required, dev identity refused), server-level `HCG_ADS_LIVE_DELIVERY` switch (default off) | Production-mode run: admin 503 fail-closed, readiness explains, live off. CI `container-image` job builds and probes the image on GitHub (Docker builds cannot fetch packages in this container) · [PRODUCTION-DEPLOY.md](PRODUCTION-DEPLOY.md) |
| HCG News SDK integration | **Component prepared, not applied.** The HCG News site's source is not in any available repository, so no patch could be verified against it | `integrations/hcg-news-website/` (inert until configured; typechecked against React 19) · request §A |
| HCG Store futuristic theme | **Implemented**: SDK themes `hcg-news` (default, unchanged), `hcg-store` (from the Store's tokens), `custom`; disclosure contrast ≥ 4.5:1 tested; Store testbed | 8 theme tests · `/testbed-store/` |
| HCG Store content source | **Implemented**: listed catalogue products only; drafts never shown; becomes active once the Store publishes its catalogue at a URL | `test/store-source.test.ts` with the real catalogue |
| HCG Representation creative assets | **Not available**: HCG Store lists it as a draft with no published description, media or status. Nothing invented; it appears automatically through the Store source once published | Store catalogue entry `hcg-representation` (draft) |
| HCG Server media storage | **Adapter verified** against the real `hcg-agent` (unchanged since v0.1.0); production guide recommends HCG Server as storage behind HCG ADS, not as a public host | `test/hcg-server.test.ts` (run with `HCG_SERVER_AGENT`) |
| HCG Payments test-mode integration | **Implemented** per HCG Payments API v1 and its ADS purposes contract; **verified against the real HCG Payments service** running locally in test mode: signed client accepted, every paid ads purpose refused (`purpose_not_activated`), wrong secret refused; internal campaigns never sent; production refuses checkout requests | `test/hcg-payments.test.ts` (6 tests, 3 live with `HCG_PAYMENTS_URL`) |
| Swift and .NET SDK validation | **Validated natively on GitHub's runners**: Swift build + tests on Linux; Swift build + tests on macOS and an iOS Simulator build (SwiftUI/AVKit/UIKit); .NET SDK (netstandard2.0 + net8.0) + Avalonia control, build with warnings as errors + tests | GitHub Actions "Native SDKs" run 45660844160: 3/3 jobs green · .NET live run recorded one impression |
| Advertising governance and privacy | **Implemented**: "Why this ad?" (sponsor, who paid, main parameters, no personal data; DSA Art. 26 spirit) on every ad; anonymous reporting; automatic pause after 3 serious reports in 24 h; reviewer queue; records of processing and DPIA screening | `test/transparency.test.ts` · [PRIVACY-AND-GOVERNANCE.md](PRIVACY-AND-GOVERNANCE.md) |

Also fixed: native apps could not receive test delivery (publishers rejected `app://` test origins).

**Tests:**
- server: 51 passed, plus 4 that run only against real services (HCG Server agent, HCG Payments; all passed when run);
- web SDK: 27;
- .NET: 15 + 4;
- Swift: on CI;
- 12-step browser acceptance: **12/12** (unchanged);
- sign-in browser check: 8/8 (local stand-in).

## What needs you or another team

| Item | Who |
|---|---|
| Register `hcg.ads`, its feature keys and the two web clients | HCG Owner (ERP), [request](HCG-CONNECT-REGISTRATION-REQUEST.md) |
| Add the placement component to the HCG News site | HCG News (GitHub commit or one Lovable prompt) |
| Publish the HCG Store catalogue at a URL (e.g. `/catalogue/products.json`) | HCG Store |
| Publish HCG Representation's details and assets | HCG |
| Register an `hcg-ads` commerce client and ads prices in HCG Payments; approve an ads purpose | HCG Payments + Owner |
| Choose a host; set `HCG_ADS_LIVE_DELIVERY=enabled` only at go-live | Founder |

---

# v0.1.0 status (kept for reference)


Development build. **Not deployed. No live advertisements. No payments.**

## Acceptance test (12 steps) — passed

`npm run acceptance` (`scripts/acceptance.mjs`) runs in Chromium against the **live, published HCG News
articles** (read-only) with a throwaway local database. Result on 25 Nov 2026: **12/12 passed**.

| # | Step | Evidence from the run |
|---|---|---|
| 1 | Open HCG ADS | Command center loaded, 13 navigation sections |
| 2 | Connect HCG News | Content source `connected`; HCG News publisher `active`, delivery mode `test`, 8 placements |
| 3 | Browse actual published articles | 12 live articles; newest "Nvidia's $1.5 Trillion Roller Coaster…" (25 Nov 2026) |
| 4 | Select an article | Selected in the article browser |
| 5 | Create an internal campaign | Draft internal campaign with an article card → `https://news.hakmicapitalgroup.com/business/…` |
| 6 | Select an HCG News placement | Article sidebar 300 × 250 |
| 7 | Preview | Rendered by the SDK's own renderer in a 300 × 250 frame, marked "not counted" |
| 8 | Approve and activate (test environment) | `create → submit → approve → activate`; HCG News still in test mode |
| 9 | Display on HCG News | HCG News test environment (real article page) shows the ad with "Promoted by HCG" |
| 10 | Record an impression and click | impressions 0→1, viewable 0→1, clicks 0→1, invalid 0; click landed on the article URL |
| 11 | Pause from HCG ADS | "Pause now" → `paused` |
| 12 | Delivery stops | Placement `empty` and collapsed (`display: none`); delivery API `ad: null` (`no_eligible_campaign`) |

Step 9 uses the **HCG News test environment** (`examples/hcg-news-testbed`, served at `/testbed/` in development):
real published articles from the publication's public API, with HCG ADS placements via the web SDK. The live
website itself is not changed — that needs the Lovable change in
[LOVABLE-INTEGRATION-REQUEST.md](LOVABLE-INTEGRATION-REQUEST.md), awaiting your approval.

## Implemented

| Area | State |
|---|---|
| Command center (13 sections) | Implemented; browser-tested on desktop and at 390 px, no console errors |
| Internal & external campaigns, full lifecycle (9 states), scheduling, priority, rotation (even / weighted by CTR / sequential), impression & daily limits, frequency limits (device-side), duplication, history | Implemented, tested |
| HCG News content source (browse, search, category, paging, refresh/sync, auto-suspension on unpublication) | Implemented, tested (fake + live) |
| Publisher & placement registration, standard formats + custom + responsive native, test/live delivery modes | Implemented, tested |
| Media upload: PNG/JPEG/WebP/GIF (incl. animated)/MP4/WebM, content-type detection, dimensions, aspect ratio, duration, thumbnails, image optimisation, WebM→MP4 transcoding, versions, quotas, deletion + retention | Implemented, tested with real files (ffmpeg) |
| Creative Studio: copy editing, CTA, per-device and per-placement variants, crop tool, responsive previews | Implemented, browser-tested |
| Approval & moderation: readiness checks, OS-warning imitation filter, URL policy, four-eyes for external | Implemented, tested |
| Delivery engine: origin/app authorisation, emergency shutdown, contextual criteria, house-ad fallback, signed tokens, dedup, invalid-traffic separation | Implemented, tested |
| Analytics: measured vs simulated datasets (never mixed), by day/campaign/placement/publisher/creative, retention | Implemented, tested |
| Revenue: test-mode projections and ledger | Implemented (test mode only) |
| Governance: audit log, settings, emergency shutdown, consent defaults | Implemented, tested |
| HCG Connect identity provider (JWT + ERP App Access) | Implemented, tested with locally signed ES256 tokens and a fake Ecosystem API; **not configured** (keys not issued) |
| HCG Server storage adapter | Implemented, **tested against the real `hcg-agent`** built from F1r3srp3nt/HCG-Server |
| Web SDK, React SDK | Implemented, tested (18 SDK unit tests + live browser run) |
| Swift SDK | Written, **not compiled** (no Swift toolchain in this environment) |
| .NET / Avalonia SDK | Interface specification only |

Test totals: server 31 passed (+1 that runs only with `HCG_SERVER_AGENT`, passed locally), SDK 18 passed,
acceptance 12/12.

## Outstanding (needs a decision or another system)

| Item | Owner |
|---|---|
| ERP App Access product + feature keys for HCG ADS; HCG Connect client for the command center | Central HCG (request B) |
| HCG News website embeds the SDK (live delivery stays off until you switch it on) | HCG News via Lovable (request A) |
| Host for `ads.hakmicapitalgroup.com` | Your decision (request C) |
| HCG Payments integration (budgets, credits, invoices, payouts) | HCG Payments — not built yet |
| HCG Store / HCG website content contracts | Those products |
| Executive Control Center reporting contract | HCG ECC |
| HCG Connect sign-in screen in the command center | After the client is registered; the bearer-token path is implemented |
| Swift SDK compilation on a Mac; iOS app integration in HCG News | Next milestone |
