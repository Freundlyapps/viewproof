-- Plan 5b review fixes.
-- Suspension is per account (7 days), so relinking or another browser of the same account can't bypass it.
CREATE TABLE pool_suspensions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  until TEXT NOT NULL
);
-- Only malformed items count toward suspension; history mismatches don't. New channels per browser per day are capped.
ALTER TABLE pool_token_days ADD COLUMN invalid INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pool_token_days ADD COLUMN new_channels INTEGER NOT NULL DEFAULT 0;
