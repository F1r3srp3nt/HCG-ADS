/**
 * HCG ADS public delivery contract, version 1 (mirrors packages/contracts).
 * The SDK carries its own copy so it has no runtime or build dependency.
 */
export const CONTRACT_VERSION = "1";

export type DeviceClass = "any" | "desktop" | "tablet" | "mobile";
export type MediaKind = "image" | "animated-image" | "video" | "native";
export type CreativeType = "article-card" | "image" | "video" | "native-text";
export type ResponsiveBehavior = "fixed" | "fluid-width" | "responsive-native";
export type FallbackBehavior = "collapse" | "house-ad" | "keep-space";
export type EventType =
  | "impression" | "viewable" | "click" | "video_start" | "video_25" | "video_50" | "video_75" | "video_complete" | "error";

export interface Consent {
  /** May the SDK keep frequency counters on this device (localStorage)? */
  storage: boolean;
  /** May impressions and clicks be measured (aggregate, no identifiers)? */
  measurement: boolean;
}

export interface CropRect { x: number; y: number; width: number; height: number }

export interface AdContext { category?: string; keywords?: string[] }

export interface DeliveryRequest {
  placement: string;
  platform?: "web";
  device?: DeviceClass;
  context?: AdContext;
  consent?: Consent;
  exclude?: string[];
  sdk?: { name: string; version: string };
  preview?: string;
}

export interface AdMedia {
  kind: MediaKind;
  url: string;
  width: number | null;
  height: number | null;
  mime: string | null;
  posterUrl: string | null;
  crop: CropRect | null;
  alt: string | null;
}

export interface RenderableAd {
  deliveryId: string;
  campaignId: string;
  creativeId: string;
  type: CreativeType;
  headline: string;
  description: string | null;
  callToAction: string;
  clickUrl: string;
  displayUrl: string;
  disclosure: string;
  sponsorName: string;
  media: AdMedia | null;
  frequency: { count: number; windowHours: number } | null;
  beacons: { impression: string; viewable: string; video: string };
  preview: boolean;
}

export interface PlacementInfo {
  id: string;
  width: number | null;
  height: number | null;
  responsive: ResponsiveBehavior;
  fallback: FallbackBehavior;
}

export interface DeliveryResponse {
  contractVersion: string;
  placement: PlacementInfo | null;
  ad: RenderableAd | null;
  reason?: string;
}
