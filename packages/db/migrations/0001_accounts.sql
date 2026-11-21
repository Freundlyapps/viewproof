-- Accounts, sessions and connected channels (plan 2). All times are ISO 8601 text.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  google_sub TEXT UNIQUE NOT NULL,
  email TEXT,
  name TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  created_at TEXT NOT NULL
);

-- Only a SHA-256 hash of the session id is stored; the raw id lives in the user's cookie.
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Single-use OAuth state + PKCE verifier; valid for 10 minutes after created_at.
CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  user_id TEXT,
  want_revenue INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

-- A channel Google returned, waiting for "Is this the right channel?".
CREATE TABLE pending_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  title TEXT,
  handle TEXT,
  avatar_url TEXT,
  subscriber_count INTEGER,
  video_count INTEGER,
  scopes TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'youtube',
  channel_id TEXT UNIQUE NOT NULL,
  title TEXT,
  handle TEXT,
  avatar_url TEXT,
  scopes TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'reconnect', 'gone')),
  status_reason TEXT,
  connected_at TEXT NOT NULL,
  last_verified_at TEXT NOT NULL
);

CREATE INDEX channels_user ON channels(user_id);
CREATE INDEX sessions_user ON sessions(user_id);
