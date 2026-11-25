/**
 * Ad themes. A theme only sets the CSS custom properties the renderer already
 * reads (`--hcg-ads-*`); it never changes layout, sizing or media framing, so
 * media is framed (crop or contain) and never stretched in every theme.
 *
 * - `hcg-news`  : the light editorial default. It sets nothing, so rendering is
 *                 byte-for-byte the SDK's original look.
 * - `hcg-store` : HCG Store's dark futuristic look, from the Store's own tokens
 *                 (web-hcg-store/src/styles/tokens.css): obsidian surfaces,
 *                 silver hairlines, metal call-to-action, cyan focus only.
 * - `custom`    : the host passes its own `--hcg-ads-*` values.
 */
export type ThemeName = "hcg-news" | "hcg-store" | "custom";

export interface ThemeSpec {
  name: ThemeName;
  /** Custom property overrides (only `--hcg-ads-*` names are accepted). */
  vars?: Record<string, string>;
}

export type ThemeOption = ThemeName | ThemeSpec;

/** Every variable the renderer reads. */
export const THEME_VARIABLES = [
  "--hcg-ads-surface", "--hcg-ads-text", "--hcg-ads-muted", "--hcg-ads-border", "--hcg-ads-radius", "--hcg-ads-font",
  "--hcg-ads-accent", "--hcg-ads-cta-text", "--hcg-ads-focus", "--hcg-ads-chip", "--hcg-ads-chip-text", "--hcg-ads-media-bg",
] as const;

export const THEMES: Record<Exclude<ThemeName, "custom">, Record<string, string>> = {
  "hcg-news": {},
  "hcg-store": {
    "--hcg-ads-surface": "#0d1016",
    "--hcg-ads-text": "#f4f6f9",
    "--hcg-ads-muted": "#b2bccb",
    "--hcg-ads-border": "rgba(206, 220, 236, 0.15)",
    "--hcg-ads-radius": "14px",
    "--hcg-ads-font": '"Inter Variable", "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    "--hcg-ads-accent": "linear-gradient(180deg, #f2f5f9 0%, #d7dde6 48%, #b9c2ce 100%)",
    "--hcg-ads-cta-text": "#05070a",
    "--hcg-ads-focus": "#45e1f5",
    "--hcg-ads-chip": "rgba(5, 7, 10, 0.86)",
    "--hcg-ads-chip-text": "#45e1f5",
    "--hcg-ads-media-bg": "#080a0f",
  },
};

const NAMES = new Set<string>(THEME_VARIABLES);
/** Values that could load resources or break out of a declaration are refused. */
const UNSAFE = /url\s*\(|image-set|expression|javascript:|[;{}<>\\]|@import/i;

export function isThemeName(v: unknown): v is ThemeName {
  return v === "hcg-news" || v === "hcg-store" || v === "custom";
}

/** The custom properties to apply for a theme (validated; unknown names and unsafe values are dropped). */
export function themeVariables(theme: ThemeOption | null | undefined): Record<string, string> {
  const spec: ThemeSpec = typeof theme === "string" ? { name: theme } : theme ?? { name: "hcg-news" };
  const base = spec.name === "custom" ? {} : THEMES[isThemeName(spec.name) ? (spec.name as Exclude<ThemeName, "custom">) : "hcg-news"] ?? {};
  const out: Record<string, string> = { ...base };
  for (const [k, v] of Object.entries(spec.vars ?? {})) {
    if (NAMES.has(k) && typeof v === "string" && v.length <= 200 && !UNSAFE.test(v)) out[k] = v.trim();
  }
  return out;
}

export function applyTheme(el: HTMLElement, theme: ThemeOption | null | undefined): void {
  if (theme == null) return; // default: the original light editorial rendering, untouched
  const vars = themeVariables(theme);
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  const name = typeof theme === "string" ? theme : theme?.name ?? "hcg-news";
  el.setAttribute("data-theme", isThemeName(name) ? name : "hcg-news");
}

// ---- Contrast (WCAG 2.x) -----------------------------------------------------

type RGBA = [number, number, number, number];

export function parseColor(c: string): RGBA | null {
  const s = c.trim().toLowerCase();
  let m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), 1];
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  return null;
}

function over(top: RGBA, bottom: [number, number, number]): [number, number, number] {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/**
 * Worst-case contrast of the disclosure chip: the chip may sit over any image,
 * so its (possibly translucent) background is composited over both black and
 * white, and the lower ratio is returned.
 */
export function chipContrast(chipBg: string, chipText: string): number {
  const bg = parseColor(chipBg), fg = parseColor(chipText);
  if (!bg || !fg) return 0;
  return Math.min(...([[0, 0, 0], [255, 255, 255]] as Array<[number, number, number]>).map((under) => {
    const chip = over(bg, under);
    return contrastRatio(over(fg, chip), chip);
  }));
}
