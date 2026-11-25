import { HCGAdsClient } from "./client";

/**
 * Script-tag build: <script src="https://<hcg-ads>/delivery/v1/sdk/hcg-ads.js" async></script>
 *
 * Exposes window.HCGAds. The endpoint defaults to the origin the script was
 * loaded from. Unless the script tag carries data-manual, placements marked
 * with data-hcg-ads-placement are rendered automatically once the page is ready.
 */
declare global {
  interface Window { HCGAds: HCGAdsClient; HCGAdsConfig?: import("./client").InitOptions }
}

(function () {
  if (typeof window === "undefined" || (window.HCGAds && window.HCGAds instanceof Object && "render" in window.HCGAds)) return;
  const client = new HCGAdsClient();
  const script = document.currentScript as HTMLScriptElement | null;
  try {
    const declared = script?.dataset.endpoint;
    if (declared) client.setEndpoint(declared);
    else if (script?.src) client.setEndpoint(new URL(script.src).origin);
  } catch { /* configured later through init() */ }
  window.HCGAds = client;
  if (script?.dataset.manual !== undefined) return;
  const start = () => { if (!client.initialised) client.init({ debug: script?.dataset.debug !== undefined, ...(window.HCGAdsConfig ?? {}) }); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else setTimeout(start, 0);
})();
