// Thumbnail impressions, click-through rate and end screens from the stored Reporting API rows.
import { type Measured, type RangeKey, type Thumbnails, noData, periodFor, value } from '@viewproof/core';
import type { Deps } from '../app';
import type { ChannelAccess } from '../channel-data';
import type { GoogleError } from '../google';
import { isErr, today, uploadsOf } from '../routes/channel';
import { ensureJobs, jobsOf } from './sync';

const SOURCE = 'YouTube Reporting API';
const rep = (n: number, inputs: Record<string, string | number> = {}): Measured<number> => value(n, SOURCE, inputs);
const DAY_MS = 86_400_000;

/** YouTube's traffic_source_type numbers (Reporting API) in YouTube Studio's words. */
export const REACH_SOURCE_LABELS: Record<number, string> = {
  0: 'Direct or unknown', 1: 'YouTube advertising', 3: 'Browse features', 4: 'Channel pages', 5: 'YouTube search', 7: 'Suggested videos',
  8: 'Other YouTube features', 9: 'External', 11: 'Cards and annotations', 14: 'Playlists', 17: 'Notifications', 18: 'Playlist pages',
  19: 'Programming from claimed content', 20: 'End screens', 23: 'Stories', 24: 'Shorts feed', 25: 'Product pages', 26: 'Hashtag pages',
  27: 'Sound pages', 28: 'Live redirect', 29: 'Podcasts', 30: 'Remixed videos', 31: 'Vertical live feed', 32: 'Related videos',
};

export const NO_REACH_DAYS = 'ViewProof has no thumbnail data for these dates yet (YouTube sends it daily, about two days late; ViewProof keeps the last 30 days)';
const NO_REACH_VIDEO = 'YouTube recorded no thumbnail impressions for this video in the days ViewProof has (the last 30 at most)';

type Reach = { impressions: number; latest: { day: string; ctr: number } | null; byDay: { date: string; ctr: number }[] };

/**
 * Per video over [start, end]: impressions summed (a count), and YouTube's own click-through rate per day as given.
 * No period click-through rate is computed (YouTube policy III.E.4.h).
 */
export async function reachByVideo(deps: Deps, channelRowId: string, start: string, end: string, videoId?: string): Promise<{ byVideo: Map<string, Reach>; days: number }> {
  const rows = (await deps.db.prepare(`SELECT day, video_id, impressions, ctr FROM reach_daily WHERE channel_id = ? AND day BETWEEN ? AND ?${videoId ? ' AND video_id = ?' : ''} ORDER BY day`)
    .bind(...[channelRowId, start, end, ...(videoId ? [videoId] : [])]).all<{ day: string; video_id: string; impressions: number; ctr: number | null }>()).results;
  const byVideo = new Map<string, Reach>();
  for (const r of rows) {
    const v = byVideo.get(r.video_id) ?? { impressions: 0, latest: null, byDay: [] };
    v.impressions += r.impressions;
    if (r.ctr !== null) {
      v.byDay.push({ date: r.day, ctr: r.ctr });
      v.latest = { day: r.day, ctr: r.ctr };
    }
    byVideo.set(r.video_id, v);
  }
  const days = videoId
    ? (await deps.db.prepare('SELECT COUNT(DISTINCT day) AS n FROM reach_daily WHERE channel_id = ? AND day BETWEEN ? AND ?').bind(channelRowId, start, end).first<{ n: number }>())?.n ?? 0
    : new Set(rows.map((r) => r.day)).size;
  return { byVideo, days };
}

/** One video's impressions (summed) and latest daily CTR, measured or with the reason. */
export function reachMeasures(r: { byVideo: Map<string, Reach>; days: number }, videoId: string): { impressions: Measured<number>; latestCtr: Measured<number> } {
  if (!r.days) return { impressions: noData(NO_REACH_DAYS), latestCtr: noData(NO_REACH_DAYS) };
  const s = r.byVideo.get(videoId);
  if (!s || s.impressions <= 0) return { impressions: noData(NO_REACH_VIDEO), latestCtr: noData(NO_REACH_VIDEO) };
  return {
    impressions: rep(s.impressions, { days: r.days, formula: 'sum of daily impressions' }),
    latestCtr: s.latest ? rep(s.latest.ctr, { day: s.latest.day }) : noData('YouTube gave no click-through rate for this video in these days'),
  };
}

