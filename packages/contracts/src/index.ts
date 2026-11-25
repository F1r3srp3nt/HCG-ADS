/**
 * HCG ADS shared contracts, version 1.
 *
 * These types are the documented, versioned interfaces between the HCG ADS
 * modules, the administration API (/admin/v1), the public delivery API
 * (/delivery/v1), the command center and the SDKs.
 *
 * Within v1 changes are additive only. A breaking change creates v2.
 */

export const CONTRACT_VERSION = "1" as const;
export const PRODUCT_ID = "hcg.ads" as const;
export const PRODUCT_VERSION = "0.1.0" as const;

// ---------------------------------------------------------------------------
// Identity and governance (HCG Connect)
// ---------------------------------------------------------------------------

/** HCG ADS roles. Assignment is governed centrally by HCG (ERP App Access). */
export const ROLES = [
  "founder",
  "ads_administrator",
  "campaign_manager",
  "publisher_administrator",
  "advertiser",
  "creative_reviewer",
  "finance_administrator",
  "analytics_viewer",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  founder: "Founder",
  ads_administrator: "Advertising administrator",
  campaign_manager: "Campaign manager",
  publisher_administrator: "Publisher administrator",
  advertiser: "Advertiser",
  creative_reviewer: "Creative reviewer",
  finance_administrator: "Finance administrator",
  analytics_viewer: "Analytics viewer",
};

/** Operations HCG ADS authorises server-side. */
export const PERMISSIONS = [
  "dashboard.read",
  "campaigns.read",
  "campaigns.write",
  "campaigns.submit",
  "campaigns.approve",
  "campaigns.activate",
  "campaigns.pause",
  "advertisers.read",
  "advertisers.write",
  "advertisers.approve",
  "publishers.read",
  "publishers.write",
  "publishers.approve",
  "placements.write",
  "content_sources.read",
  "content_sources.write",
  "media.read",
  "media.write",
  "media.delete",
  "creatives.write",
  "creatives.moderate",
  "analytics.read",
  "analytics.simulate",
  "revenue.read",
  "revenue.write",
  "governance.read",
  "governance.emergency",
  "settings.write",
  "audit.read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = PERMISSIONS;
/** Which roles grant which operations. Roles themselves are assigned by HCG. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  founder: ALL,
  ads_administrator: ALL.filter((p) => p !== "revenue.write"),
  campaign_manager: [
    "dashboard.read", "campaigns.read", "campaigns.write", "campaigns.submit", "campaigns.activate",
    "campaigns.pause", "advertisers.read", "publishers.read", "content_sources.read", "media.read",
    "media.write", "creatives.write", "analytics.read",
  ],
  publisher_administrator: [
    "dashboard.read", "publishers.read", "publishers.write", "placements.write", "campaigns.read",
    "campaigns.pause", "analytics.read", "content_sources.read", "content_sources.write",
  ],
  advertiser: [
    "dashboard.read", "campaigns.read", "campaigns.write", "campaigns.submit", "media.read", "media.write",
    "creatives.write", "analytics.read", "publishers.read",
  ],
  creative_reviewer: [
    "dashboard.read", "campaigns.read", "campaigns.approve", "creatives.moderate", "media.read",
    "advertisers.read", "publishers.read", "content_sources.read", "governance.read",
  ],
  finance_administrator: ["dashboard.read", "revenue.read", "revenue.write", "campaigns.read", "analytics.read", "advertisers.read"],
  analytics_viewer: ["dashboard.read", "analytics.read", "campaigns.read", "publishers.read"],
};

export interface Principal {
  /** HCG Connect subject (account id). */
  subject: string;
  displayName: string;
  email?: string;
  roles: Role[];
  permissions: Permission[];
  /** "hcg-connect" in production; "development" only on a local, clearly labelled build. */
  authority: "hcg-connect" | "development";
  organisationId?: string | null;
  /** Web sessions only: the token state-changing requests must echo in `x-hcg-ads-csrf`. */
  csrfToken?: string;
}

// ---------------------------------------------------------------------------
// Content sources
// ---------------------------------------------------------------------------

export type ContentSourceKind = "hcg-news" | "hcg-store" | "hcg-website" | "custom";
export type ContentSourceStatus = "not_configured" | "connected" | "degraded" | "disconnected";

export interface ContentSource {
  id: string;
  kind: ContentSourceKind;
  name: string;
  status: ContentSourceStatus;
  description: string;
  lastSyncAt: string | null;
  lastSyncResult: string | null;
  itemCount: number;
  connectedAt: string | null;
}

/** A piece of HCG content that can be promoted (an article, a product, a page). */
export interface ContentItem {
  /** Stable identifier inside the source (e.g. the article UUID). */
  externalId: string;
  sourceId: string;
  kind: "article" | "product" | "page";
  headline: string;
  description: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  canonicalUrl: string | null;
  category: { id: string; name: string; slug: string } | null;
  contentType: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
  status: "published" | "unpublished" | "unavailable";
  isDemo: boolean;
  /** Promotional metadata the source exposes (featured, breaking, reading time…). */
  promotional: Record<string, string | number | boolean | null>;
}

