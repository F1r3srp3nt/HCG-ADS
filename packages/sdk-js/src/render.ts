import type { PlacementInfo, RenderableAd } from "./types";
import { cropAspect, cropStyle, layoutFor } from "./layout";
import { applyTheme, type ThemeOption } from "./theme";

/**
 * Renders a RenderableAd. Every piece of ad text is set with textContent;
 * ad data is never parsed as HTML. The disclosure label is always visible.
 * Media is framed explicitly (crop or contain) and never stretched.
 */

export const STYLES = `
:host { all: initial; display: block; contain: content; }
* { box-sizing: border-box; }
.hcg-ad { position: relative; display: block; overflow: hidden; text-decoration: none; color: var(--hcg-ads-text, #111418);
  background: var(--hcg-ads-surface, #ffffff); border: 1px solid var(--hcg-ads-border, rgba(17,20,24,.14)); border-radius: var(--hcg-ads-radius, 10px);
  font: 14px/1.35 var(--hcg-ads-font, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif); container-type: inline-size; }
.hcg-ad:focus-visible { outline: 2px solid var(--hcg-ads-focus, var(--hcg-ads-accent, #0b7cff)); outline-offset: 2px; }
.box-fixed { width: var(--w); height: var(--h); max-width: 100%; }
.box-fluid { width: 100%; max-width: var(--w); aspect-ratio: var(--ratio); }
.box-responsive { width: 100%; }
.chip { position: absolute; z-index: 3; top: 6px; left: 6px; padding: 2px 7px; border-radius: 999px; font-size: 10.5px; font-weight: 650; letter-spacing: .02em;
  color: var(--hcg-ads-chip-text, #ffffff); background: var(--hcg-ads-chip, rgba(17,20,24,.78)); line-height: 1.5; pointer-events: none; white-space: nowrap; }
.hcg-frame { position: relative; display: block; width: 100%; }
.why { position: absolute; z-index: 4; top: 6px; right: 6px; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  font: 700 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; text-decoration: none;
  color: var(--hcg-ads-chip-text, #ffffff); background: var(--hcg-ads-chip, rgba(17,20,24,.78)); }
.why:focus-visible { outline: 2px solid var(--hcg-ads-focus, var(--hcg-ads-accent, #0b7cff)); outline-offset: 1px; }
.micro .why, .micro + .why { width: 14px; height: 14px; font-size: 9px; top: 2px; right: 2px; }
.card { display: flex; height: 100%; }
.stacked .card, .responsive .card { flex-direction: column; }
.horizontal .card { flex-direction: row; align-items: stretch; }
.img { position: relative; overflow: hidden; background: var(--hcg-ads-media-bg, #e9ecf1); flex: none; }
.stacked .img { width: 100%; height: 42%; }
.stacked .body { justify-content: flex-start; min-height: 0; }
.stacked .text { min-height: 0; overflow: hidden; }
.stacked .headline { -webkit-line-clamp: 2; }
.stacked .desc { -webkit-line-clamp: 1; }
.stacked .cta { margin-top: auto; }
.stacked:not(.has-img) .headline { -webkit-line-clamp: 4; }
.stacked:not(.has-img) .desc { -webkit-line-clamp: 3; }
.responsive .img { width: 100%; aspect-ratio: var(--img-ratio, 16 / 9); }
.horizontal .img { height: 100%; aspect-ratio: var(--img-ratio, 1 / 1); max-width: 40%; }
.img img { position: absolute; display: block; }
.img img.cover { inset: 0; width: 100%; height: 100%; object-fit: cover; }
.img img.cropped { height: auto; max-width: none; }
.body { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; min-width: 0; flex: 1; justify-content: center; }
.horizontal .body { flex-direction: row; align-items: center; gap: 12px; padding: 6px 12px 6px 14px; }
.text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.sponsor { font-size: 11px; color: var(--hcg-ads-muted, #5b6472); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.headline { font-weight: 700; font-size: 15px; line-height: 1.25; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
.desc { color: var(--hcg-ads-muted, #5b6472); font-size: 13px; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
.cta { align-self: flex-start; margin-top: 4px; padding: 6px 12px; border-radius: 999px; font-weight: 650; font-size: 12.5px; white-space: nowrap;
  color: var(--hcg-ads-cta-text, #ffffff); background: var(--hcg-ads-accent, #0b7cff); }
.horizontal .cta { align-self: center; margin-top: 0; }
.horizontal .chip { top: 4px; left: 4px; }
.horizontal.has-img .chip { left: 4px; }
.compact .headline { font-size: 13.5px; -webkit-line-clamp: 2; }
.compact .desc { display: none; }
.micro .headline { font-size: 12.5px; -webkit-line-clamp: 1; white-space: nowrap; display: block; text-overflow: ellipsis; }
.micro .desc, .micro .sponsor { display: none; }
.micro .cta { padding: 4px 9px; font-size: 11px; }
.micro .body { padding: 4px 8px 4px 10px; gap: 8px; }
.micro .chip { font-size: 9px; padding: 1px 5px; top: 2px; left: 2px; }
.horizontal:not(.has-img) .body { padding-top: 16px; }
.micro.horizontal:not(.has-img) .body { padding-top: 11px; }
.stacked:not(.has-img) .body, .responsive:not(.has-img) .body { padding-top: 30px; }
@container (min-width: 520px) {
  .responsive .card { flex-direction: row; }
  .responsive .img { width: 38%; aspect-ratio: auto; min-height: 150px; }
  .responsive .headline { font-size: 17px; }
}
.media-box { position: absolute; inset: 0; overflow: hidden; background: var(--hcg-ads-media-bg, #0d1016); }
.media-box img.contain, .media-box video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
.media-box img.cropped { position: absolute; height: auto; max-width: none; }
.video-cta { position: absolute; z-index: 3; right: 8px; bottom: 8px; padding: 6px 12px; border-radius: 999px; font: 650 12.5px/1.2 var(--hcg-ads-font, sans-serif);
  color: var(--hcg-ads-cta-text, #fff); background: var(--hcg-ads-accent, #0b7cff); text-decoration: none; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
`;

