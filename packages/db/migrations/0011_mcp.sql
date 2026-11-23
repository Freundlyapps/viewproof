-- Plan 6c: tokens for the read-only MCP server (only the SHA-256 is stored) and daily MCP tool-call counts.
CREATE TABLE mcp_tokens (
  id TEXT PRIMARY KEY,
  id_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX mcp_tokens_user ON mcp_tokens (user_id);
CREATE TABLE mcp_calls (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