export interface ContentPage {
  items: ContentItem[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Publishers and placements
// ---------------------------------------------------------------------------

export type Platform = "web" | "ios" | "android" | "macos" | "windows" | "linux" | "desktop";
export type PublisherStatus = "pending" | "active" | "suspended" | "rejected";
/** test: delivers only to registered test origins. live: requires explicit founder approval. */
export type DeliveryMode = "test" | "live";

export interface Publisher {
  id: string;
  productId: string;
  name: string;
  domains: string[];
  appIdentifiers: string[];
  testOrigins: string[];
  ownerSubject: string | null;
  administrators: string[];
  platforms: Platform[];
  supportedFormats: MediaKind[];
  campaignEligibility: { internal: boolean; external: boolean };
  status: PublisherStatus;
  deliveryMode: DeliveryMode;
  liveApprovedBy: string | null;
  liveApprovedAt: string | null;
  isInternal: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ResponsiveBehavior = "fixed" | "fluid-width" | "responsive-native";
export type FallbackBehavior = "collapse" | "house-ad" | "keep-space";
export type MediaKind = "image" | "animated-image" | "video" | "native";

export interface Placement {
  id: string;
  /** Public identifier used by SDKs. Not a secret. */
  publicKey: string;
  publisherId: string;
  name: string;
  slot: string;
  platform: Platform;
  width: number | null;
  height: number | null;
  aspectRatio: string | null;
  responsive: ResponsiveBehavior;
  formats: MediaKind[];
  maxFileBytes: number;
  maxVideoSeconds: number;
  allowAnimation: boolean;
  internalEligible: boolean;
  externalEligible: boolean;
  restrictions: { blockedCategories: string[]; allowedCategories: string[] };
  fallback: FallbackBehavior;
  status: "active" | "paused";
  createdAt: string;
}

export interface StandardFormat {
  id: string;
  name: string;
  width: number;
  height: number;
  platforms: Platform[];
}

export const STANDARD_FORMATS: StandardFormat[] = [
  { id: "leaderboard", name: "Leaderboard", width: 728, height: 90, platforms: ["web", "desktop"] },
  { id: "billboard", name: "Billboard", width: 970, height: 250, platforms: ["web", "desktop"] },
  { id: "medium-rectangle", name: "Medium rectangle", width: 300, height: 250, platforms: ["web", "ios", "android", "desktop"] },
  { id: "large-rectangle", name: "Large rectangle", width: 336, height: 280, platforms: ["web", "desktop"] },
  { id: "wide-skyscraper", name: "Wide skyscraper", width: 160, height: 600, platforms: ["web", "desktop"] },
  { id: "half-page", name: "Half page", width: 300, height: 600, platforms: ["web", "desktop"] },
  { id: "mobile-banner", name: "Mobile banner", width: 320, height: 50, platforms: ["web", "ios", "android"] },
  { id: "large-mobile-banner", name: "Large mobile banner", width: 320, height: 100, platforms: ["web", "ios", "android"] },
  { id: "full-hd-landscape", name: "Full HD landscape", width: 1920, height: 1080, platforms: ["web", "desktop", "macos", "windows"] },
  { id: "full-hd-portrait", name: "Full HD portrait (story)", width: 1080, height: 1920, platforms: ["ios", "android", "web"] },
];

// ---------------------------------------------------------------------------
// Advertisers
// ---------------------------------------------------------------------------

export type AdvertiserStatus = "pending" | "approved" | "suspended" | "rejected";
export interface Advertiser {
  id: string;
  name: string;
  kind: "internal" | "external";
  status: AdvertiserStatus;
  /** HCG Connect subject of the advertiser's account, when linked. */
  accountSubject: string | null;
  contactEmail: string | null;
  website: string | null;
  storageQuotaBytes: number;
  storageUsedBytes: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export type MediaVisibility = "private" | "public";
export type MediaStatus = "uploaded" | "processing" | "ready" | "rejected" | "approved" | "deleted";

export interface MediaMetadata {
  mime: string;
  kind: MediaKind;
  width: number | null;
  height: number | null;
  aspectRatio: string | null;
  durationSeconds: number | null;
  animated: boolean;
  frameCount: number | null;
  videoCodec: string | null;
  hasAudio: boolean | null;
}

export interface MediaAsset {
  id: string;
  ownerAdvertiserId: string | null;
  filename: string;
  bytes: number;
  sha256: string;
  visibility: MediaVisibility;
  status: MediaStatus;
  storageProvider: string;
  version: number;
  metadata: MediaMetadata;
  thumbnailAvailable: boolean;
  problems: string[];
  compatiblePlacementIds: string[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Creatives
// ---------------------------------------------------------------------------

export type CreativeType = "article-card" | "image" | "video" | "native-text";
export type DeviceClass = "any" | "desktop" | "tablet" | "mobile";
export type ModerationStatus = "pending" | "approved" | "rejected";

/** Normalised crop rectangle (0..1). Cropping is explicit; media is never stretched. */
export interface CropRect { x: number; y: number; width: number; height: number }

export interface CreativeVariant {
  id: string;
  device: DeviceClass;
  /** Placement this variant is built for; null = any compatible placement. */
  placementId: string | null;
  mediaAssetId: string | null;
  /** For internal content, the source image URL (not copied, not modified). */
  imageUrl: string | null;
  crop: CropRect | null;
}

export interface Creative {
  id: string;
  campaignId: string;
  type: CreativeType;
  headline: string;
  description: string | null;
  callToAction: string;
  destinationUrl: string;
  /** Internal content the creative was generated from (never modified). */
  contentRef: { sourceId: string; externalId: string } | null;
  variants: CreativeVariant[];
  moderation: ModerationStatus;
  moderationNotes: string | null;
  validationProblems: string[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

export const CAMPAIGN_STATES = [
  "draft",
  "pending_approval",
  "approved",
  "scheduled",
  "active",
  "paused",
  "completed",
  "rejected",
  "archived",
] as const;
export type CampaignState = (typeof CAMPAIGN_STATES)[number];

export type CampaignKind = "internal" | "external";
export type CampaignObjective = "awareness" | "traffic" | "engagement" | "announcement";
export type PricingModel = "none" | "fixed" | "cpm" | "cpc";

export interface Campaign {
  id: string;
  name: string;
  kind: CampaignKind;
  advertiserId: string;
  objective: CampaignObjective;
  state: CampaignState;
  /** Why a campaign is paused/suspended, e.g. "source_unavailable", "emergency", "manual". */
  stateReason: string | null;
  priority: number;
  startAt: string | null;
  endAt: string | null;
  publisherIds: string[];
  placementIds: string[];
  rotation: "even" | "weighted" | "sequential";
  impressionLimit: number | null;
  dailyImpressionLimit: number | null;
  frequencyLimit: { count: number; windowHours: number } | null;
  contextual: { categories: string[]; keywords: string[] };
  pricing: { model: PricingModel; budgetMinor: number | null; rateMinor: number | null; currency: string };
  disclosureLabel: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  creatives?: Creative[];
}

export interface CampaignHistoryEntry {
  id: string;
  campaignId: string;
  at: string;
  actor: string;
  fromState: CampaignState | null;
  toState: CampaignState | null;
  action: string;
  note: string | null;
}

// ---------------------------------------------------------------------------
// Public delivery API (/delivery/v1) — used by SDKs. No privileged keys.
// ---------------------------------------------------------------------------

export interface DeliveryConsent {
  /** May the SDK keep frequency counters on the device? */
  storage: boolean;
  /** May impressions/clicks be measured (aggregate, no identifiers)? */
  measurement: boolean;
}

export interface DeliveryRequest {
  placement: string; // placement public key
  platform?: Platform;
  device?: DeviceClass;
  context?: { category?: string; keywords?: string[]; path?: string };
  consent?: DeliveryConsent;
  /** Campaign ids the client has capped locally (privacy-preserving frequency limits). */
  exclude?: string[];
  sdk?: { name: string; version: string };
  /** Preview token issued by the admin API: renders a non-active campaign, never counts. */
  preview?: string;
}

export interface RenderableAd {
  deliveryId: string;
  campaignId: string;
  creativeId: string;
  type: CreativeType;
  headline: string;
  description: string | null;
  callToAction: string;
  /** Always a /delivery/v1/click/... URL that records the click and redirects. */
  clickUrl: string;
  /** Final destination, for display only (status bar text). */
  displayUrl: string;
  disclosure: string;
  sponsorName: string;
  media: {
    kind: MediaKind;
    url: string;
    width: number | null;
    height: number | null;
    mime: string | null;
    posterUrl: string | null;
    crop: CropRect | null;
    alt: string | null;
  } | null;
  frequency: { count: number; windowHours: number } | null;
  beacons: { impression: string; viewable: string; video: string };
  preview: boolean;
}

export interface DeliveryResponse {
  contractVersion: typeof CONTRACT_VERSION;
  placement: {
    id: string;
    width: number | null;
    height: number | null;
    responsive: ResponsiveBehavior;
    fallback: FallbackBehavior;
  } | null;
  ad: RenderableAd | null;
  /** Why nothing was returned, for diagnostics only. */
  reason?: string;
}

export type EventType =
  | "impression"
  | "viewable"
  | "click"
  | "video_start"
  | "video_25"
  | "video_50"
  | "video_75"
  | "video_complete"
  | "error";

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export interface MetricTotals {
  requests: number;
  filled: number;
  impressions: number;
  viewable: number;
  clicks: number;
  ctr: number;
  videoStarts: number;
  videoCompletes: number;
  errors: number;
  invalid: number;
}

export interface AnalyticsReport {
  /** "measured" = real events; "simulated" = development data, never mixed. */
  dataset: "measured" | "simulated";
  from: string;
  to: string;
  totals: MetricTotals;
  byDay: Array<{ day: string } & MetricTotals>;
  byCampaign: Array<{ id: string; name: string } & MetricTotals>;
  byPlacement: Array<{ id: string; name: string } & MetricTotals>;
  byPublisher: Array<{ id: string; name: string } & MetricTotals>;
  byCreative: Array<{ id: string; name: string } & MetricTotals>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}