export interface RenderResult {
  /** The clickable element. */
  link: HTMLAnchorElement;
  /** Media element whose failure should trigger the fallback, if any. */
  media: HTMLImageElement | HTMLVideoElement | null;
  video: HTMLVideoElement | null;
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, typeof location !== "undefined" ? location.href : undefined);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function sizeBox(box: HTMLElement, p: PlacementInfo | null) {
  if (p && p.width && p.height && p.responsive !== "responsive-native") {
    box.style.setProperty("--w", `${p.width}px`);
    box.style.setProperty("--h", `${p.height}px`);
    box.style.setProperty("--ratio", `${p.width} / ${p.height}`);
    box.classList.add(p.responsive === "fluid-width" ? "box-fluid" : "box-fixed");
  } else {
    box.classList.add("box-responsive");
  }
}

function image(doc: Document, url: string, alt: string, crop: import("./types").CropRect | null, fallbackClass: "cover" | "contain"): HTMLImageElement {
  const img = el(doc, "img");
  img.src = url;
  img.alt = alt;
  img.decoding = "async";
  img.loading = "lazy";
  img.setAttribute("referrerpolicy", "no-referrer");
  img.draggable = false;
  if (crop) {
    const s = cropStyle(crop);
    img.className = "cropped";
    img.style.width = s.width;
    img.style.left = s.left;
    img.style.top = s.top;
  } else {
    img.className = fallbackClass;
  }
  return img;
}

/** Wraps the ad with its "Why this ad?" link (a sibling: links are never nested). */
function framed(doc: Document, root: ShadowRoot | HTMLElement, ad: RenderableAd, placement: PlacementInfo | null, adEl: HTMLElement) {
  const frame = el(doc, "div", "hcg-frame");
  if (placement?.width && placement.responsive !== "responsive-native") frame.style.maxWidth = `${placement.width}px`;
  frame.appendChild(adEl);
  const info = ad.transparencyUrl ? safeUrl(ad.transparencyUrl) : null;
  if (info) {
    const why = el(doc, "a", "why", "i");
    why.href = info;
    why.target = "_blank";
    why.rel = "noopener nofollow";
    why.title = "Why this ad?";
    why.setAttribute("aria-label", `Why this ad? Information about this ${ad.disclosure.toLowerCase()} and how to report it`);
    frame.appendChild(why);
  }
  root.appendChild(frame);
}

