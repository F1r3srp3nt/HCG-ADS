export { HCGAdsClient, VERSION, DEFAULT_CONSENT } from "./client";
export type { InitOptions, PlacementOptions, RenderEvent, EmptyEvent, ErrorEvent } from "./client";
export { FrequencyStore, FREQUENCY_KEY } from "./frequency";
export { cropStyle, cropAspect, layoutFor, deviceClass } from "./layout";
export { renderAd, STYLES } from "./render";
export { THEMES, THEME_VARIABLES, themeVariables, applyTheme, chipContrast, contrastRatio, parseColor } from "./theme";
export type { ThemeName, ThemeSpec, ThemeOption } from "./theme";
export * from "./types";

import { HCGAdsClient } from "./client";

/** Shared client for module users (the script build exposes the same object as window.HCGAds). */
export const HCGAds = new HCGAdsClient();
export default HCGAds;
