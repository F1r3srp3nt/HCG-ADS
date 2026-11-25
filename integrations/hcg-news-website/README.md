# HCG News website — HCG ADS integration (prepared, NOT applied)

**Status:** prepared on 25 Nov 2026 for the founder's review. Nothing has been changed in any HCG News or HCG website repository, nothing is deployed, and no live advertising is enabled.

## Where the HCG News website is

The public site `news.hakmicapitalgroup.com` is **a separate Lovable project**, not part of the main website repository. Sources:
- `hakmicapitalgroup/docs/hcg-news-integration.md`: "The HCG News project is a separate Lovable application at https://news.hakmicapitalgroup.com";
- `docs/news-api/website-handoff.md`: inspected as "HCG News commit 34ca57f6".

Its source is not in any repository available to HCG ADS:
- `F1r3srp3nt/hakmicapitalgroup` (commit `57d05ac`) holds the main site, the central `news.v1` API and the HCG News product page, but no reader pages;
- `F1r3srp3nt/HCG-News` holds only the iOS app.

Therefore **no patch could be generated and `git apply --check`-verified against the real page files.** This package is a self-contained component plus exact insertion instructions instead. The component itself is type-checked (see below).

## Files

| File | Purpose |
|---|---|
| `src/components/news/HcgAdsPlacement.tsx` | Drop-in React component (TypeScript, no new dependency). Inert until `VITE_HCG_ADS_ENDPOINT` is set: it then renders nothing and loads nothing. Loads the HCG ADS SDK once, renders one placement, destroys it on unmount. Exports `setHcgAdsConsent` for a consent mechanism. |

## Insertion points (in the HCG News project)

Put `HcgAdsPlacement.tsx` at `src/components/news/`. Then add the placements below, using the public placement keys from HCG ADS → Placements → HCG News (keys are public identifiers, not secrets).

| Page | Where | Code |
|---|---|---|
| Home | directly under the masthead / section navigation | `<HcgAdsPlacement placementKey={import.meta.env.VITE_HCG_ADS_HOME_LEADERBOARD} />` |
| Article (`/$category/$slug`) | sidebar column (desktop) | `<HcgAdsPlacement placementKey={import.meta.env.VITE_HCG_ADS_ARTICLE_SIDEBAR} category={category} />` |
| Article | **end of the article body** (see note) | `<HcgAdsPlacement placementKey={import.meta.env.VITE_HCG_ADS_IN_ARTICLE} category={category} />` |
| Article | before the related-stories list | `<HcgAdsPlacement placementKey={import.meta.env.VITE_HCG_ADS_RELATED} />` |

`category` is the article's section slug (it enables contextual campaigns).

**In-article position.** "After the 4th paragraph" is not recommended without seeing the renderer. Bodies are stored as HTML from the rich-text editor, and splitting that markup to inject a component risks breaking the editor's output, embeds and corrections. Use the end of the article body. Revisit once the renderer exposes paragraph blocks.

Every placement:
- collapses if HCG ADS returns nothing or is unreachable;
- reserves no space while loading (no layout shift);
- is labelled by the SDK with its disclosure ("Promoted by HCG" / "Sponsored").

## Configuration

| Variable | Value |
|---|---|
| `VITE_HCG_ADS_ENDPOINT` | The HCG ADS origin, e.g. `https://ads.hakmicapitalgroup.com` (once hosted). Leave unset to keep the integration completely off. |
| `VITE_HCG_ADS_HOME_LEADERBOARD`, `VITE_HCG_ADS_ARTICLE_SIDEBAR`, `VITE_HCG_ADS_IN_ARTICLE`, `VITE_HCG_ADS_RELATED` | Public placement keys from the production HCG ADS instance |

**Content-Security-Policy** (only if the site sends one): add the HCG ADS origin to these directives.

```
script-src  https://ads.hakmicapitalgroup.com
connect-src https://ads.hakmicapitalgroup.com
img-src     https://ads.hakmicapitalgroup.com https://qggdyzoydveafkmjgkpq.supabase.co
media-src   https://ads.hakmicapitalgroup.com
```

The Supabase host already serves HCG News's own article images, which article promotions reuse.

**Consent.** No consent mechanism was found in the code available for review. If HCG News has one, call `setHcgAdsConsent({ storage, measurement })` whenever the choice changes. Without it the SDK default applies: aggregate measurement only, nothing stored on the device. HCG ADS stores no reader identifiers either way.

## Paths to apply (founder's choice)

1. **Lovable-free (preferred):** if the HCG News project is connected to a GitHub repository, add the component and the four insertions in a normal commit to that repository. Lovable syncs from GitHub. No credits are used; publishing remains the founder's click.
2. **Lovable:** one prompt.

   > Add `src/components/news/HcgAdsPlacement.tsx` exactly as provided (do not modify it). Insert `<HcgAdsPlacement …/>` at the four places listed in its README using the `VITE_HCG_ADS_*` variables. Leave `VITE_HCG_ADS_ENDPOINT` unset. Change nothing else.

Either way the site is unaffected until `VITE_HCG_ADS_ENDPOINT` is set.

## Live delivery stays off

Setting the endpoint is not enough to show ads to readers. The HCG News publisher stays in **test** delivery mode in HCG ADS. In test mode HCG ADS serves only its registered test origins, never `news.hakmicapitalgroup.com`. Until the founder switches HCG News to *live* (founder only, typed confirmation), every request from the real site returns "no ad" and the slots collapse.

## Verification done

- The component type-checks under strict TypeScript against React 19 types, with a `vite/client`-style `import.meta.env` declaration (TypeScript 5.8).
- The same SDK calls (`init`, `render`, `destroy`, `setConsent`) are exercised by the SDK's test suite and by the 12-step browser acceptance test on the HCG News test page (`examples/hcg-news-testbed`).
- **Not verified:** a build of the HCG News project itself (source not available here).
