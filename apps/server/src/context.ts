import { join } from "node:path";
import type { ServerConfig } from "./config.ts";
import { Database } from "./db/database.ts";
import { systemClock, type Clock } from "./core/clock.ts";
import { AuditLog, SYSTEM_ACTOR } from "./core/audit.ts";
import { Signer } from "./core/signing.ts";
import { SettingsService } from "./governance/settings.ts";
import { DevelopmentIdentityProvider, HcgConnectIdentityProvider, type IdentityProvider } from "./identity/provider.ts";
import { HcgNewsAdapter } from "./sources/hcg-news.ts";
import { UnconfiguredSourceAdapter, type ContentSourceAdapter } from "./sources/adapter.ts";
import { ContentSourceRegistry } from "./sources/registry.ts";
import { PublisherService } from "./publishers/service.ts";
import { AdvertiserService } from "./advertisers/service.ts";
import type { StorageProvider } from "./media/storage.ts";
import { LocalStorageProvider } from "./media/local-storage.ts";
import { HcgServerStorageProvider } from "./media/hcg-server-storage.ts";
import { BasicProcessor, FfmpegProcessor, type MediaProcessor } from "./media/processor.ts";
import { MediaService } from "./media/service.ts";
import { CampaignService } from "./campaigns/service.ts";
import { DeliveryEngine } from "./delivery/engine.ts";
import { AnalyticsService } from "./analytics/service.ts";
import { BillingService, TestModePaymentsGateway } from "./billing/service.ts";

export interface AppContext {
  config: ServerConfig;
  db: Database;
  clock: Clock;
  audit: AuditLog;
  settings: SettingsService;
  identity: IdentityProvider;
  sources: ContentSourceRegistry;
  publishers: PublisherService;
  advertisers: AdvertiserService;
  media: MediaService;
  campaigns: CampaignService;
  delivery: DeliveryEngine;
  analytics: AnalyticsService;
  billing: BillingService;
  shutdown(): void;
}

export interface ContextOverrides {
  clock?: Clock;
  fetch?: typeof fetch;
  identity?: IdentityProvider;
  storage?: StorageProvider;
  processor?: MediaProcessor;
  sourceAdapters?: ContentSourceAdapter[];
  dbPath?: string;
}

/**
 * Assembles HCG ADS from interchangeable parts. Each dependency (identity,
 * storage, media processing, content sources, payments) is chosen here and
 * can be replaced without touching the modules that use it.
 */
export async function createContext(config: ServerConfig, o: ContextOverrides = {}): Promise<AppContext> {
  const clock = o.clock ?? systemClock;
  const db = new Database(o.dbPath ?? join(config.dataDir, "hcg-ads.db"));
  const audit = new AuditLog(db, clock);
  const settings = new SettingsService(db, clock, audit);

  const identity = o.identity ?? (config.identity.mode === "development"
    ? new DevelopmentIdentityProvider()
    : new HcgConnectIdentityProvider(config.identity.hcgConnect ?? null, config.hcgConnectProblems, o.fetch ?? fetch));

  const adapters = o.sourceAdapters ?? [
    new HcgNewsAdapter(config.hcgNews, config.hcgNewsProblems, o.fetch ?? fetch, () => clock.now()),
    new UnconfiguredSourceAdapter("hcg-store", "HCG Store", "Products from the HCG Store.", ["HCG Store has not published a content contract for HCG ADS yet."]),
    new UnconfiguredSourceAdapter("hcg-website", "HCG website", "Pages and announcements from hakmicapitalgroup.com.", ["The HCG website has not published a content contract for HCG ADS yet."]),
  ];
  const sources = new ContentSourceRegistry(db, clock, audit, adapters);
  const publishers = new PublisherService(db, clock, audit);
  const advertisers = new AdvertiserService(db, clock, audit, () => settings.get().defaultAdvertiserQuotaBytes);

  const storage = o.storage ?? (config.storage.provider === "hcg-server"
    ? new HcgServerStorageProvider(config.storage.hcgServer, o.fetch ?? fetch)
    : new LocalStorageProvider(join(config.dataDir, "media")));
  const processor = o.processor ?? ((await FfmpegProcessor.available()) ? new FfmpegProcessor() : new BasicProcessor());
  const media = new MediaService(db, clock, audit, storage, processor, new Signer(config.deliverySecret, "media-preview"),
    () => settings.get(), config.publicBaseUrl, () => publishers.placements());

  const allowLocalhost = config.env !== "production";
  const campaigns = new CampaignService({ db, clock, audit, advertisers, publishers, media, sources, settings: () => settings.get(), allowLocalhost });
  sources.onItemUnavailable = (sourceId, externalId, reason) => campaigns.suspendForContent(sourceId, externalId, reason);

  const delivery = new DeliveryEngine(db, clock, new Signer(config.deliverySecret, "delivery"), new Signer(config.deliverySecret, "preview"),
    campaigns, publishers, media, advertisers, settings, config.publicBaseUrl, allowLocalhost);
  const analytics = new AnalyticsService(db, clock, audit, campaigns);
  const billing = new BillingService(db, clock, audit, campaigns, new TestModePaymentsGateway());

  const timers: NodeJS.Timeout[] = [];
  const ctx: AppContext = {
    config, db, clock, audit, settings, identity, sources, publishers, advertisers, media, campaigns, delivery, analytics, billing,
    shutdown() { timers.forEach(clearInterval); db.close(); },
  };
  (ctx as AppContext & { startSchedulers(): void }).startSchedulers = () => {
    timers.push(setInterval(() => { try { campaigns.tick(); } catch (e) { console.error("tick failed", e); } }, 30_000));
    timers.push(setInterval(async () => {
      for (const s of sources.list()) {
        if (s.status === "connected" || s.status === "degraded") {
          try { await sources.sync(s.id); } catch (e) { console.error(`sync ${s.id} failed`, e); }
        }
      }
    }, config.syncIntervalMs));
    timers.push(setInterval(async () => {
      try {
        analytics.purge(settings.get().analyticsRetentionDays, SYSTEM_ACTOR);
        await media.purgeExpired(SYSTEM_ACTOR);
      } catch (e) { console.error("retention failed", e); }
    }, 6 * 60 * 60 * 1000));
  };
  return ctx;
}
