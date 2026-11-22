-- New-competitor lookups per user per UTC day (each costs a YouTube feed fetch or Data API quota).
CREATE TABLE competitor_lookups (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);
