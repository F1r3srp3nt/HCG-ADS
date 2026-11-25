# HCG ADS API v1

Types: `packages/contracts/src/index.ts`. Errors: `{"error": {"code", "message", "details?"}}`.
Codes include `unauthenticated`, `invalid_token`, `token_expired`, `hcg_connect_not_configured`, `no_hcg_ads_role`,
`hcg_unavailable`, `forbidden`, `not_found`, `invalid`, `conflict`, `not_editable`, `invalid_transition`,
`not_ready` (details: list of problems), `four_eyes`, `source_unavailable`, `unsupported_media`, `too_large`,
`quota_exceeded`.

## Public delivery API — `/delivery/v1` (no keys; CORS `*`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/ad` | `DeliveryRequest` → `DeliveryResponse`. Web placements are authorised by the browser `Origin`; apps send `X-HCG-App-Id`. Always 200 with `ad: null` + `reason` when nothing is eligible. |
| GET | `/ad?placement=&category=&device=&exclude=` | Same, for simple clients. |
| POST/GET | `/events/{token}/{type}` | `impression`, `viewable`, `click`, `video_start`, `video_25`, `video_50`, `video_75`, `video_complete`, `error`. Answers `{counted, reason?}` (GET returns a 1×1 GIF). |
| GET | `/click/{token}[?m=0]` | Records the click (not with `m=0`, used when measurement consent is withheld) and redirects (302) to the validated destination. |
| GET | `/media/{publicKey}` | Approved public media only. |
| GET | `/sdk/hcg-ads.js` · `/sdk/hcg-ads.min.js` | Web SDK bundle. |
| GET | `/health` | Liveness. |

Reasons for an empty response: `unknown_placement`, `emergency_shutdown`, `publisher_inactive`, `placement_paused`,
`missing_origin`, `origin_not_registered`, `origin_not_registered_for_test`, `app_not_registered`,
`app_not_registered_for_test`, `context_not_allowed`, `no_eligible_campaign`, `invalid_preview`, `rate_limited`,
`delivery_error`.

## Administration API — `/admin/v1` (HCG Connect bearer token; permission per route)

| Area | Endpoints (permission) |
|---|---|
| Session | `GET session` |
| Command center | `GET overview` (dashboard.read), `GET ecosystem` |
| Governance | `GET/PATCH settings` (governance.read / settings.write), `POST governance/emergency {active, reason}` (governance.emergency), `GET audit` (audit.read), `POST maintenance/retention` |
| Content sources | `GET content-sources`, `POST content-sources/{id}/connect|disconnect|sync`, `GET content-sources/{id}/items?q=&category=&cursor=&limit=`, `GET content-sources/{id}/items/{externalId}`, `GET content-sources/{id}/categories` |
| HCG News | `POST integrations/hcg-news/connect {testOrigins?}` — connects the content source and registers HCG News + its placements |
| Publishers | `GET/POST publishers`, `GET/PATCH publishers/{id}`, `POST publishers/{id}/status {status}`, `POST publishers/{id}/delivery-mode {mode, confirmation}` (live: founder only, confirmation `ENABLE LIVE <name>`) |
| Placements | `GET formats`, `GET placements?publisherId=`, `POST publishers/{id}/placements`, `PATCH placements/{id}`, `POST placements/{id}/status` |
| Advertisers | `GET/POST advertisers`, `PATCH advertisers/{id}`, `POST advertisers/{id}/status` |
| Media | `GET media`, `GET media/{id}`, `POST media` (multipart `file`, `advertiserId?`, `previousVersionId?`), `DELETE media/{id}`, `GET media/{id}/content?t=` (signed preview) |
| Campaigns | `GET/POST campaigns`, `POST campaigns/from-content {sourceId, externalIds[], placementIds[], mode?, overrides?, startAt?, endAt?}`, `GET/PATCH campaigns/{id}`, `POST campaigns/{id}/creatives`, `PATCH/DELETE creatives/{id}`, `POST campaigns/{id}/submit|approve|reject|activate|pause|revise|archive|duplicate`, `GET campaigns/{id}/preview?placementId=&device=&creativeId=` |
| Approvals | `GET approvals` |
| Analytics | `GET analytics?dataset=measured|simulated&from=&to=&campaignId=&publisherId=`, `POST analytics/simulate` (development only), `DELETE analytics/simulated` |
| Revenue (test mode) | `GET revenue`, `POST revenue/ledger` |

## Campaign lifecycle

```
draft ──submit──▶ pending_approval ──approve──▶ approved ──activate──▶ active ⇄ paused
  ▲                    │                            │                    │
  └──── revise ◀───────┴─reject─▶ rejected          └─(future start)─▶ scheduled ──(start)──▶ active
active/scheduled/paused ──(end date | impression limit)──▶ completed ──archive──▶ archived
```

- Content and creatives can only change in `draft`/`rejected`; `revise` returns a campaign to draft and requires approval again.
- A promoted article that is unpublished at its source pauses the campaign (`stateReason: source_unavailable`);
  a source outage never does.
- External campaigns: the advertiser must be approved, pricing must be set (test mode), approval needs
  `creatives.moderate` and a different person from the creator.
