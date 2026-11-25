# Status — HCG ADS 0.1.0 (25 November 2026)

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
