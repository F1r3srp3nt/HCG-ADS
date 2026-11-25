# Consolidated integration request — for the founder's approval

**Status: DRAFT. Nothing below has been sent, deployed or changed.** HCG ADS was built with zero Lovable credits.
The items below are the minimum changes outside this repository that are needed before HCG ADS can run against
production identity and show advertisements on the live HCG News website. Approve, edit or reject each item.

Everything that could be done without these changes is already done and tested (see `docs/STATUS.md`).

## A. HCG News website (news.hakmicapitalgroup.com) — one Lovable change

Goal: let the website show HCG ADS placements. No database change is needed: HCG ADS already reads published
articles through the public, row-level-secured API the website itself uses.

1. Add the SDK once (e.g. in the root layout), only when an environment flag is set so it can be switched off
   without a redeploy of HCG ADS:
   ```html
   <script src="https://ads.hakmicapitalgroup.com/delivery/v1/sdk/hcg-ads.js" async></script>
   ```
2. Add placement containers (the keys come from HCG ADS → Placements after HCG News is registered on the
   production instance; they are public identifiers, not secrets):
   | Page | Container | Size |
   |---|---|---|
   | Home, under the masthead | `<div data-hcg-ads-placement="<home-leaderboard key>"></div>` | 728 × 90 (fluid) |
   | Article page, sidebar | `<div data-hcg-ads-placement="<article-sidebar key>" data-hcg-ads-category="{section slug}"></div>` | 300 × 250 |
   | Article page, after the 4th paragraph | `<div data-hcg-ads-placement="<in-article key>" data-hcg-ads-category="{section slug}"></div>` | responsive native |
   | Article page, end of article | `<div data-hcg-ads-placement="<related-article key>"></div>` | responsive native |
   | Mobile (≤ 640 px), below the lead story | `<div data-hcg-ads-placement="<mobile-banner key>"></div>` | 320 × 50 |
3. If the site sends a Content-Security-Policy, add `https://ads.hakmicapitalgroup.com` to `script-src`,
   `connect-src` and `img-src` (and `media-src` for video).
4. Wire the site's consent choice, if any, to `window.HCGAds.setConsent({ storage, measurement })`.
   Without a call, the SDK uses HCG ADS's default (measurement on, device storage off).
5. Nothing else changes: the article editor, published articles, routes and styles stay as they are. If HCG ADS
   is unreachable or returns nothing, the containers collapse and the page is unaffected.

Live delivery stays **off** after this change: the HCG News publisher remains in *test* mode until you switch it
to *live* in HCG ADS (founder only, typed confirmation).

## B. HCG Connect / ERP App Access (central HCG)

1. Register the product **HCG ADS** in ERP App Access and issue its product key.
2. Issue one feature key per role and assign them centrally:
   `founder`, `ads_administrator`, `campaign_manager`, `publisher_administrator`, `advertiser`,
   `creative_reviewer`, `finance_administrator`, `analytics_viewer`. Assign `founder` to your account.
3. Register an HCG Connect OAuth client for the HCG ADS command center (public client with PKCE, redirect
   `https://ads.hakmicapitalgroup.com/auth/callback`), or confirm that the sister-app password grant used by
   HCG News iOS is acceptable for it.
4. Confirm the `POST /api/public/ecosystem/v1/check` response body (`{ "allowed": boolean, … }`), as HCG Server also
   depends on it.

These values go into `config/hcg-connect.json` (template: `config/hcg-connect.example.json`). It holds no secrets.

## C. Hosting decision (not Lovable)

`ads.hakmicapitalgroup.com` needs a host for the HCG ADS server (Node 22). Options: an HCG-managed cloud host,
or HCG Server once its gateway supports public exposure. **Do not expose a personal MacBook to the internet.**
No production infrastructure has been deployed.

## D. Optional hardening (HCG backend)

Column privileges for the `anon` role on `news_articles` (`created_by`, `seo_title`, `view_count` are readable today;
HCG ADS never requests them). This is the same optional item already recorded by the HCG News iOS project.
