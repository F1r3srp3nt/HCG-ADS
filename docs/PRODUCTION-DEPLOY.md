# Production hosting preparation (v0.2.0)

**Nothing is deployed.** This describes how HCG ADS would run at `ads.hakmicapitalgroup.com` once you choose a host.
Production advertising and payments stay disabled by default.

## What runs

One container: the HCG ADS server (`/admin/v1`, `/delivery/v1`, `/auth`), the command center, the web SDK.

```bash
docker build -t hcg-ads:0.2.0 .
```

- **Image:** Node 22, ffmpeg (optional; build with `--build-arg WITH_FFMPEG=0` to omit it).
- **Runtime:** runs as a non-root user; state only in the `/data` volume.
- **Health and readiness:** `/healthz` (liveness), `/readyz` (`503` until HCG Connect is configured; reports why without values).
- **CI:** the `container-image` job builds it on GitHub, starts it with production settings and checks that it fails closed.

## Settings

| Variable | Production value | Notes |
|---|---|---|
| `HCG_ADS_ENV` | `production` (image default) | Refuses the development identity; refuses non-https public URL. |
| `HCG_ADS_PUBLIC_URL` | `https://ads.hakmicapitalgroup.com` | Must be https (session cookies are `__Host-`, `Secure`). |
| `HCG_ADS_DELIVERY_SECRET` | from the secret store, ≥ 32 characters | Signs delivery and preview tokens and seals session tokens. Required in production. |
| `HCG_ADS_HOST` / `HCG_ADS_PORT` | `0.0.0.0` / `7800` | Behind an HTTPS reverse proxy only. |
| `HCG_ADS_TRUST_PROXY` | `true` only behind your proxy | Uses `X-Forwarded-For` for in-memory abuse limits (never stored). |
| `HCG_ADS_LIVE_DELIVERY` | `off` (image default) | **Server-level switch.** While off, every publisher is served as in test mode, whatever the founder's per-publisher setting says. Set to `enabled` only after the founder's live decision. |
| `HCG_ADS_ADMIN_ORIGINS` | empty | Only for a separately hosted command center. |
| `HCG_ADS_STORE_CATALOGUE_URL` | unset until HCG Store publishes its catalogue | `https://*.hakmicapitalgroup.com` only. |
| `HCG_ADS_CONFIG_DIR` | `/app/config` | Holds the files below. |

Configuration files (no secrets; templates in `config/`):

| File | Needed for | Status |
|---|---|---|
| `hcg-news.json` | HCG News content source (public read) | Included. |
| `hcg-connect.json` | Sign-in and roles | Needs HCG's `hcg.ads` product key, role feature keys and the web client ID. See [HCG-CONNECT-REGISTRATION-REQUEST.md](HCG-CONNECT-REGISTRATION-REQUEST.md). |
| `storage.json` | HCG Server media storage | Optional; default is the `/data` volume. |
| `payments.json` | HCG Payments (test mode) | Optional; production refuses checkout requests in this release. |

## Safety properties in production (tested)

- Without HCG Connect configuration, every administration request gets `503 hcg_connect_not_configured`.
- The development identity cannot start in production or on a public address.
- Live delivery stays off until both `HCG_ADS_LIVE_DELIVERY=enabled` and the founder's typed per-publisher approval are in place.
- No test pages (`/testbed`, `/testbed-store`) are served.
- Payments: HCG ADS never processes payments. In production, checkout requests are refused. HCG Payments is test-mode only and refuses every paid advertising purpose until the Owner activates it.
- HSTS, `X-Frame-Options: DENY`, `nosniff` and no-store on administration and authentication responses.

## Data and backups

`/data` holds:
- `hcg-ads.db`, the SQLite database (WAL);
- `media/` (local storage only);
- `delivery-secret.key`, used only when no `HCG_ADS_DELIVERY_SECRET` is given; not used in production.

Back up `/data` daily, using the SQLite online backup (`sqlite3 hcg-ads.db ".backup …"`) or a filesystem snapshot. The database holds no reader identifiers. The database stays behind the `Database` wrapper, so a managed Postgres in the shared HCG project is a later, separate migration.

## Hosting options (your decision)

| Option | Fit |
|---|---|
| HCG-managed cloud container host (e.g. the same kind of host HCG Store prepared: `fly.toml`/Docker) | Recommended: a public HTTPS endpoint, no personal computer exposed. |
| HCG Server gateway | Not suitable for public traffic today: its gateway serves loopback/LAN with a local CA. Use HCG Server as **storage** behind HCG ADS instead. |
| A personal Mac exposed to the internet | **No.** |

## Go-live checklist (each step is separate and needs your approval)

1. HCG issues `hcg.ads`, its role features and the web client. Install `hcg-connect.json`. `/readyz` shows ready.
2. Choose and approve a host, then deploy the image. No automatic deployment exists.
3. HCG News adds the placement component (`integrations/hcg-news-website/`). It is inert until configured.
4. Verify in test mode, using test origins on the production host.
5. Founder: set `HCG_ADS_LIVE_DELIVERY=enabled` and switch HCG News to live in HCG ADS (typed confirmation).
6. Payments stay off until HCG Payments activates an advertising purpose with your approval.
