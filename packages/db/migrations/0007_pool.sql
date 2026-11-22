-- Data pool (plan 5b, spec §6 S2, D6). Observations carry no user or token id: only per-token daily counters exist.
CREATE TABLE pool_tokens (
  id TEXT PRIMARY KEY,
  id_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE INDEX pool_tokens_user ON pool_tokens(user_id);
CREATE TABLE pool_token_days (
  token_id TEXT NOT NULL REFERENCES pool_tokens(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  accepted INTEGER NOT NULL DEFAULT 0,
  rejected INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (token_id, day)
);
CREATE TABLE pool_channels (
  channel_id TEXT PRIMARY KEY,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE TABLE pool_videos (
  video_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES pool_channels(channel_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  published_at TEXT,
  format TEXT NOT NULL,
  duration_sec INTEGER,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX pool_videos_channel ON pool_videos(channel_id);
CREATE TABLE pool_observations (
  video_id TEXT NOT NULL REFERENCES pool_videos(video_id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  views INTEGER NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (video_id, at)
);
CREATE INDEX pool_observations_at ON pool_observations(at);
