import type { MediaKind, Placement } from "@hcg-ads/contracts";

export interface MediaShape {
  kind: MediaKind;
  width: number | null;
  height: number | null;
  bytes: number;
  durationSeconds: number | null;
  animated: boolean;
}

export const ASPECT_TOLERANCE = 0.01;

export function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function aspectRatio(width: number | null, height: number | null): string | null {
  if (!width || !height) return null;
  const g = gcd(width, height);
  const w = width / g, h = height / g;
  // Prefer a readable approximation for near-standard ratios.
  if (w > 50 || h > 50) return `${(width / height).toFixed(2)}:1`;
  return `${w}:${h}`;
}

/**
 * Can this media be shown in this placement without stretching or distortion?
 * Fixed placements require the same aspect ratio (±1%) and at least the
 * placement's size. Responsive/native placements accept any image because the
 * renderer frames it explicitly (crop or contain), never by stretching.
 */
export function checkCompatibility(p: Pick<Placement, "formats" | "width" | "height" | "responsive" | "maxFileBytes" | "maxVideoSeconds" | "allowAnimation">, m: MediaShape): string[] {
  const problems: string[] = [];
  const kind: MediaKind = m.kind === "animated-image" && !p.formats.includes("animated-image") && p.formats.includes("image") && !m.animated ? "image" : m.kind;
  if (!p.formats.includes(kind)) problems.push(`This placement does not accept ${kind.replace("-", " ")} creatives.`);
  if (m.animated && !p.allowAnimation) problems.push("This placement does not allow animation.");
  if (m.bytes > p.maxFileBytes) problems.push(`The file is ${fmtBytes(m.bytes)}; this placement allows at most ${fmtBytes(p.maxFileBytes)}.`);
  if (m.kind === "video" && m.durationSeconds != null && m.durationSeconds > p.maxVideoSeconds) {
    problems.push(`The video is ${m.durationSeconds.toFixed(1)} s; this placement allows at most ${p.maxVideoSeconds} s.`);
  }
  if (p.responsive !== "responsive-native" && p.width && p.height) {
    if (!m.width || !m.height) {
      problems.push("The media dimensions could not be determined.");
    } else {
      const want = p.width / p.height;
      const have = m.width / m.height;
      if (Math.abs(have - want) / want > ASPECT_TOLERANCE) {
        problems.push(`Aspect ratio ${aspectRatio(m.width, m.height)} does not match the placement's ${aspectRatio(p.width, p.height)} (${p.width} × ${p.height}). Crop it or upload a matching variant.`);
      } else if (m.width < p.width || m.height < p.height) {
        problems.push(`The media is ${m.width} × ${m.height}; at least ${p.width} × ${p.height} is required so it is never upscaled.`);
      }
    }
  }
  return problems;
}

export function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}
