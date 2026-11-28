-- YouTube Reporting API (thumbnail impressions, click-through rate, end screens) for connected channels.
-- One reporting job per channel and report type; YouTube makes one file per day, which the hourly job downloads.
-- Rows are YouTube API data from the creator's own channel: kept 30 days after download (hourly job), deleted with the channel.
CREATE TABLE reporting_jobs (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  report_type TEXT NOT NULL,         -- e.g. channel_reach_basic_a1
  job_id TEXT,                       -- YouTube's job id; null while it couldn't be created
  status TEXT NOT NULL,              -- 'ok' | 'failed'
  status_reason TEXT,
  created_at TEXT NOT NULL,
  checked_at TEXT,                   -- last time its files were listed (or creation was tried)
  last_file_created TEXT,            -- createTime of the newest file downloaded
  PRIMARY KEY (channel_id, report_type)
);
-- Thumbnail impressions and YouTube's click-through rate per video and day (channel_reach_basic_a1), as given
-- (ctr as a fraction 0–1). Nothing is computed from them (YouTube policy III.E.4.h).
CREATE TABLE reach_daily (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  video_id TEXT NOT NULL,
  impressions INTEGER NOT NULL,
  ctr REAL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (channel_id, day, video_id)
);
-- Impressions by traffic source (channel_reach_combined_a1; YouTube's numeric traffic_source_type), counts only.
CREATE TABLE reach_source_daily (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  video_id TEXT NOT NULL,
  source INTEGER NOT NULL,
  impressions INTEGER NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (channel_id, day, video_id, source)
);
-- End screen element impressions and clicks per video and day (channel_end_screens_a2, counts summed over elements).
CREATE TABLE end_screen_daily (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  video_id TEXT NOT NULL,
  impressions INTEGER NOT NULL,
  clicks INTEGER NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (channel_id, day, video_id)
);
