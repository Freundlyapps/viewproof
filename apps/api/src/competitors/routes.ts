import { type Competitor, type CompetitorDetail, type CompetitorUploads, type FeedVideo, type Format, type Measured, channelSummary, noData, parseChannelInput, parseFeedChannel, value, videoStats } from '@viewproof/core';
import type { TrackedChannelRow } from '@viewproof/db';
import type { Context, Hono } from 'hono';
import type { Deps } from '../app';
import { accessFor } from '../channel-data';
import { readSession } from '../session';
import { ingestFeed, pollChannel, pollStale } from './poll';
import type { StatsAuth } from './stats';

export const MAX_COMPETITORS = 25;
/** New-channel lookups (feed fetch or @handle resolution) per user per UTC day. */
export const DAILY_ADDS = 50;
const STATS_KEEP_MS = 30 * 86_400_000;
const FEED_SIZE = 15;
const API_SOURCE = 'YouTube Data API';
const HANDLE_HELP = "To add by @handle, connect your channel (Account) or paste the channel's /channel/UC… link.";
const NO_STATS = 'Subscriber counts need a YouTube API key on this server (or your connected channel)';

type Row = TrackedChannelRow & { added_at: string };
const err = (c: Context, status: number, error: string, message: string) => c.json({ error, message }, status as 400);

/** Server key, else the user's own connected-channel access (youtube.readonly). */
async function statsAuth(deps: Deps, userId: string): Promise<StatsAuth | null> {
  if (deps.config.youtubeApiKey) return { key: deps.config.youtubeApiKey };
  const ch = await deps.db.prepare("SELECT * FROM channels WHERE user_id = ? AND status = 'active' ORDER BY connected_at LIMIT 1").bind(userId).first();
  if (!ch) return null;
  const a = await accessFor(deps, ch as never);
  return 'error' in a ? null : { token: a.accessToken };
}

/** Write current Data API counts (overwritten each time; cleared after 30 days by the prune). */
export async function saveStats(deps: Deps, ids: string[], auth: StatsAuth): Promise<void> {
  const stats = await deps.channelStats.byIds(ids, auth);
  if ('error' in stats) return;
  const at = new Date(deps.now()).toISOString();
  await deps.db.batch(ids.filter((id) => stats.has(id)).map((id) => {
    const s = stats.get(id)!;
    return deps.db.prepare('UPDATE tracked_channels SET subscribers = ?, total_views = ?, video_count = ?, stats_at = ? WHERE channel_id = ?')
      .bind(s.subscribers, s.totalViews, s.videoCount, at, id);
  }));
}

/** The channel's latest 15 feed videos with each one's latest snapshot count. */
export async function feedOf(deps: Deps, channelIds: string[]): Promise<Map<string, (FeedVideo & { title: string })[]>> {
  const out = new Map<string, (FeedVideo & { title: string })[]>();
  if (!channelIds.length) return out;
  const rows = (await deps.db.prepare(
    `SELECT v.video_id, v.channel_id, v.title, v.published_at, v.format,
            (SELECT views FROM video_snapshots s WHERE s.video_id = v.video_id ORDER BY at DESC LIMIT 1) AS views
     FROM feed_videos v WHERE v.channel_id IN (${channelIds.map(() => '?').join(',')}) ORDER BY v.published_at DESC`,
  ).bind(...channelIds).all<{ video_id: string; channel_id: string; title: string; published_at: string; format: string; views: number | null }>()).results;
  for (const r of rows) {
    const list = out.get(r.channel_id) ?? [];
    if (list.length < FEED_SIZE) list.push({ platform: 'youtube', videoId: r.video_id, title: r.title, publishedAt: r.published_at, views: r.views, format: r.format as Format });
    out.set(r.channel_id, list);
  }
  return out;
}

export async function historyOf(deps: Deps, videoIds: string[]) {
  const out = new Map<string, { views: number; at: string }[]>();
  if (!videoIds.length) return out;
  const rows = (await deps.db.prepare(`SELECT video_id, at, views FROM video_snapshots WHERE video_id IN (${videoIds.map(() => '?').join(',')}) ORDER BY at`)
    .bind(...videoIds).all<{ video_id: string; at: string; views: number }>()).results;
  for (const r of rows) out.set(r.video_id, [...(out.get(r.video_id) ?? []), { views: r.views, at: r.at }]);
  return out;
}

