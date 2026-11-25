import type { CropRect, PlacementInfo } from "./types";

/**
 * Positions an image inside its box so that exactly the crop rectangle fills
 * the box. Scaling is uniform (based on width), so media is never stretched;
 * the box clips the rest. Values are percentages of the box.
 */
export function cropStyle(crop: CropRect): { width: string; left: string; top: string } {
  const cw = Math.max(crop.width, 0.0001);
  const ch = Math.max(crop.height, 0.0001);
  const pct = (v: number) => `${Math.round(v * 10000) / 10000}%`;
  return { width: pct(100 / cw), left: pct((-crop.x / cw) * 100), top: pct((-crop.y / ch) * 100) };
}

/** Aspect ratio (w / h) of a crop applied to media of a known size. */
export function cropAspect(crop: CropRect, width: number, height: number): number {
  return (crop.width * width) / (crop.height * height);
}

export type Layout = "horizontal" | "stacked" | "responsive";
export type Density = "micro" | "compact" | "regular";

export function layoutFor(p: PlacementInfo | null): { layout: Layout; density: Density; fixed: boolean } {
  if (!p || p.responsive === "responsive-native" || !p.width || !p.height) return { layout: "responsive", density: "regular", fixed: false };
  const ratio = p.width / p.height;
  const layout: Layout = ratio > 2.5 ? "horizontal" : "stacked";
  const density: Density = p.height <= 60 ? "micro" : p.height <= 120 ? "compact" : layout === "stacked" && p.width <= 180 ? "compact" : "regular";
  return { layout, density, fixed: true };
}

export function deviceClass(width: number): "mobile" | "tablet" | "desktop" {
  if (width < 640) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
}
