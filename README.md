# HCG ADS

Central advertising infrastructure for **Hakmi Capital Group**: create, approve, distribute and measure
advertisements across HCG websites, mobile apps and desktop apps — internal HCG promotions first, external
advertisers next.

| | |
|---|---|
| Version | 0.1.0 — development build, **not deployed** |
| Publisher | Hakmi Capital Group · first publisher and content source: **HCG News** |
| Proposed domain | `ads.hakmicapitalgroup.com` (not yet hosted) |
| Identity | HCG Connect + ERP App Access (no separate account system) |
| Media | Local development storage, or HCG Server (adapter tested against the real agent) |
| Payments | Test mode only — HCG Payments is not connected; no money moves |

**Engineering principle: everything is interchangeable.** Identity, content sources, storage, media processing
and payments each sit behind an interface chosen in one place (`apps/server/src/context.ts`).

## Quick start (local development)

Requires Node 22.5+. ffmpeg is optional (enables video probing of WebM, thumbnails, optimisation and transcoding).

```bash
npm install
```

```bash
npm run build
```

```bash
npm run dev
```

Open <http://127.0.0.1:7800> (command center) and <http://127.0.0.1:7800/testbed/> (HCG News test environment).
The server listens on loopback only. In development it uses a clearly labelled local identity
("LOCAL DEVELOPMENT — not an HCG account"); it refuses to start that way in production or on a public address.

Behind an HTTPS proxy, Node's built-in `fetch` needs `NODE_USE_ENV_PROXY=1` (Node ≥ 22.21) to reach HCG News.

To work on the command center with hot reload, run `npm run dev:admin` alongside `npm run dev` and open
<http://127.0.0.1:5173>.

## What is in this repository

| Path | What |
|---|---|
| `packages/contracts` | Versioned v1 contracts shared by every module, the UI and the SDKs |
| `apps/server` | API server: Campaign Manager, Publisher/Placement/Advertiser Managers, Content Source Registry, Media Library, Approval & Moderation, Scheduling, Ad Delivery Engine, Analytics, Revenue (test mode), Governance, HCG integrations |
| `apps/admin` | HCG ADS command center (React) |
| `packages/sdk-js` | Web SDK (`@hcg-ads/sdk`): placements, rendering in Shadow DOM, consent, frequency limits, beacons, fallback |
| `packages/sdk-react` | React bindings (`@hcg-ads/react`) |
| `sdk/swift` | Swift / SwiftUI SDK (written, **not yet compiled** — no Swift toolchain here) |
| `sdk/dotnet` | Interface specification for the future .NET / Avalonia SDK |
| `examples/hcg-news-testbed` | HCG News test environment: real published articles + HCG ADS placements |
| `config/` | `hcg-news.json` (public read values), templates for HCG Connect and HCG Server storage |
| `docs/` | Architecture, API, privacy & governance, status, and the integration request awaiting approval |

## Documentation

- [docs/STATUS.md](docs/STATUS.md) — what is implemented, tested, simulated and outstanding; acceptance results
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — modules, interfaces, how existing HCG infrastructure is used
- [docs/API.md](docs/API.md) — administration and delivery APIs, campaign lifecycle
- [docs/PRIVACY-AND-GOVERNANCE.md](docs/PRIVACY-AND-GOVERNANCE.md) — data collected, consent, retention, ad standards
- [docs/LOVABLE-INTEGRATION-REQUEST.md](docs/LOVABLE-INTEGRATION-REQUEST.md) — **draft for your approval**: the minimal changes outside this repo

## Tests

```bash
npm test
```

```bash
npm run acceptance
```

`npm test` runs the server and SDK suites. `npm run acceptance` runs the 12-step end-to-end acceptance test in a
browser against **live, published HCG News articles** (read-only) on a throwaway local database.

## Safety defaults

- Nothing is published to the live HCG News website: publishers start in **test** delivery mode; live delivery
  needs the founder and a typed confirmation, plus the website change in the integration request.
- Every campaign needs approval before it can be activated; activation is manual.
- No production infrastructure, endpoints, client ids or credentials are created or invented.