function counts(deps: Deps, r: Row): { subscribers: Measured<number>; totalViews: Measured<number> } {
  // Data API values are never shown past 30 days (policy III.E.4.a), even where the Cron prune doesn't run.
  if (!r.stats_at || deps.now() - Date.parse(r.stats_at) >= STATS_KEEP_MS) {
    const why = deps.config.youtubeApiKey ? 'Not fetched yet' : NO_STATS;
    return { subscribers: noData(why), totalViews: noData(why) };
  }
  const m = (v: number | null, hidden: string) => (v === null ? noData(hidden) : value(v, API_SOURCE, { asOf: r.stats_at! }));
  return { subscribers: m(r.subscribers, 'This channel hides its subscriber count'), totalViews: m(r.total_views, 'YouTube returned no total view count') };
}

function toCompetitor(deps: Deps, r: Row, feed: FeedVideo[]): Competitor {
  return {
    channelId: r.channel_id, title: r.title, handle: r.handle, addedAt: r.added_at, lastCheckedAt: r.last_poll_ok_at,
    checkError: r.last_poll_error ? `Feed check failed: ${r.last_poll_error}` : null,
    ...counts(deps, r), summary: channelSummary(feed, new Date(deps.now()).toISOString()),
  };
}

const STATS_FRESH_MS = 86_400_000;

/** Without a server key nothing refreshes counts daily: refresh missing or day-old ones with this user's access. */
async function refreshStaleStats(deps: Deps, userId: string, rows: Row[]): Promise<void> {
  if (deps.config.youtubeApiKey) return; // the daily Cron job keeps them fresh
  const stale = rows.filter((r) => !r.stats_at || deps.now() - Date.parse(r.stats_at) >= STATS_FRESH_MS).map((r) => r.channel_id);
  if (!stale.length) return;
  const auth = await statsAuth(deps, userId);
  if (auth) await saveStats(deps, stale, auth);
}

const rowsOf = (deps: Deps, userId: string, channelId?: string) =>
  deps.db.prepare(`SELECT t.*, u.added_at FROM user_competitors u JOIN tracked_channels t USING (channel_id) WHERE u.user_id = ?${channelId ? ' AND t.channel_id = ?' : ''} ORDER BY u.added_at`)
    .bind(...(channelId ? [userId, channelId] : [userId])).all<Row>();

