import { parseChannelFeed, parseFeedChannel } from '@viewproof/core';
import type { Deps } from '../app';

/** A channel's feed is fetched at most once per window, whatever the number of users tracking it. */
export const POLL_EVERY_MS = 3 * 3_600_000;
const SNAPSHOT_KEEP_DAYS = 90;
const STATS_KEEP_DAYS = 30;
/** A pool channel is polled and kept while a contribution saw it within this many days. */
export const POOL_SEEN_DAYS = 30;
const POOL_OBSERVATIONS_KEEP_DAYS = 90;
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
  const stored = await ingestFeed(deps, channelId, res.xml);
  return stored === 'ok' ? 'polled' : fail(stored.error);
}

/** Store a fetched feed: upsert its videos, snapshot each count that changed (or is a day old), mark the check OK. */
export async function ingestFeed(deps: Deps, channelId: string, xml: string): Promise<'ok' | { error: string }> {
  const now = deps.now();
  const iso = new Date(now).toISOString();
  const parsed = parseChannelFeed(xml);
  if (!parsed.ok) return { error: parsed.reason };
  const meta = parseFeedChannel(xml);
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
  // Videos no longer in the feed (deleted, made private, or older than its latest 15) go with their snapshots:
  // a frozen count must not keep showing as a current one.
  const keep = parsed.value.map((v) => v.videoId);
  stmts.push(deps.db.prepare(`DELETE FROM feed_videos WHERE channel_id = ?${keep.length ? ` AND video_id NOT IN (${keep.map(() => '?').join(',')})` : ''}`).bind(channelId, ...keep));
  // Channels get renamed, and pool channels start with their id as the title.
  if (meta) stmts.push(deps.db.prepare('UPDATE tracked_channels SET title = ? WHERE channel_id = ?').bind(meta.title, channelId));
  stmts.push(deps.db.prepare('UPDATE tracked_channels SET last_poll_ok_at = ?, last_poll_error = NULL WHERE channel_id = ?').bind(iso, channelId));
  await deps.db.batch(stmts);
  return 'ok';
}

/** Poll up to `max` channels whose window has passed, never-polled and oldest first. Returns how many were tried. */
export async function pollStale(deps: Deps, max: number, channelIds?: string[], kind?: 'tracked' | 'pool'): Promise<number> {
  const cutoff = new Date(deps.now() - POLL_EVERY_MS).toISOString();
  const poolCutoff = new Date(deps.now() - POOL_SEEN_DAYS * DAY_MS).toISOString();
  const scope = channelIds ? ` AND channel_id IN (${channelIds.map(() => '?').join(',') || "''"})` : '';
  const tracked = 'channel_id IN (SELECT channel_id FROM user_competitors)';
  // Pool channels: seen by a contribution in the last 30 days and tracked by nobody (tracked ones have their own budget).
  const kindSql = kind === 'tracked' ? ` AND ${tracked}` : kind === 'pool' ? ` AND NOT ${tracked} AND channel_id IN (SELECT channel_id FROM pool_channels WHERE last_seen_at >= ?)` : '';
  const due = (await deps.db.prepare(
    `SELECT channel_id FROM tracked_channels WHERE (last_polled_at IS NULL OR last_polled_at < ?)${scope}${kindSql}
     ORDER BY last_polled_at IS NOT NULL, last_polled_at LIMIT ?`,
  ).bind(cutoff, ...(channelIds ?? []), ...(kind === 'pool' ? [poolCutoff] : []), max).all<{ channel_id: string }>()).results;
  for (const d of due) await pollChannel(deps, d.channel_id);
  return due.length;
}

/** Drop channels nobody tracks (their videos and snapshots cascade), snapshots older than 90 days, Data API stats older than 30 days. */
export async function pruneCompetitors(deps: Deps): Promise<void> {
  const now = deps.now();
  await deps.db.batch([
    deps.db.prepare('DELETE FROM pool_channels WHERE last_seen_at < ?').bind(new Date(now - POOL_SEEN_DAYS * DAY_MS).toISOString()),
    deps.db.prepare('DELETE FROM pool_observations WHERE at < ?').bind(new Date(now - POOL_OBSERVATIONS_KEEP_DAYS * DAY_MS).toISOString()),
    deps.db.prepare('DELETE FROM tracked_channels WHERE channel_id NOT IN (SELECT channel_id FROM user_competitors) AND channel_id NOT IN (SELECT channel_id FROM pool_channels)'),
    deps.db.prepare('DELETE FROM video_snapshots WHERE at < ?').bind(new Date(now - SNAPSHOT_KEEP_DAYS * DAY_MS).toISOString()),
    deps.db.prepare('UPDATE tracked_channels SET subscribers = NULL, total_views = NULL, video_count = NULL, stats_at = NULL WHERE stats_at < ?')
      .bind(new Date(now - STATS_KEEP_DAYS * DAY_MS).toISOString()),
  ]);
}
