-- Keyword trends from an optional vendor (Google Trends via DataForSEO): shared across users, kept 30 days.
-- Not tied to a user or channel; holds no personal data.
CREATE TABLE keyword_cache (
  keyword TEXT NOT NULL,
  country TEXT NOT NULL,
  provider TEXT NOT NULL,
  body TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (keyword, country, provider)
);

-- New (uncached) vendor lookups per user per UTC day, so one account can't run up vendor spend.
CREATE TABLE keyword_lookups (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);
