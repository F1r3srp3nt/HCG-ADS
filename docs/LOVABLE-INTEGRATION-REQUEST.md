# Consolidated integration request — for the founder's approval

**Status: DRAFT (updated for v0.2.0). Nothing below has been sent, deployed or changed.** HCG ADS was built with zero Lovable credits.
The items below are the minimum changes outside this repository that are needed before HCG ADS can run against
production identity and show advertisements on the live HCG News website. Approve, edit or reject each item.

Everything that could be done without these changes is already done and tested (see `docs/STATUS.md`).

## A. HCG News website (news.hakmicapitalgroup.com) — one change

The HCG News site is a separate Lovable project. Its source is not in any GitHub repository available to HCG ADS (the main
website repository holds the central news API and a product page only), so no patch could be applied and checked against it.

1. Add `integrations/hcg-news-website/src/components/news/HcgAdsPlacement.tsx` unchanged. It renders nothing until
   `VITE_HCG_ADS_ENDPOINT` is set, so it is inert until you switch it on.
2. Insert it at the four points listed in `integrations/hcg-news-website/README.md`:
   - home, under the masthead (leaderboard);
   - article sidebar (300 × 250);
   - end of the article body (responsive native);
   - before related stories.
3. If the site sends a Content-Security-Policy, add the HCG ADS origin to `script-src`, `connect-src`, `img-src` and `media-src`.
4. Prefer a GitHub commit to the News project's repository (no credits). Otherwise use the single Lovable prompt in that README.

Nothing else changes, and live delivery stays **off**:
- HCG News remains in *test* mode in HCG ADS until you switch it to live (founder only, typed confirmation);
- in production, the server-level switch `HCG_ADS_LIVE_DELIVERY` must also be `enabled`.

## B. HCG Connect / ERP App Access (central HCG, ERP actions, no Lovable)

See [HCG-CONNECT-REGISTRATION-REQUEST.md](HCG-CONNECT-REGISTRATION-REQUEST.md):
- the `hcg.ads` registry entry;
- seven role feature keys (the founder role comes from HCG's Founder policy);
- two dedicated public PKCE web clients, filled in on the main site's own §7 template.

## C. Hosting decision (not Lovable) — see [PRODUCTION-DEPLOY.md](PRODUCTION-DEPLOY.md)

`ads.hakmicapitalgroup.com` needs a host for the HCG ADS server (Node 22). Options: an HCG-managed cloud host,
or HCG Server once its gateway supports public exposure. **Do not expose a personal MacBook to the internet.**
No production infrastructure has been deployed.

## D. Optional hardening (HCG backend)

Column privileges for the `anon` role on `news_articles` (`created_by`, `seo_title`, `view_count` are readable today;
HCG ADS never requests them). This is the same optional item already recorded by the HCG News iOS project.
