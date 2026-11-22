import { type Format, type Measured, type OutlierRow, type Outliers, containsKeyword, median, noData, normalizeKeyword, value, videoStats } from '@viewproof/core';
import type { Context, Hono } from 'hono';
import type { Deps } from '../app';
import { feedOf, historyOf } from '../competitors/routes';
import { POOL_SEEN_DAYS } from '../competitors/poll';
import { readSession } from '../session';

const DAY_MS = 86_400_000;
const MAX_ROWS = 100;
const DAYS = [7, 30, 90, 365];
const MINS = [1.5, 2, 3, 5, 10];
/** Channel size = median views of the uploads in its public feed. */
const SIZES = { small: [0, 10_000], medium: [10_000, 100_000], large: [100_000, Infinity] } as const;

export function parseOutlierQuery(u: URLSearchParams) {
  const format = (['long', 'short'] as const).find((f) => f === u.get('format')) ?? 'any';
  const days = DAYS.find((d) => String(d) === u.get('days')) ?? 30;
  const min = MINS.find((m) => String(m) === u.get('min')) ?? 2;
  const size: keyof typeof SIZES | 'any' = (Object.keys(SIZES) as (keyof typeof SIZES)[]).find((s) => s === u.get('size')) ?? 'any';
  const q = normalizeKeyword(u.get('q') ?? '');
  return { format, days, min, size, q };
}

/** Videos the pool found whose public feed shows them beating their channel's usual (×N ≥ min). Never fetches. */
export async function findOutliers(deps: Deps, query: ReturnType<typeof parseOutlierQuery>): Promise<Outliers> {
  const now = deps.now();
  const nowIso = new Date(now).toISOString();
  const seen = new Date(now - POOL_SEEN_DAYS * DAY_MS).toISOString();
  const candidates = (await deps.db.prepare(
    // The channel is the one the video's own feed lists, not whatever a contribution claimed.
    `SELECT pv.video_id, fv.channel_id, t.title AS channel_title FROM pool_videos pv
     JOIN feed_videos fv ON fv.video_id = pv.video_id
     JOIN tracked_channels t ON t.channel_id = fv.channel_id AND t.last_poll_ok_at IS NOT NULL
     WHERE pv.last_seen_at >= ?`,
  ).bind(seen).all<{ video_id: string; channel_id: string; channel_title: string }>()).results;

  const channelIds = [...new Set(candidates.map((c) => c.channel_id))];
  const feeds = await feedOf(deps, channelIds);
  const hist = await historyOf(deps, candidates.map((c) => c.video_id));
  const rows: OutlierRow[] = [];
  for (const c of candidates) {
    const feed = feeds.get(c.channel_id) ?? [];
    const v = feed.find((f) => f.videoId === c.video_id);
    if (!v) continue; // aged out of the feed's latest 15
    if (query.format !== 'any' && v.format !== query.format) continue;
    if (now - Date.parse(v.publishedAt) > query.days * DAY_MS) continue;
    if (query.q && !containsKeyword(v.title, query.q)) continue;
    const views = feed.filter((f) => f.views !== null).map((f) => f.views!);
    const med = median(views);
    const channelMedian: Measured<number> = med === null ? noData('No view counts in the channel feed') : value(med, `median views of ${views.length} uploads in the channel's public feed`, { n: views.length });
    if (query.size !== 'any') {
      const [lo, hi] = SIZES[query.size];
      if (med === null || med < lo || med >= hi) continue;
    }
    const s = videoStats(v, hist.get(v.videoId) ?? [], feed, nowIso);
    if (s.outlier.kind !== 'value' || s.outlier.value < query.min) continue;
    rows.push({ ...s, channelId: c.channel_id, channelTitle: c.channel_title, channelMedian });
  }
  rows.sort((a, b) => (b.outlier.kind === 'value' ? b.outlier.value : 0) - (a.outlier.kind === 'value' ? a.outlier.value : 0));

  const cov = await deps.db.prepare(
    // Channels whose feed has never been readable (deleted or made-up ids) are left out of every count.
    `WITH ch AS (SELECT pc.channel_id, t.last_poll_ok_at, t.last_polled_at FROM pool_channels pc JOIN tracked_channels t USING (channel_id)
                WHERE pc.last_seen_at >= ?1 AND (t.last_poll_ok_at IS NOT NULL OR t.last_polled_at IS NULL))
     SELECT (SELECT COUNT(*) FROM pool_videos pv JOIN ch USING (channel_id)) AS videos,
            (SELECT COUNT(*) FROM ch) AS channels,
            (SELECT COUNT(*) FROM ch WHERE last_polled_at IS NULL) AS waiting,
            (SELECT COUNT(*) FROM pool_videos pv JOIN pool_channels pc USING (channel_id) JOIN tracked_channels t USING (channel_id)
              WHERE pc.last_seen_at >= ?1 AND t.last_poll_ok_at IS NOT NULL AND pv.video_id NOT IN (SELECT video_id FROM feed_videos)) AS older`,
  ).bind(seen).first<{ videos: number; channels: number; waiting: number; older: number }>();
  return { rows: rows.slice(0, MAX_ROWS), coverage: { videos: cov!.videos, channels: cov!.channels, channelsWaiting: cov!.waiting, olderThanFeed: cov!.older, days: 30 } };
}

export function outlierRoutes(app: Hono, deps: Deps): void {
  app.get('/api/outliers', async (c: Context) => {
    const s = await readSession(c, deps);
    if (!s) return c.json({ error: 'signed_out', message: 'Sign in first.' }, 401);
    return c.json(await findOutliers(deps, parseOutlierQuery(new URL(c.req.url).searchParams)));
  });
}
