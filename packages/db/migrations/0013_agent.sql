-- Phase 2 agent: the weekly brief (ideas + title proposals) and the changes it measures afterwards.
-- Everything here comes from the creator's own authorized channel; it is deleted with the channel or the account,
-- briefs after 30 days and finished changes 60 days after their last check (hourly job).
CREATE TABLE agent_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  weekly INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,             -- last weekly run, success or not (a failed run waits a day, never retries hourly)
  last_error TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE agent_briefs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_row_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  trigger TEXT NOT NULL,            -- 'weekly' | 'manual'
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  via TEXT NOT NULL,                -- 'own' | 'included'
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  ideas TEXT NOT NULL,              -- JSON [{text, why, sources}]
  sources TEXT NOT NULL,            -- JSON AiSource[] as sent
  missing TEXT NOT NULL,            -- JSON Missing[]
  dropped INTEGER NOT NULL DEFAULT 0 -- items removed because they cited numbers not in the data
);
CREATE INDEX agent_briefs_user ON agent_briefs (user_id, created_at);
CREATE TABLE agent_changes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_row_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  brief_id TEXT NOT NULL,           -- briefs are deleted after 30 days; changes outlive them
  video_id TEXT NOT NULL,
  published_at TEXT NOT NULL,
  before_title TEXT NOT NULL,
  proposed_title TEXT NOT NULL,
  why TEXT NOT NULL,
  sources TEXT NOT NULL,            -- JSON ["S1", ...] into the brief's sources
  status TEXT NOT NULL,             -- proposed | approved | dismissed | applied | expired
  created_at TEXT NOT NULL,
  approved_at TEXT,
  applied_on TEXT,                  -- first Pacific day the new title was seen live
  applied_title TEXT,               -- the title actually live (the creator may have edited ours)
  check7 TEXT,                      -- JSON Measurement
  check28 TEXT,
  last_checked_at TEXT
);
CREATE INDEX agent_changes_user ON agent_changes (user_id, created_at);
CREATE INDEX agent_changes_open ON agent_changes (status, last_checked_at);
-- Measured AI cost: tokens per month, task and model, with no link to any account.
CREATE TABLE ai_tokens (
  month TEXT NOT NULL,
  task TEXT NOT NULL,               -- quick | coach | brief
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  via TEXT NOT NULL,                -- own | included
  runs INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (month, task, provider, model, via)
);
ALTER TABLE ai_usage ADD COLUMN brief INTEGER NOT NULL DEFAULT 0;