/** End screen impressions and clicks (counts summed) of one video, or of all when videoId is null. */
export async function endScreens(deps: Deps, channelRowId: string, start: string, end: string, videoId: string | null): Promise<Thumbnails['endScreens']> {
  const r = await deps.db.prepare(`SELECT SUM(impressions) AS impressions, SUM(clicks) AS clicks, COUNT(*) AS n FROM end_screen_daily WHERE channel_id = ? AND day BETWEEN ? AND ?${videoId ? ' AND video_id = ?' : ''}`)
    .bind(...[channelRowId, start, end, ...(videoId ? [videoId] : [])]).first<{ impressions: number | null; clicks: number | null; n: number }>();
  if (!r || !r.n || !r.impressions) {
    const why = videoId ? 'YouTube recorded no end screen views for this video in the days ViewProof has (add an end screen in YouTube Studio)' : 'YouTube recorded no end screen views in the days ViewProof has';
    return { impressions: noData(why), clicks: noData(why) };
  }
  return { impressions: rep(r.impressions, { formula: 'sum of daily counts' }), clicks: rep(r.clicks ?? 0, { formula: 'sum of daily counts' }) };
}

export async function loadThumbnails(deps: Deps, a: ChannelAccess, range: RangeKey): Promise<Thumbnails | GoogleError> {
  const started = await ensureJobs(deps, a);
  if (started) return started;
  const ch = a.channel.id;
  const p = periodFor(range, today(deps));
  const fetchedAt = new Date(deps.now()).toISOString();
  const jobs = await jobsOf(deps, ch);
  const daily = (await deps.db.prepare('SELECT day, SUM(impressions) AS impressions FROM reach_daily WHERE channel_id = ? AND day BETWEEN ? AND ? GROUP BY day ORDER BY day')
    .bind(ch, p.start, p.end).all<{ day: string; impressions: number }>()).results;
  const empty = (status: Thumbnails['status'], reason: string): Thumbnails => ({
    status, reason, range, days: { from: null, to: null, count: 0 }, totals: { impressions: noData(reason) },
    daily: [], videos: [], sources: [], endScreens: { impressions: noData(reason), clicks: noData(reason) }, fetchedAt,
  });
  if (!daily.length) {
    const failed = jobs.filter((j) => j.status === 'failed');
    if (jobs.length && failed.length === jobs.length) return empty('failed', `YouTube didn't start thumbnail reports for this channel: ${failed[0]!.status_reason ?? 'no reason given'}`);
    const first = jobs.reduce((m, j) => (j.created_at < m ? j.created_at : m), new Date(deps.now()).toISOString());
    if (deps.now() - Date.parse(first) < 4 * DAY_MS) {
      return empty('waiting', `ViewProof asked YouTube for thumbnail reports on ${first.slice(0, 10)}. YouTube sends the first ones within about two days, with up to 30 days of history.`);
    }
    return empty('ok', NO_REACH_DAYS);
  }
  const reach = await reachByVideo(deps, ch, p.start, p.end);
  const top = [...reach.byVideo].filter(([id]) => id !== '').sort((x, y) => y[1].impressions - x[1].impressions).slice(0, 25);
  const sources = (await deps.db.prepare('SELECT source, SUM(impressions) AS impressions FROM reach_source_daily WHERE channel_id = ? AND day BETWEEN ? AND ? GROUP BY source ORDER BY SUM(impressions) DESC')
    .bind(ch, p.start, p.end).all<{ source: number; impressions: number }>()).results;
  const ups = await uploadsOf(deps, a);
  const meta = new Map(isErr(ups) ? [] : ups.map((u) => [u.videoId, u]));
  return {
    status: 'ok', reason: null, range,
    days: { from: daily[0]!.day, to: daily.at(-1)!.day, count: daily.length },
    totals: { impressions: rep(daily.reduce((s, d) => s + d.impressions, 0), { days: daily.length, formula: 'sum of daily impressions' }) },
    daily: daily.map((d) => ({ date: d.day, impressions: d.impressions })),
    videos: top.map(([id, v]) => ({
      videoId: id, title: meta.get(id)?.title ?? id, thumbnailUrl: meta.get(id)?.thumbnailUrl ?? null, impressions: v.impressions,
      latestCtr: reachMeasures(reach, id).latestCtr, ctrByDay: v.byDay,
    })),
    sources: sources.map((s) => ({ type: s.source, label: REACH_SOURCE_LABELS[s.source] ?? `Source ${s.source}`, impressions: s.impressions })),
    endScreens: await endScreens(deps, ch, p.start, p.end, null),
    fetchedAt,
  };
}
