# Privacy, consent and governance

## What HCG ADS collects

| Data | Collected? |
|---|---|
| Reader IP address, user agent, cookies, device or advertising identifiers | **No.** The user agent is checked in memory to flag automated traffic and is not stored. IP addresses are used only in memory, hashed with a per-restart salt, for rate limiting. |
| Cross-site or cross-app profiles, fingerprinting | **No.** |
| Sensitive characteristics (health, religion, politics, sexuality, ethnicity…) | **No targeting on them.** Targeting is contextual: the placement, the page's category and keywords the publisher sends. |
| Events | One row per delivery and event type: time, campaign, creative, placement, publisher, simulated flag, invalid-traffic reason. No reader identifier. |
| Request counters | Daily aggregate per placement/campaign. |

## Consent

The SDKs take `{ storage, measurement }`:

- `measurement: false` → no impression/viewability/video beacons; clicks still work and redirect with `?m=0` (not recorded).
- `storage: false` → frequency counters are kept in memory for the page session only (nothing is written to the device).
- `storage: true` → frequency counters (campaign id → timestamps) are kept in local storage and pruned to each
  campaign's window. Only the ids of campaigns that reached their limit are sent (`exclude`).

When the host page gives no consent, the SDKs assume measurement on and device storage off (`DEFAULT_CONSENT`
in the web SDK). Settings → `defaultConsent` records the same HCG-wide default.

## Retention

- Measured events: `analyticsRetentionDays` (default 395). Purged automatically every 6 hours, or on demand.
- Deleted media: the public copy is withdrawn immediately; the private original is purged after
  `mediaRetentionDays` (default 30).
- Simulated development data can be deleted at any time and is never mixed with measured data.

## Advertising standards enforced by HCG ADS

- Every advertisement carries a visible disclosure label from an approved list (default: *Sponsored*,
  *Promoted*, *Advertisement*, *Promoted by HCG*, *Paid partnership*). Internal campaigns default to
  *Promoted by HCG*; external to *Sponsored*. The label is rendered by the SDK, not by the creative.
- Creatives that imitate operating-system warnings or security prompts are refused (configurable phrase list,
  warning symbols, all-capitals alarm headlines).
- No executable advertising: only PNG, JPEG, WebP, GIF, MP4 and WebM, typed by content; SVG, HTML and scripts are
  refused; ad text is never interpreted as HTML.
- Destinations must be `https://`, without credentials, IP hosts or link shorteners.
- External campaigns require an approved advertiser and a reviewer other than their creator.
- Paid content is never disguised as editorial: article promotions are labelled, and HCG ADS never modifies the
  source article.

## Governance controls

| Control | Where |
|---|---|
| Emergency advertising shutdown (stops all delivery instantly) | Command Center, Settings; `POST /admin/v1/governance/emergency` |
| Campaign suspension / immediate pause | Campaign page; automatic on source unpublication |
| Publisher suspension, placement pause | Publishers, Placements |
| Live delivery on a publisher | Founder only, typed confirmation; default is test mode |
| Advertiser, publisher, campaign and creative approval | Approvals |
| Audit log (every consequential change, with actor and authority) | Settings → Audit log; `GET /admin/v1/audit` |

External advertising must also comply with applicable law (e.g. Norwegian Marketing Control Act, GDPR/ePrivacy,
EU DSA advertising transparency). HCG ADS provides the controls above; legal review of each external
advertiser remains a human responsibility.
