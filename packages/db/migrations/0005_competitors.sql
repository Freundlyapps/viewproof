-- Competitor tracking (plan 5a). Feed data is public RSS (S4); subscriber/total-view counts are
-- YouTube Data API values, overwritten daily and cleared after 30 days (policy III.E.4.a).
CREATE TABLE tracked_channels (
  channel_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  handle TEXT,
  last_polled_at TEXT,
  last_poll_ok_at TEXT,
  last_poll_error TEXT,
  subscribers INTEGER,
  total_views INTEGER,
  video_count INTEGER,
  stats_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE user_competitors (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES tracked_channels(channel_id) ON DELETE CASCADE,
  added_at TEXT NOT NULL,
  PRIMARY KEY (user_id, channel_id)
);
CREATE TABLE feed_videos (
  video_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES tracked_channels(channel_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  published_at TEXT NOT NULL,
  format TEXT NOT NULL,
  first_seen_at TEXT NOT NULL
);
CREATE INDEX feed_videos_channel ON feed_videos(channel_id, published_at);
CREATE TABLE video_snapshots (
  video_id TEXT NOT NULL REFERENCES feed_videos(video_id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  views INTEGER NOT NULL,
  PRIMARY KEY (video_id, at)
);
