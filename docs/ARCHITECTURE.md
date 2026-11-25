# HCG ADS architecture (v0.1.0)

Principle: **everything is interchangeable.** Every external dependency sits behind an interface chosen in one place
(`apps/server/src/context.ts`), so it can be replaced without touching the modules that use it.

```
                    ┌──────────────────────────── HCG ADS server (Node 22, TypeScript) ─────────────────────────────┐
 Command center ──▶ │ /admin/v1  (HCG Connect token → ERP App Access roles → permission check on every operation)    │
 (React, apps/admin)│                                                                                                │
                    │  Campaign Manager ─ Creative Studio data ─ Approval & Moderation ─ Campaign Scheduling         │
                    │  Publisher Manager ─ Placement Manager ─ Advertiser Manager ─ Media Library                   │
                    │  Content Source Registry ─ Analytics Engine ─ Revenue & Billing (test mode) ─ Governance       │
                    │                                                                                                │
 Websites / apps ─▶ │ /delivery/v1  (public, keyless: ad decisions, beacons, click redirects, approved media, SDK)    │
 (SDKs)             │  Ad Delivery Engine                                                                             │
                    └───────┬──────────────┬──────────────────┬────────────────────┬───────────────────┬─────────────┘
                            │              │                  │                    │                   │
                 IdentityProvider  ContentSourceAdapter  StorageProvider     MediaProcessor     PaymentsGateway
                  ├ HCG Connect     ├ HCG News (live)     ├ local (dev)       ├ ffmpeg            └ test mode
                  └ development     ├ HCG Store (n/c)     └ HCG Server        └ basic (pure TS)     (HCG Payments later)
                    (loopback only) └ HCG website (n/c)
```

## Modules and their interfaces

| Module | Code | Interface / contract |
|---|---|---|
| Shared contracts (v1) | `packages/contracts/src/index.ts` | All public types: roles, permissions, campaigns, creatives, placements, delivery request/response, analytics. Additive-only within v1. |
| Campaign Manager + Scheduling | `apps/server/src/campaigns/service.ts` | State machine `TRANSITIONS`; `tick()` scheduler |
| Creative Studio (data) | `apps/server/src/creatives/validate.ts` | `CreativeInput`, `validateCreative`, `variantsFor` |
| Approval & Moderation | campaigns service (`submit/approve/reject`) + `contentProblems` | four-eyes for external campaigns |
| Publisher Manager / Placement Manager | `apps/server/src/publishers/service.ts`, `placements/compat.ts` | `PublisherInput`, `PlacementInput`, `checkCompatibility` |
| Advertiser Manager | `apps/server/src/advertisers/service.ts` | `AdvertiserInput` |
| Content Source Registry | `apps/server/src/sources/` | `ContentSourceAdapter` |
| Media Library | `apps/server/src/media/` | `StorageProvider`, `MediaProcessor`, `inspect()` |
| Ad Delivery Engine | `apps/server/src/delivery/engine.ts` | `DeliveryRequest` → `DeliveryResponse` (contracts) |
| Analytics Engine | `apps/server/src/analytics/service.ts` | `AnalyticsReport` (measured / simulated datasets) |
| Revenue & Billing | `apps/server/src/billing/service.ts` | `PaymentsGateway` |
| Governance | `apps/server/src/governance/settings.ts`, `core/audit.ts` | settings, emergency shutdown, audit log |
| HCG ecosystem integration | `apps/server/src/identity/`, `sources/hcg-news.ts`, `media/hcg-server-storage.ts` | see below |
| Advertising SDK | `packages/sdk-js`, `packages/sdk-react`, `sdk/swift`, `sdk/dotnet` | delivery contract v1 |

## Versioning

- URLs carry the version: `/admin/v1/…`, `/delivery/v1/…`. Responses from delivery carry `contractVersion: "1"`.
- Within v1, changes are additive (new optional fields, new endpoints). SDKs ignore unknown fields and treat a
  different `contractVersion` as "no ad" (the placement collapses) rather than failing.
- A breaking change creates `contracts/v2` and `/…/v2`, served alongside v1 during migration.

## How HCG ADS uses existing HCG infrastructure (inspected, not invented)

| Need | Existing HCG infrastructure found | HCG ADS |
|---|---|---|
| Identity | HCG Connect = the shared HCG identity project (`qggdyzoydveafkmjgkpq`), ES256 tokens with a public JWKS — the contract HCG Server's Device Link already uses (`HCG-Server/docs/DEVICE-LINK.md`). | `HcgConnectIdentityProvider` verifies the token (issuer, audience, role, `sub`, optional trusted `client_id`). No user table, no passwords. |
| Roles & permissions | ERP App Access, asked through HCG's Ecosystem API `POST /api/public/ecosystem/v1/check` with the caller's own token (same as HCG Server). | Each HCG ADS role maps to an ERP feature key in `config/hcg-connect.json`. **No product or feature keys are invented**: until HCG issues them, the production identity refuses everything (`503 hcg_connect_not_configured`). Allow 60 s / deny 10 s caching, outages fail closed. |
| HCG News content | The website and the iOS app read `news_articles` / `news_categories` through PostgREST with the public anon key under row-level security (`HCG-News/iOS app/docs/INTEGRATION-REPORT.md`). | `HcgNewsAdapter` does the same, read-only, published and due rows only, reader columns only, re-checked on our side. Pinned to the shared project; service-role keys are refused. |
| Media infrastructure | HCG Server v1 file API: staged uploads, per-chunk + whole-file SHA-256, atomic commit, approved storage roots, allocation limits (`HCG-Server/docs/API.md`). Loopback admin API; it is not a public CDN. | `HcgServerStorageProvider` uses that protocol; tested against the real `hcg-agent` built from source. Public delivery of approved assets still goes through HCG ADS, so the computer is never exposed. Local development storage is the default. |
| Payments | HCG Payments repository has no implementation yet. | `PaymentsGateway` interface; test mode only. No payment processing exists in HCG ADS. |
| Governance | HCG Executive Control Center: no reporting contract found. | Append-only audit log in HCG ADS; ready to forward once ECC publishes a contract. |

## Data

Local development database: SQLite through Node's built-in `node:sqlite` (`data/hcg-ads.db`, WAL), behind the
`Database` wrapper, with ordered migrations (`apps/server/src/db/schema.ts`). The schema contains **no user table**
and stores **no personal data about readers** (no IPs, user agents, cookies or device identifiers).

## Security boundaries

- Administration (`/admin/v1`) and delivery (`/delivery/v1`) are separate route trees. Delivery needs no key;
  placement keys are public identifiers. Administration always authenticates and checks permissions server-side.
- The development identity provider refuses to start in production or on a non-loopback address.
- Private uploads are only readable through short-lived HMAC-signed URLs; only media approved through moderation
  is copied to the public namespace (unguessable keys).
- Delivery tokens (impressions, clicks) are HMAC-signed and expire (1 h for views, 24 h for clicks); each
  (delivery, event type) is unique in the database, so nothing is double-counted.
- Click redirects re-validate the destination (https only, no credentials, no IP hosts, no link shorteners).
- Uploaded files are typed by content (magic bytes). SVG, HTML and scripts are refused; ad text is rendered as
  text only by the SDKs (Shadow DOM, `textContent`).
