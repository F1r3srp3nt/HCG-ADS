/**
 * HCG ADS placement for the HCG News website (drop-in component).
 *
 * Inert until configured: if VITE_HCG_ADS_ENDPOINT is not set, it renders
 * nothing and loads nothing. When set, it loads the HCG ADS web SDK once from
 * `${endpoint}/delivery/v1/sdk/hcg-ads.js` and renders one placement.
 *
 * - The placement key is a public identifier from HCG ADS → Placements (not a secret).
 * - If HCG ADS is unreachable or returns no ad, the slot collapses; the page is unaffected.
 * - Ad text is rendered by the SDK inside a closed Shadow DOM as text only.
 * - Live delivery stays off until the founder switches HCG News to "live" in HCG ADS;
 *   until then HCG ADS only serves its registered test origins.
 */
import { useEffect, useRef } from "react";

type Consent = { storage: boolean; measurement: boolean };
type HcgAdsGlobal = {
  init(options: { endpoint?: string; consent?: Consent | (() => Consent); autoScan?: boolean; theme?: string }): unknown;
  render(target: Element, options: { placement: string; context?: { category?: string }; theme?: string }): Promise<unknown>;
  destroy(target: Element): void;
  setConsent(consent: Consent | (() => Consent)): void;
};

declare global {
  interface Window {
    HCGAds?: HcgAdsGlobal;
  }
}

const ENDPOINT = (import.meta.env.VITE_HCG_ADS_ENDPOINT as string | undefined)?.replace(/\/+$/, "") || "";

let sdkPromise: Promise<HcgAdsGlobal | null> | null = null;

/** Loads the SDK script once per page. Resolves to null on any failure (the slot then stays empty). */
function loadSdk(consent?: () => Consent): Promise<HcgAdsGlobal | null> {
  if (!ENDPOINT || typeof window === "undefined") return Promise.resolve(null);
  if (window.HCGAds) return Promise.resolve(window.HCGAds);
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = `${ENDPOINT}/delivery/v1/sdk/hcg-ads.js`;
      script.async = true;
      script.dataset.manual = "";
      script.onload = () => {
        const sdk = window.HCGAds ?? null;
        sdk?.init({ endpoint: ENDPOINT, autoScan: false, theme: "hcg-news", ...(consent ? { consent } : {}) });
        resolve(sdk);
      };
      script.onerror = () => resolve(null);
      document.head.appendChild(script);
    });
  }
  return sdkPromise;
}

/**
 * Optional consent bridge. HCG News has no consent mechanism in the code inspected for this
 * package; if one exists, call this with its current choice (and again when it changes).
 * Without it, the SDK's default applies: aggregate measurement on, nothing stored on the device.
 */
export function setHcgAdsConsent(consent: Consent): void {
  if (typeof window !== "undefined") window.HCGAds?.setConsent(consent);
}

export function HcgAdsPlacement({ placementKey, category, className }: { placementKey: string | undefined; category?: string; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !placementKey || !ENDPOINT) return;
    let cancelled = false;
    loadSdk().then((sdk) => {
      if (!cancelled && sdk && ref.current) void sdk.render(ref.current, { placement: placementKey, context: category ? { category } : undefined });
    });
    return () => {
      cancelled = true;
      try { window.HCGAds?.destroy(el); } catch { /* never break the page */ }
    };
  }, [placementKey, category]);

  if (!ENDPOINT || !placementKey) return null;
  return <div ref={ref} className={className} data-hcg-ads-slot="" aria-label="Advertisement" />;
}

export default HcgAdsPlacement;
