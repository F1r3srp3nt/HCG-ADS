import { useEffect, useRef, type CSSProperties } from "react";
import type { CropRect, DeliveryResponse, RenderableAd } from "@hcg-ads/contracts";
// The HCG ADS SDK's own renderer: previews are rendered by exactly the same code as on publishers.
import { renderAd } from "@hcg-ads/sdk-render";

/**
 * Renders a delivered ad with the HCG ADS SDK renderer inside a shadow root,
 * in a frame of the placement's exact size. Clicks are disabled: previews are
 * never followed and never counted.
 */

export interface FrameSpec {
  width: number | null;
  height: number | null;
  responsive: "fixed" | "fluid-width" | "responsive-native";
}

const PREVIEW_TIP = "Preview — clicks are not counted";

/** CSS that makes the crop rectangle fill its box (same maths as the SDK). Used for thumbnails. */
export function cropStyle(crop: CropRect): CSSProperties {
  return {
    position: "absolute",
    width: `${100 / crop.width}%`,
    height: "auto",
    left: `${(-crop.x / crop.width) * 100}%`,
    top: `${(-crop.y / crop.height) * 100}%`,
    maxWidth: "none",
  };
}

export function AdCreative({ ad, frame, device }: { ad: RenderableAd; frame: FrameSpec; device: "desktop" | "mobile" | "any" }) {
  const host = useRef<HTMLDivElement>(null);
  const fixed = frame.width && frame.height && frame.responsive !== "responsive-native";
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const root = el.shadowRoot ?? el.attachShadow({ mode: "open" });
    const { link } = renderAd(root, ad, { id: "preview", width: frame.width, height: frame.height, responsive: frame.responsive, fallback: "collapse" }, { clickUrl: ad.clickUrl });
    link.title = PREVIEW_TIP;
    link.removeAttribute("target");
  }, [ad, frame.width, frame.height, frame.responsive]);
  // Responsive native placements fill their container: give them a realistic column width.
  const width = fixed ? frame.width! : frame.responsive === "fluid-width" ? frame.width ?? "100%" : device === "mobile" ? 358 : 640;
  return (
    <div
      ref={host}
      className="ad-host"
      title={PREVIEW_TIP}
      style={{ width, maxWidth: fixed ? undefined : "100%" }}
      onClickCapture={(e) => { e.preventDefault(); e.stopPropagation(); }}
    />
  );
}

export function AdPreview({ response, device = "desktop", caption }: { response: DeliveryResponse; device?: "desktop" | "mobile"; caption?: string }) {
  const p = response.placement;
  const frame: FrameSpec = p ? { width: p.width, height: p.height, responsive: p.responsive } : { width: null, height: null, responsive: "responsive-native" };
  const fixedW = frame.width && frame.responsive !== "responsive-native" ? frame.width : null;
  const avail = device === "mobile" ? 358 : 900;
  const scale = fixedW && fixedW > avail ? avail / fixedW : 1;
  return (
    <div className={`preview-stage preview-${device}`}>
      <div className="preview-device" style={{ width: device === "mobile" ? 390 : "100%" }}>
        <div className="preview-page-chrome" aria-hidden>
          <span className="dot" /><span className="dot" /><span className="dot" />
          <span className="preview-url">publisher page · preview</span>
        </div>
        <div className="preview-canvas">
          <div className="preview-fake-text" aria-hidden><i /><i /><i style={{ width: "62%" }} /></div>
          {response.ad ? (
            <div className="preview-slot" style={scale < 1 ? { transform: `scale(${scale})`, transformOrigin: "top left", height: frame.height ? frame.height * scale : undefined, width: fixedW! * scale } : undefined}>
              <AdCreative ad={response.ad} frame={frame} device={device} />
            </div>
          ) : (
            <div className="preview-none">
              Nothing to show — <code>{response.reason ?? "no ad"}</code>. With fallback “{p?.fallback ?? "collapse"}”, the placement {p?.fallback === "keep-space" ? "keeps its space" : "collapses"}.
            </div>
          )}
          <div className="preview-fake-text" aria-hidden><i /><i style={{ width: "80%" }} /></div>
        </div>
      </div>
      <div className="preview-caption">
        {caption ?? (p ? `${frame.width && frame.height ? `${frame.width} × ${frame.height}` : "Responsive native"} · ${frame.responsive}` : "")}
        {scale < 1 && ` · shown at ${Math.round(scale * 100)}%`}
        <span className="preview-flag">PREVIEW · not counted</span>
      </div>
    </div>
  );
}