export function competitorRoutes(app: Hono, deps: Deps): void {
  const session = async (c: Context) => (await readSession(c, deps))?.userId ?? null;
  const signedOut = (c: Context) => err(c, 401, 'signed_out', 'Sign in first.');

  app.get('/api/competitors', async (c) => {
    const uid = await session(c);
    if (!uid) return signedOut(c);
    const before = (await rowsOf(deps, uid)).results;
    await pollStale(deps, 3, before.map((r) => r.channel_id));
    await refreshStaleStats(deps, uid, before);
    const rows = (await rowsOf(deps, uid)).results;
    const feeds = await feedOf(deps, rows.map((r) => r.channel_id));
    return c.json(rows.map((r) => toCompetitor(deps, r, feeds.get(r.channel_id) ?? [])));
  });

  app.get('/api/competitors/uploads', async (c) => {
    const uid = await session(c);
    if (!uid) return signedOut(c);
    const ids = (await rowsOf(deps, uid)).results.map((r) => r.channel_id);
    await pollStale(deps, 3, ids);
    const rows = (await rowsOf(deps, uid)).results;
    const feeds = await feedOf(deps, rows.map((r) => r.channel_id));
    const all = rows.flatMap((r) => (feeds.get(r.channel_id) ?? []).map((v) => ({ v, r })))
      .sort((a, b) => Date.parse(b.v.publishedAt) - Date.parse(a.v.publishedAt)).slice(0, 50);
    const hist = await historyOf(deps, all.map((x) => x.v.videoId));
    const now = new Date(deps.now()).toISOString();
    const body: CompetitorUploads = {
      uploads: all.map(({ v, r }) => ({ ...videoStats(v, hist.get(v.videoId) ?? [], feeds.get(r.channel_id) ?? [], now), channelId: r.channel_id, channelTitle: r.title })),
    };
    return c.json(body);
  });

  app.get('/api/competitors/:channelId', async (c) => {
    const uid = await session(c);
    if (!uid) return signedOut(c);
    const id = c.req.param('channelId');
    const before = (await rowsOf(deps, uid, id)).results;
    if (!before[0]) return err(c, 404, 'not_found', 'You are not tracking this channel.');
    await pollChannel(deps, id);
    await refreshStaleStats(deps, uid, before);
    const r = (await rowsOf(deps, uid, id)).results[0]!;
    const feed = (await feedOf(deps, [id])).get(id) ?? [];
    const hist = await historyOf(deps, feed.map((v) => v.videoId));
    const now = new Date(deps.now()).toISOString();
    const body: CompetitorDetail = { ...toCompetitor(deps, r, feed), videos: feed.map((v) => videoStats(v, hist.get(v.videoId) ?? [], feed, now)) };
    return c.json(body);
  });

  app.post('/api/competitors', async (c) => {
    const uid = await session(c);
    if (!uid) return signedOut(c);
    const body = (await c.req.json().catch(() => null)) as { input?: unknown } | null;
    const input = typeof body?.input === 'string' ? body.input : '';
    const parsed = parseChannelInput(input);
    if (parsed.kind === 'invalid') return err(c, 400, 'bad_request', parsed.reason);
    let channelId: string;
    let handle: string | null = null;
    const known0 = parsed.kind === 'id' && (await deps.db.prepare('SELECT 1 FROM tracked_channels WHERE channel_id = ?').bind(parsed.channelId).first());
    if (!known0) {
      // Each new lookup costs a YouTube fetch or Data API quota shared by everyone: cap it per user per day.
      const day = new Date(deps.now()).toISOString().slice(0, 10);
      const counted = await deps.db.prepare(
        `INSERT INTO competitor_lookups (user_id, day, count) VALUES (?, ?, 1)
         ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count`,
      ).bind(uid, day, DAILY_ADDS).first<{ count: number }>();
      if (!counted) return err(c, 429, 'limit', `You looked up ${DAILY_ADDS} new channels today. More tomorrow.`);
    }
    const auth = await statsAuth(deps, uid);
    if (parsed.kind === 'handle') {
      if (!auth) return err(c, 400, 'bad_request', HANDLE_HELP);
      const found = await deps.channelStats.byHandle(parsed.handle, auth);
      if (found && typeof found === 'object') return err(c, 502, 'google_failed', found.error);
      if (!found) return err(c, 404, 'not_found', `No YouTube channel found for ${parsed.handle}.`);
      channelId = found;
      handle = parsed.handle;
    } else channelId = parsed.channelId;

    if (await deps.db.prepare('SELECT 1 FROM user_competitors WHERE user_id = ? AND channel_id = ?').bind(uid, channelId).first()) {
      return err(c, 409, 'bad_request', 'You already track this channel.');
    }
    const n = (await deps.db.prepare('SELECT COUNT(*) AS n FROM user_competitors WHERE user_id = ?').bind(uid).first<{ n: number }>())!.n;
    if (n >= MAX_COMPETITORS) return err(c, 422, 'limit', `You can track up to ${MAX_COMPETITORS} channels.`);

    const now = new Date(deps.now()).toISOString();
    const known = await deps.db.prepare('SELECT channel_id FROM tracked_channels WHERE channel_id = ?').bind(channelId).first();
    if (!known) {
      // A channel nobody tracks yet: its public feed proves it exists and gives its title.
      const feed = await deps.fetchFeed(channelId);
      if (!feed.ok && feed.reason === 'HTTP 404' && parsed.kind === 'id') return err(c, 404, 'not_found', `No YouTube channel found for ${input.trim()}.`);
      const meta = feed.ok ? parseFeedChannel(feed.xml) : null;
      if (!feed.ok || !meta) return err(c, 502, 'google_failed', `Couldn't read the channel's feed (${feed.ok ? 'not a YouTube feed' : feed.reason}). Try again later.`);
      await deps.db.prepare('INSERT OR IGNORE INTO tracked_channels (channel_id, title, handle, last_polled_at, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(channelId, meta.title, handle, now, now).run();
      await ingestFeed(deps, channelId, feed.xml);
      if (auth) await saveStats(deps, [channelId], auth);
    } else if (handle) {
      await deps.db.prepare('UPDATE tracked_channels SET handle = COALESCE(handle, ?) WHERE channel_id = ?').bind(handle, channelId).run();
    }
    await deps.db.prepare('INSERT OR IGNORE INTO user_competitors (user_id, channel_id, added_at) VALUES (?, ?, ?)').bind(uid, channelId, now).run();
    const r = (await rowsOf(deps, uid, channelId)).results[0]!;
    return c.json(toCompetitor(deps, r, (await feedOf(deps, [channelId])).get(channelId) ?? []), 201);
  });

  app.delete('/api/competitors/:channelId', async (c) => {
    const uid = await session(c);
    if (!uid) return signedOut(c);
    await deps.db.prepare('DELETE FROM user_competitors WHERE user_id = ? AND channel_id = ?').bind(uid, c.req.param('channelId')).run();
    return c.body(null, 204);
  });
}
