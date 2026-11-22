import { parseChannelFeed } from '@viewproof/core';
import type { Deps } from '../app';

/** A channel's feed is fetched at most once per window, whatever the number of users tracking it. */
export const POLL_EVERY_MS = 3 * 3_600_000;
const SNAPSHOT_KEEP_DAYS = 90;
const STATS_KEEP_DAYS = 30;
const DAY_MS = 86_400_000;

export type FeedResult = { ok: true; xml: string } | { ok: false; reason: string };

/** Fetch, parse and store one channel's public feed; a snapshot per video when its count changed (or daily). */
export async function pollChannel(deps: Deps, channelId: string): Promise<'polled' | 'skipped' | { error: string }> {
  const now = deps.now();
  const iso = new Date(now).toISOString();
  const row = await deps.db.prepare('SELECT last_polled_at FROM tracked_channels WHERE channel_id = ?').bind(channelId).first<{ last_polled_at: string | null }>();
  if (!row) return { error: 'Not tracked' };
  if (row.last_polled_at && now - Date.parse(row.last_polled_at) < POLL_EVERY_MS) return 'skipped';
  // Claim the window first so concurrent requests don't fetch the same feed twice.
  const claimed = await deps.db
    .prepare('UPDATE tracked_channels SET last_polled_at = ? WHERE channel_id = ? AND (last_polled_at IS NULL OR last_polled_at = ?)')
    .bind(iso, channelId, row.last_polled_at).run();
  if (!claimed.meta.changes) return 'skipped';

  const fail = async (reason: string) => {
    await deps.db.prepare('UPDATE tracked_channels SET last_poll_error = ? WHERE channel_id = ?').bind(reason, channelId).run();
    return { error: reason };
  };
  const res = await deps.fetchFeed(channelId);
  if (!res.ok) return fail(res.reason);
  const parsed = parseChannelFeed(res.xml);
  if (!parsed.ok) return fail(parsed.reason);

  const latest = new Map(
    (await deps.db.prepare(
      `SELECT s.video_id, s.views, s.at FROM video_snapshots s JOIN feed_videos v USING (video_id)
       WHERE v.channel_id = ? AND s.at = (SELECT MAX(at) FROM video_snapshots WHERE video_id = s.video_id)`,
    ).bind(channelId).all<{ video_id: string; views: number; at: string }>()).results.map((r) => [r.video_id, r]),
  );
  const stmts: D1PreparedStatement[] = [];
  for (const v of parsed.value) {
    stmts.push(deps.db.prepare(
      `INSERT INTO feed_videos (video_id, channel_id, title, published_at, format, first_seen_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(video_id) DO UPDATE SET title = excluded.title, format = excluded.format`,
    ).bind(v.videoId, channelId, v.title, v.publishedAt, v.format, iso));
    if (v.views === null) continue;
    const last = latest.get(v.videoId);
    if (!last || last.views !== v.views || now - Date.parse(last.at) >= DAY_MS) {
      stmts.push(deps.db.prepare('INSERT OR IGNORE INTO video_snapshots (video_id, at, views) VALUES (?, ?, ?)').bind(v.videoId, iso, v.views));
    }
  }
  stmts.push(deps.db.prepare('UPDATE tracked_channels SET last_poll_ok_at = ?, last_poll_error = NULL WHERE channel_id = ?').bind(iso, channelId));
  await deps.db.batch(stmts);
  return 'polled';
}

/** Poll up to `max` channels whose window has passed, never-polled and oldest first. Returns how many were tried. */
export async function pollStale(deps: Deps, max: number, channelIds?: string[]): Promise<number> {
  const cutoff = new Date(deps.now() - POLL_EVERY_MS).toISOString();
  const scope = channelIds ? ` AND channel_id IN (${channelIds.map(() => '?').join(',') || "''"})` : '';
  const due = (await deps.db.prepare(
    `SELECT channel_id FROM tracked_channels WHERE (last_polled_at IS NULL OR last_polled_at < ?)${scope}
     ORDER BY last_polled_at IS NOT NULL, last_polled_at LIMIT ?`,
  ).bind(cutoff, ...(channelIds ?? []), max).all<{ channel_id: string }>()).results;
  for (const d of due) await pollChannel(deps, d.channel_id);
  return due.length;
}

/** Drop channels nobody tracks (their videos and snapshots cascade), snapshots older than 90 days, Data API stats older than 30 days. */
export async function pruneCompetitors(deps: Deps): Promise<void> {
  const now = deps.now();
  await deps.db.batch([
    deps.db.prepare('DELETE FROM tracked_channels WHERE channel_id NOT IN (SELECT channel_id FROM user_competitors)'),
    deps.db.prepare('DELETE FROM video_snapshots WHERE at < ?').bind(new Date(now - SNAPSHOT_KEEP_DAYS * DAY_MS).toISOString()),
    deps.db.prepare('UPDATE tracked_channels SET subscribers = NULL, total_views = NULL, video_count = NULL, stats_at = NULL WHERE stats_at < ?')
      .bind(new Date(now - STATS_KEEP_DAYS * DAY_MS).toISOString()),
  ]);
}
