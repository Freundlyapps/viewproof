-- Cached YouTube Analytics / Data API responses per connected channel (spec §6 S1, §10).
-- Removed with the channel; account deletion and channel removal also delete them explicitly.
CREATE TABLE report_cache (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  body TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (channel_id, key)
);
