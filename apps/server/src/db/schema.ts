/** Ordered, append-only migrations for the local development database. */
export const MIGRATIONS: Array<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor_subject TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  authority TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  summary TEXT NOT NULL,
  details TEXT
);
CREATE INDEX audit_at ON audit_log(at);
CREATE INDEX audit_entity ON audit_log(entity_type, entity_id);

CREATE TABLE content_sources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  config TEXT NOT NULL DEFAULT '{}',
  last_sync_at TEXT,
  last_sync_result TEXT,
  connected_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE content_items (
  source_id TEXT NOT NULL REFERENCES content_sources(id),
  external_id TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  status TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_checked_at TEXT NOT NULL,
  PRIMARY KEY (source_id, external_id)
);

CREATE TABLE publishers (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  name TEXT NOT NULL,
  domains TEXT NOT NULL DEFAULT '[]',
  app_identifiers TEXT NOT NULL DEFAULT '[]',
  test_origins TEXT NOT NULL DEFAULT '[]',
  owner_subject TEXT,
  administrators TEXT NOT NULL DEFAULT '[]',
  platforms TEXT NOT NULL DEFAULT '[]',
  supported_formats TEXT NOT NULL DEFAULT '[]',
  internal_eligible INTEGER NOT NULL DEFAULT 1,
  external_eligible INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  delivery_mode TEXT NOT NULL DEFAULT 'test',
  live_approved_by TEXT,
  live_approved_at TEXT,
  is_internal INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE placements (
  id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL UNIQUE,
  publisher_id TEXT NOT NULL REFERENCES publishers(id),
  name TEXT NOT NULL,
  slot TEXT NOT NULL,
  platform TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  responsive TEXT NOT NULL,
  formats TEXT NOT NULL,
  max_file_bytes INTEGER NOT NULL,
  max_video_seconds INTEGER NOT NULL,
  allow_animation INTEGER NOT NULL,
  internal_eligible INTEGER NOT NULL,
  external_eligible INTEGER NOT NULL,
  restrictions TEXT NOT NULL DEFAULT '{}',
  fallback TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE advertisers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  account_subject TEXT,
  contact_email TEXT,
  website TEXT,
  storage_quota_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE media_assets (
  id TEXT PRIMARY KEY,
  owner_advertiser_id TEXT REFERENCES advertisers(id),
  filename TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  visibility TEXT NOT NULL,
  status TEXT NOT NULL,
  storage_provider TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  public_key TEXT,
  thumbnail_key TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  previous_version_id TEXT,
  metadata TEXT NOT NULL,
  problems TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  purge_after TEXT
);

CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  advertiser_id TEXT NOT NULL REFERENCES advertisers(id),
  objective TEXT NOT NULL,
  state TEXT NOT NULL,
  state_reason TEXT,
  priority INTEGER NOT NULL DEFAULT 5,
  start_at TEXT,
  end_at TEXT,
  publisher_ids TEXT NOT NULL DEFAULT '[]',
  placement_ids TEXT NOT NULL DEFAULT '[]',
  rotation TEXT NOT NULL DEFAULT 'even',
  impression_limit INTEGER,
  daily_impression_limit INTEGER,
  frequency_limit TEXT,
  contextual TEXT NOT NULL DEFAULT '{"categories":[],"keywords":[]}',
  pricing TEXT NOT NULL,
  disclosure_label TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX campaigns_state ON campaigns(state);

CREATE TABLE creatives (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  type TEXT NOT NULL,
  headline TEXT NOT NULL,
  description TEXT,
  call_to_action TEXT NOT NULL,
  destination_url TEXT NOT NULL,
  content_source_id TEXT,
  content_external_id TEXT,
  variants TEXT NOT NULL DEFAULT '[]',
  moderation TEXT NOT NULL,
  moderation_notes TEXT,
  validation_problems TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX creatives_campaign ON creatives(campaign_id);

CREATE TABLE campaign_history (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id),
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT,
  action TEXT NOT NULL,
  note TEXT
);
CREATE INDEX history_campaign ON campaign_history(campaign_id, at);

-- Aggregate request counters (no identifiers).
CREATE TABLE delivery_counters (
  day TEXT NOT NULL,
  placement_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL DEFAULT '',
  simulated INTEGER NOT NULL DEFAULT 0,
  requests INTEGER NOT NULL DEFAULT 0,
  filled INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, placement_id, campaign_id, simulated)
);

-- One row per measured event per delivery. UNIQUE prevents double counting.
-- No IP address, user agent, cookie or device identifier is stored.
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL,
  type TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  creative_id TEXT NOT NULL,
  placement_id TEXT NOT NULL,
  publisher_id TEXT NOT NULL,
  at TEXT NOT NULL,
  day TEXT NOT NULL,
  simulated INTEGER NOT NULL DEFAULT 0,
  invalid_reason TEXT,
  UNIQUE (delivery_id, type)
);
CREATE INDEX events_campaign ON events(campaign_id, day);
CREATE INDEX events_day ON events(day);

CREATE TABLE ledger_entries (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  campaign_id TEXT,
  advertiser_id TEXT,
  publisher_id TEXT,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  test_mode INTEGER NOT NULL DEFAULT 1,
  description TEXT NOT NULL,
  created_by TEXT NOT NULL
);
`,
  },
  {
    version: 2,
    sql: `
-- HCG Connect web sign-in (server-owned sessions; tokens encrypted at rest, never sent to the browser).
CREATE TABLE auth_requests (
  state_hash TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  verifier_enc TEXT NOT NULL,
  return_to TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE web_sessions (
  id_hash TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT,
  organisation_id TEXT,
  founder_policy INTEGER NOT NULL DEFAULT 0,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT,
  access_expires_at TEXT NOT NULL,
  csrf_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX web_sessions_subject ON web_sessions(subject);

-- Advertising transparency and reporting (no reader identifiers are stored).
CREATE TABLE ad_reports (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  creative_id TEXT NOT NULL,
  placement_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  resolved_by TEXT,
  resolved_at TEXT,
  resolution TEXT
);
CREATE INDEX ad_reports_status ON ad_reports(status, at);
`,
  },
];

