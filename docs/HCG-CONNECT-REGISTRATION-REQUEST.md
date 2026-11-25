# HCG ADS — central product, role and client registration request

**For the HCG Owner. Draft; nothing has been registered, and no identifier has been invented.**

This request follows the main site's contracts:
- `docs/hcg-auth-contract.md` (verified 2 Nov 2026);
- `docs/hcg-authorization-contract.md`;
- `docs/hcg-connect/shared-product-access-handoff.md` §5–§7 (18 Nov 2026).

It changes no production authentication setting by itself. Zero Lovable credits: every step is an ERP (Owner) action.

## 1. Product registry entry (ERP → product registry)

HCG ADS has **no product ID** in the live registry (the §5 table has no advertising product). The handoff says
"do not invent a new product ID in a separate app; request/reconcile the registry entry first", so this is the request:

| Field | Requested value |
|---|---|
| Product ID | `hcg.ads` (proposed, following the `hcg.<name>` convention; confirm or replace) |
| Name | HCG ADS |
| Release status | `in_development` |
| Description | Central advertising, campaign management and promotional distribution for HCG products. |

Until it exists, HCG ADS uses the development identity locally. In production every administration request is
refused (`503 hcg_connect_not_configured`); nothing is improvised.

## 2. Feature keys (ERP → App Access, `hcg.ads`)

Each HCG ADS role is one feature key. Catalog registration grants nothing: assignment stays in App Access.

| HCG ADS role | Proposed feature key | Grants in HCG ADS |
|---|---|---|
| Founder | *none needed*: derived from HCG's own `founder_owner_all_products` policy (`/me` → `product_policy.active`) | Everything, including live-delivery approval |
| Advertising administrator | `ads.administrator` | All operations except finance writes |
| Campaign manager | `ads.campaign.manage` | Create, edit, submit, activate and pause campaigns; media |
| Publisher administrator | `ads.publisher.manage` | Publishers, placements, content sources |
| Advertiser | `ads.advertiser` | Own campaigns and media |
| Creative reviewer | `ads.creative.review` | Approve or reject campaigns, moderate creatives, resolve reports |
| Finance administrator | `ads.finance` | Revenue (test mode), ledger |
| Analytics viewer | `ads.analytics.view` | Analytics, read-only |

HCG ADS calls `POST /api/public/ecosystem/v1/check` with the caller's own token and real organisation:
- per role, before showing the command center (an allow may be cached for 60 s);
- **freshly** before every consequential action (no cached yes), as the authorization contract requires.

The permission matrix (which operations each role allows) is code in `packages/contracts`, not a user list.

## 3. Dedicated HCG Connect web clients (ERP → App Integrations → `hcg.ads` → Dedicated app login registration)

HCG ADS is a separate web application with a server: authorization code with PKCE S256, `state` and `nonce`, scopes
`openid email profile`, server-owned HttpOnly sessions, and tokens kept on the server. A **public no-secret** client is
appropriate, because the code exchange happens on the HCG ADS server with the PKCE verifier and no client secret is
needed. Two registrations, per environment:

```text
Please register/reconcile one dedicated HCG Connect client.
Product ID:               hcg.ads   (after §1)
Integration key:          hcg-ads-web-development
Consent name:             HCG ADS (development)
Platform/environment:     web / development
Exact callback URI(s):    http://127.0.0.1:7800/auth/callback
Public PKCE S256 / no secret confirmed: yes
Features to read (identifiers only, not requested grants):
  ads.administrator, ads.campaign.manage, ads.publisher.manage, ads.advertiser,
  ads.creative.review, ads.finance, ads.analytics.view
```

```text
Please register/reconcile one dedicated HCG Connect client.
Product ID:               hcg.ads   (after §1)
Integration key:          hcg-ads-web-production
Consent name:             HCG ADS
Platform/environment:     web / production
Exact callback URI(s):    https://ads.hakmicapitalgroup.com/auth/callback
Public PKCE S256 / no secret confirmed: yes
Features to read (identifiers only, not requested grants):
  ads.administrator, ads.campaign.manage, ads.publisher.manage, ads.advertiser,
  ads.creative.review, ads.finance, ads.analytics.view
```

Owner steps:
1. **Inspect matching registrations**, and resolve any conflict without creating a duplicate.
2. **Register or reuse this app client.**
3. Read back the client ID and send it (it is public).

Keep `configured_untested` until acceptance (§5).

## 4. What HCG ADS does with the values

They go into `config/hcg-connect.json` (template `config/hcg-connect.example.json`, no secrets):

```json
{
  "contractVersion": "hcg.ads.connect/1",
  "issuer": "https://qggdyzoydveafkmjgkpq.supabase.co/auth/v1",
  "jwksEndpoint": "https://qggdyzoydveafkmjgkpq.supabase.co/auth/v1/.well-known/jwks.json",
  "apiBaseUrl": "https://beta.hakmicapitalgroup.com",
  "ecosystemApiPath": "/api/public/ecosystem/v1",
  "productId": "hcg.ads",
  "roleFeatures": { "ads_administrator": "ads.administrator", "campaign_manager": "ads.campaign.manage", "…": "…" },
  "organisationId": "2bdefe45-3bf4-466a-865e-8d4b4ac17462",
  "webClient": { "clientId": "<issued UUID>", "redirectUri": "https://ads.hakmicapitalgroup.com/auth/callback" }
}
```

How HCG ADS uses them:
- The issuer and endpoints are read from live discovery (verified 25 Nov 2026: `authorize`, `token`, `jwks`, `userinfo`, S256, no revocation or end-session endpoint).
- The organisation is the account's real membership from `/me`. The zero-UUID placeholder is used only for an active Founder policy without an organisation.

## 5. Acceptance (after registration)

1. Sign in through HCG's consent page and return to HCG ADS.
2. The session shows your HCG display name and your roles.
3. A consequential action (e.g. activating a test campaign) triggers a fresh `/check`.
4. Refresh after the access token expires.
5. Remove a role in App Access and confirm that HCG ADS refuses on the next check.
6. Sign out of HCG ADS. HCG offers no end-session endpoint, so the HCG account itself stays signed in.

`scripts/signin-browser-check.mjs` already proves the HCG ADS side of this flow against a local stand-in. It does not
prove HCG's own consent page.