export function renderAd(root: ShadowRoot | HTMLElement, ad: RenderableAd, placement: PlacementInfo | null, opts: { clickUrl: string; theme?: ThemeOption }): RenderResult {
  const doc = (root as ShadowRoot).ownerDocument ?? (root as HTMLElement).ownerDocument ?? document;
  while (root.firstChild) root.removeChild(root.firstChild);
  const style = el(doc, "style");
  style.textContent = STYLES;
  root.appendChild(style);

  const { layout, density } = layoutFor(placement);
  const media = ad.media && safeUrl(ad.media.url) ? ad.media : null;
  const isMediaCreative = !!media && (ad.type === "image" || ad.type === "video") && media.kind !== "native";
  const clickUrl = safeUrl(opts.clickUrl) ?? "#";

  const label = `${ad.disclosure}: ${ad.headline} — ${ad.sponsorName}`;

  // Video creatives: the video is not inside the link (interactive content), a CTA link sits on top.
  if (isMediaCreative && media!.kind === "video") {
    const box = el(doc, "div", "hcg-ad");
    sizeBox(box, placement);
    applyTheme(box, opts.theme);
    if (box.classList.contains("box-responsive")) box.style.aspectRatio = media!.width && media!.height ? `${media!.width} / ${media!.height}` : "16 / 9";
    box.appendChild(el(doc, "span", "chip", ad.disclosure));
    const mbox = el(doc, "div", "media-box");
    const video = el(doc, "video");
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.controls = true;
    video.preload = "metadata";
    const poster = safeUrl(media!.posterUrl);
    if (poster) video.poster = poster;
    video.src = safeUrl(media!.url)!;
    video.setAttribute("aria-label", label);
    mbox.appendChild(video);
    box.appendChild(mbox);
    const link = el(doc, "a", "video-cta", ad.callToAction);
    link.href = clickUrl;
    link.target = "_blank";
    link.rel = "noopener sponsored";
    link.title = ad.displayUrl;
    box.appendChild(link);
    framed(doc, root, ad, placement, box);
    return { link, media: video, video };
  }

  const link = el(doc, "a", `hcg-ad ${isMediaCreative ? "" : layout} ${density}`.trim());
  link.href = clickUrl;
  link.target = "_blank";
  link.rel = "noopener sponsored";
  link.title = ad.displayUrl;
  link.setAttribute("aria-label", label);
  sizeBox(link, placement);
  applyTheme(link, opts.theme);
  link.appendChild(el(doc, "span", "chip", ad.disclosure));
  let mediaEl: HTMLImageElement | null = null;

  if (isMediaCreative) {
    // Image / animated image creative at placement size: explicit crop, otherwise contain.
    if (link.classList.contains("box-responsive")) {
      link.style.aspectRatio = media!.crop && media!.width && media!.height
        ? String(cropAspect(media!.crop, media!.width, media!.height))
        : media!.width && media!.height ? `${media!.width} / ${media!.height}` : "16 / 9";
    }
    const mbox = el(doc, "div", "media-box");
    mediaEl = image(doc, safeUrl(media!.url)!, media!.alt ?? ad.headline, media!.crop, "contain");
    if (!media!.crop) mediaEl.className = "contain";
    mbox.appendChild(mediaEl);
    link.appendChild(mbox);
    link.appendChild(el(doc, "span", "sr", `${ad.headline}. ${ad.callToAction}`));
  } else {
    // Native / article card.
    const card = el(doc, "div", "card");
    if (media && media.kind !== "video") {
      link.classList.add("has-img");
      const frame = el(doc, "div", "img");
      if (media.crop && media.width && media.height) frame.style.setProperty("--img-ratio", String(cropAspect(media.crop, media.width, media.height)));
      mediaEl = image(doc, safeUrl(media.url)!, media.alt ?? "", media.crop, "cover");
      if (media.crop && !(media.width && media.height)) {
        // Unknown natural size: learn it, then frame the crop at its own aspect ratio.
        mediaEl.addEventListener("load", () => {
          if (mediaEl!.naturalWidth && mediaEl!.naturalHeight) frame.style.setProperty("--img-ratio", String(cropAspect(media.crop!, mediaEl!.naturalWidth, mediaEl!.naturalHeight)));
        });
      }
      frame.appendChild(mediaEl);
      card.appendChild(frame);
    }
    const body = el(doc, "div", "body");
    const text = el(doc, "div", "text");
    text.appendChild(el(doc, "span", "sponsor", ad.sponsorName));
    text.appendChild(el(doc, "span", "headline", ad.headline));
    if (ad.description) text.appendChild(el(doc, "span", "desc", ad.description));
    body.appendChild(text);
    body.appendChild(el(doc, "span", "cta", ad.callToAction));
    card.appendChild(body);
    link.appendChild(card);
  }
  framed(doc, root, ad, placement, link);
  return { link, media: mediaEl, video: null };
}
