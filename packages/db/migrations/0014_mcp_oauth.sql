-- MCP sign-in for chat apps (Claude, ChatGPT…): OAuth 2.1 with dynamic client registration and PKCE.
-- A connected app is a row in mcp_tokens, like a hand-made token, so revoking works the same way.
-- Only hashes of codes and tokens are stored.

-- Apps that registered themselves (RFC 7591). The name is what the app says it is; it is shown as such.
-- Registrations never used to connect are deleted after a day (when new apps register).
CREATE TABLE mcp_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL, -- JSON array of exact URLs
  created_at TEXT NOT NULL,
  used_at TEXT
);

-- One-time codes from the consent page, valid for 10 minutes.
CREATE TABLE mcp_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES mcp_clients(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Connected apps: access tokens expire after an hour, refresh tokens rotate on every use and end after 90 days unused.
ALTER TABLE mcp_tokens ADD COLUMN client_id TEXT REFERENCES mcp_clients(id) ON DELETE CASCADE;
ALTER TABLE mcp_tokens ADD COLUMN expires_at TEXT;
ALTER TABLE mcp_tokens ADD COLUMN refresh_hash TEXT;
ALTER TABLE mcp_tokens ADD COLUMN refresh_expires_at TEXT;
CREATE UNIQUE INDEX mcp_tokens_refresh ON mcp_tokens (refresh_hash);
