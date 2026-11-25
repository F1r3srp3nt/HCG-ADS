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

## Advertising transparency (v0.2.0)

Every delivered ad carries a "Why this ad?" link (the ⓘ beside the disclosure label; `GET /delivery/v1/transparency/{token}`). It states:
- that it is an advertisement;
- on whose behalf it is shown and who paid (internal promotions say "own promotion, not paid");
- the main parameters: placement, any page-section targeting, any frequency limit, priority;
- that no personal data was used.

The page is static HTML with a restrictive CSP and no scripts, and it can be opened for 7 days after delivery. This follows the spirit of the EU Digital Services Act, Art. 26 (advertising on online platforms).

## Reporting ads

Readers can report an ad from that page. The reasons are:
- misleading;
- imitates a system or security warning;
- scam or malware;
- offensive;
- not clearly labelled;
- other.

Reports are anonymous. They store only the time, campaign, creative, placement, reason and optional text (500 characters); no IP address, cookie or device identifier. Submissions are rate-limited in memory.

Three *serious* reports (system-warning imitation, scam or malware) within 24 hours pause the campaign automatically, pending human review. Creative reviewers resolve reports in **Approvals → Reported ads** (no action / pause / return to draft), with a required outcome note that goes to the audit log.

## Sign-in data (v0.2.0)

HCG ADS signs people in with HCG Connect and keeps a server-side session for at most 12 hours (2 hours idle). It holds:
- the HCG account ID, display name and email from HCG's `/me`;
- the organisation;
- the HCG tokens, sealed with AES-256-GCM.

The browser holds only an opaque, HttpOnly session cookie. Signing out deletes the session. HCG offers no end-session endpoint, so the HCG account itself stays signed in.

## Records of processing (summary for HCG's register)

| Processing | Data | Purpose | Retention | Legal basis (to confirm with counsel) |
|---|---|---|---|---|
| Ad delivery and measurement | No personal data. Aggregate events keyed by delivery, campaign, creative and placement | Deliver, cap and count ads; detect invalid traffic | `analyticsRetentionDays` (395) | Legitimate interest; consent for on-device storage |
| Frequency limits on the device | Campaign ID → timestamps in the reader's own browser storage | Avoid repetition | Per campaign window | Consent (`storage`) |
| Staff sign-in | HCG account ID, name, email, organisation; sealed tokens | Access control to HCG ADS | 12 h session; audit log entries | Contract / legitimate interest |
| Advertiser records | Business name, contact email, website | Advertiser management | Until deleted | Contract |
| Ad reports | Reason and optional free text (no reader identity) | Moderation, consumer protection | Until resolved, then kept with the audit log | Legal obligation / legitimate interest |
| Uploaded creatives | Advertiser media | Advertising | Until deleted, then `mediaRetentionDays` (30) | Contract |

**DPIA screening.** HCG ADS does no profiling, no tracking across sites or apps, no use of sensitive data and no automated decisions with legal effect. A full DPIA is therefore unlikely to be required for this design. Confirm with counsel before external advertising goes live; revisit if targeting ever changes.
