# @hcg-ads/sdk — HCG ADS JavaScript SDK

Zero-dependency browser SDK for HCG ADS placements (delivery contract v1).

## Script tag

```html
<div data-hcg-ads-placement="plc_pub_…" data-hcg-ads-category="technology"></div>
<script src="https://<hcg-ads>/delivery/v1/sdk/hcg-ads.js" async></script>
```

The endpoint defaults to the script's origin (override with `data-endpoint`). Placements are rendered on
DOMContentLoaded. Add `data-manual` to the script tag to call `HCGAds.init()` yourself, `data-debug` for console logs.

## API

```js
HCGAds.init({ endpoint, consent: { storage, measurement } | () => consent, device, context: { category, keywords },
              timeoutMs: 3000, debug, autoScan: true, observe: false, onRender, onEmpty, onError });
HCGAds.render(elementOrSelector, { placement: "plc_pub_…", context });   // Promise<RenderableAd | null>, never rejects
HCGAds.refresh(el); HCGAds.destroy(el); HCGAds.setConsent(c); HCGAds.version;
```

Elements also receive `hcg-ads:render`, `hcg-ads:empty` and `hcg-ads:error` DOM events and a `data-hcg-ads-state` attribute.

## Behaviour

- Ads render in a closed Shadow DOM; ad text is set with `textContent` only. Theme via CSS custom properties
  (`--hcg-ads-accent`, `--hcg-ads-surface`, `--hcg-ads-border`, `--hcg-ads-font`, …).
- The disclosure label is always visible. Media uses the creative's explicit crop or `object-fit: contain`; it is never stretched.
- Fallback when nothing is delivered or anything fails: `collapse` hides the element (`display:none`, `aria-hidden`);
  `keep-space` keeps the placement height empty; `house-ad` is chosen by the server — if it still returns nothing, the element collapses.
- An unknown `contractVersion` is treated as empty.
- Measurement only with `consent.measurement`: one impression on render, one viewable (≥50% visible for 1 s), video quartiles,
  media errors — each at most once per delivery. Without consent, clicks go to `clickUrl?m=0` (not counted).
- Frequency limits: counters stay on the device (`localStorage["hcg-ads:freq"]` with storage consent, memory otherwise);
  only capped campaign ids are sent as `exclude`.
- No response caching: every render/refresh is a new delivery. Only the resolved endpoint and configuration are kept.

## Develop

```sh
npm run build -w @hcg-ads/sdk      # dist/hcg-ads.js, hcg-ads.min.js, index.mjs, types/
npm run typecheck -w @hcg-ads/sdk
npm test -w @hcg-ads/sdk
```
