-- Plan 6a: users' own AI keys (encrypted per user, D7) and monthly use of the included AI (spec §9 limits).
CREATE TABLE ai_keys (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  base_url TEXT,
  quick_model TEXT NOT NULL,
  coach_model TEXT NOT NULL,
  key_box TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE ai_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  quick INTEGER NOT NULL DEFAULT 0,
  coach INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month)
);
