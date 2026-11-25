import { createContext, useContext, useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { HCGAdsClient, type AdContext, type Consent, type RenderableAd } from "@hcg-ads/sdk";

interface ProviderValue { client: HCGAdsClient }
const Ctx = createContext<ProviderValue | null>(null);

export interface HCGAdsProviderProps {
  /** Base URL of HCG ADS (public delivery API). No keys are needed or accepted. */
  endpoint: string;
  consent?: Consent;
  context?: AdContext;
  debug?: boolean;
  children?: ReactNode;
}

/** Provides one HCG ADS client to the placements below it. */
export function HCGAdsProvider({ endpoint, consent, context, debug, children }: HCGAdsProviderProps) {
  const client = useMemo(() => new HCGAdsClient(), []);
  useMemo(() => client.init({ endpoint, context, debug, autoScan: false }), [client, endpoint, context, debug]);
  useEffect(() => { if (consent) client.setConsent(consent); }, [client, consent?.storage, consent?.measurement]);
  useEffect(() => () => client.destroyAll(), [client]);
  return <Ctx.Provider value={{ client }}>{children}</Ctx.Provider>;
}

export interface HCGAdPlacementProps {
  /** Public placement key registered in HCG ADS. */
  placement: string;
  context?: AdContext;
  className?: string;
  style?: CSSProperties;
  onRender?: (ad: RenderableAd) => void;
  onEmpty?: (reason: string) => void;
}

/**
 * An advertising placement. Renders nothing visible (collapses) when no ad is
 * available or anything fails, so the host page is never affected.
 */
export function HCGAdPlacement({ placement, context, className, style, onRender, onEmpty }: HCGAdPlacementProps) {
  const value = useContext(Ctx);
  const ref = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onRender, onEmpty });
  callbacks.current = { onRender, onEmpty };
  const contextKey = JSON.stringify(context ?? {});

  useEffect(() => {
    const el = ref.current;
    if (!value || !el) return;
    const rendered = (e: Event) => callbacks.current.onRender?.((e as CustomEvent<{ ad: RenderableAd }>).detail.ad);
    const empty = (e: Event) => callbacks.current.onEmpty?.((e as CustomEvent<{ reason: string }>).detail.reason);
    const failed = () => callbacks.current.onEmpty?.("error");
    el.addEventListener("hcg-ads:render", rendered);
    el.addEventListener("hcg-ads:empty", empty);
    el.addEventListener("hcg-ads:error", failed);
    void value.client.render(el, { placement, context });
    return () => {
      el.removeEventListener("hcg-ads:render", rendered);
      el.removeEventListener("hcg-ads:empty", empty);
      el.removeEventListener("hcg-ads:error", failed);
      value.client.destroy(el);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, placement, contextKey]);

  if (!value) return null;
  return <div ref={ref} className={className} style={style} data-hcg-ads-react="" />;
}

export function useHCGAds(): HCGAdsClient | null {
  return useContext(Ctx)?.client ?? null;
}
