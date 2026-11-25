import type { CSSProperties } from "react";
import type { CropRect, DeliveryResponse, RenderableAd } from "@hcg-ads/contracts";

/**
 * Renders a delivered ad the way the HCG ADS SDK does, inside a frame of the
 * placement's exact size. Clicks are disabled: previews are never counted.
 */

export interface FrameSpec {
  width: number | null;
  height: number | null;
  responsive: "fixed" | "fluid-width" | "responsive-native";
}

const PREVIEW_TIP = "Preview — clicks are not counted";

/** CSS that makes the crop rectangle fill its box exactly (no stretching when ratios match). */
export function cropStyle(crop: CropRect): CSSProperties {
  return {
    position: "absolute",
    width: `${100 / crop.width}%`,
    height: `${100 / crop.height}%`,
    left: `${(-crop.x / crop.width) * 100}%`,
    top: `${(-crop.y / crop.height) * 100}%`,
    maxWidth: "none",
  };
}

function Media({ ad, fit }: { ad: RenderableAd; fit: "contain" | "cover" }) {
  const m = ad.media!;
  const style: CSSProperties = m.crop ? cropStyle(m.crop) : { width: "100%", height: "100%", objectFit: fit, display: "block" };
  if (m.kind === "video") {
    return <video src={m.url} poster={m.posterUrl ?? undefined} muted playsInline controls loop style={style} aria-label={m.alt ?? ad.headline} />;
  }
  return <img src={m.url} alt={m.alt ?? ad.headline} style={style} draggable={false} />;
}

export function AdCreative({ ad, frame, device }: { ad: RenderableAd; frame: FrameSpec; device: "desktop" | "mobile" | "any" }) {
  const fixed = frame.width && frame.height && frame.responsive !== "responsive-native";
  const W = fixed ? frame.width! : device === "mobile" ? 360 : 640;
  const H = fixed ? frame.height! : null;
  const stop = (e: React.MouseEvent) => e.preventDefault();

  // Media creatives (image/video): exact placement size, crop or contain.
  if ((ad.type === "image" || ad.type === "video") && ad.media) {
    return (
      <a href={ad.clickUrl} onClick={stop} title={PREVIEW_TIP} className="hcgad hcgad-media" style={{ width: W, height: H ?? Math.round(W * ((ad.media.height ?? 9) / (ad.media.width ?? 16))) }}>
        <div className="hcgad-media-box"><Media ad={ad} fit="contain" /></div>
        <span className="hcgad-label">{ad.disclosure}</span>
      </a>
    );
  }

  // Native / article card.
  const ratio = H ? W / H : device === "mobile" ? 1 : 3;
  const horizontal = H ? ratio > 2.5 : device !== "mobile";
  const tiny = H !== null && H <= 100;
  const style: CSSProperties = { width: W, height: H ?? undefined };
  return (
    <a href={ad.clickUrl} onClick={stop} title={PREVIEW_TIP} className={`hcgad hcgad-card ${horizontal ? "hcgad-h" : "hcgad-v"} ${tiny ? "hcgad-tiny" : ""}`} style={style}>
      {ad.media && (
        <div className="hcgad-img" style={horizontal ? { width: tiny ? Math.min(H! * 1.6, W * 0.28) : "38%" } : { height: H ? Math.round(H * 0.48) : Math.round(W * 0.5625) }}>
          <Media ad={ad} fit="cover" />
        </div>
      )}
      <div className="hcgad-body">
        <div className="hcgad-meta">
          <span className="hcgad-label">{ad.disclosure}</span>
          {!tiny && <span className="hcgad-sponsor">{ad.sponsorName}</span>}
        </div>
        <div className="hcgad-headline">{ad.headline}</div>
        {ad.description && !tiny && <div className="hcgad-desc">{ad.description}</div>}
        <span className="hcgad-cta">{ad.callToAction}</span>
      </div>
    </a>
  );
}

export function AdPreview({ response, device = "desktop", caption }: { response: DeliveryResponse; device?: "desktop" | "mobile"; caption?: string }) {
  const p = response.placement;
  const frame: FrameSpec = p ? { width: p.width, height: p.height, responsive: p.responsive } : { width: null, height: null, responsive: "responsive-native" };
  const fixedW = frame.width && frame.responsive !== "responsive-native" ? frame.width : null;
  const viewport = device === "mobile" ? 390 : 1100;
  const scale = fixedW && fixedW > viewport - 32 ? (viewport - 32) / fixedW : 1;
  return (
    <div className={`preview-stage preview-${device}`}>
      <div className="preview-device" style={{ width: device === "mobile" ? 390 : "100%" }}>
        <div className="preview-page-chrome" aria-hidden>
          <span className="dot" /><span className="dot" /><span className="dot" />
          <span className="preview-url">news.hakmicapitalgroup.com · preview</span>
        </div>
        <div className="preview-canvas">
          <div className="preview-fake-text" aria-hidden><i /><i /><i style={{ width: "62%" }} /></div>
          {response.ad ? (
            <div className="preview-slot" style={{ transform: scale < 1 ? `scale(${scale})` : undefined, transformOrigin: "top left", height: scale < 1 && frame.height ? frame.height * scale : undefined }}>
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
