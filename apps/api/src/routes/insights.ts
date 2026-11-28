// Traffic sources and audience retention (YouTube Analytics), served to the AI connector through channelReport.
import { type Measured, type RangeKey, type RetentionPoint, type TrafficSource, type TrafficSources, type VideoRetention, noData } from '@viewproof/core';
import type { Deps } from '../app';
import type { ChannelAccess } from '../channel-data';
import type { GoogleError } from '../google';
import { dailyFor, isErr, rowsBy, yt } from './channel';

/** YouTube Studio's names for insightTrafficSourceType codes; an unknown code is shown as itself. */
const SOURCE_LABELS: Record<string, string> = {
  ADVERTISING: 'YouTube advertising',
  ANNOTATION: 'Annotations',
  CAMPAIGN_CARD: 'Campaign cards',
  END_SCREEN: 'End screens',
  EXT_URL: 'External',
  HASHTAGS: 'Hashtag pages',
  LIVE_REDIRECT: 'Live redirect',
  NO_LINK_EMBEDDED: 'Embedded players',
  NO_LINK_OTHER: 'Direct or unknown',
  NOTIFICATION: 'Notifications',
  PLAYLIST: 'Playlists',
  PRODUCT_PAGE: 'Product pages',
  PROMOTED: 'Promoted',
  RELATED_VIDEO: 'Suggested videos',
  SHORTS: 'Shorts feed',
  SHORTS_CONTENT_LINKS: 'Shorts content links',
  SOUND_PAGE: 'Sound pages',
  SUBSCRIBER: 'Browse features',
  VIDEO_REMIXES: 'Video remixes',
  YT_CHANNEL: 'Channel pages',
  YT_OTHER_PAGE: 'Other YouTube features',
  YT_PLAYLIST_PAGE: 'Playlist pages',
  YT_SEARCH: 'YouTube search',
};
const NO_SOURCES = 'YouTube returned no traffic sources for these dates';
const NOT_IN_PREV_SOURCES = 'YouTube listed no views from this source in the previous period';

const sources = (deps: Deps, a: ChannelAccess, start: string, end: string) =>
  deps.youtube.report(a.accessToken, { startDate: start, endDate: end, metrics: ['views', 'estimatedMinutesWatched'], dimensions: ['insightTrafficSourceType'], sort: '-views' });

export async function loadTrafficSources(deps: Deps, a: ChannelAccess, range: RangeKey): Promise<TrafficSources | GoogleError> {
  const d = await dailyFor(deps, a, range);
  if (isErr(d)) return d;
  const p = d.coverage.period;
  const [cur, prev] = await Promise.all([sources(deps, a, p.start, p.end), sources(deps, a, p.prevStart, p.prevEnd)]);
  if (isErr(cur)) return cur;
  if (isErr(prev)) return prev;
  const KEY = 'insightTrafficSourceType';
  const prevViews = new Map(rowsBy(prev, KEY).map(({ key, o }) => [key, Number(o.views)]));
  const rows = rowsBy(cur, KEY).map(({ key, o }) => ({ type: key, views: Number(o.views), watchMinutes: Number(o.estimatedMinutesWatched) })).filter((r) => Number.isFinite(r.views));
  const totalViews = rows.reduce((s, r) => s + r.views, 0);
  const list: TrafficSource[] = rows.map((r) => {
    const pv = prevViews.get(r.type);
    return {
      type: r.type, label: SOURCE_LABELS[r.type] ?? r.type, views: r.views, watchMinutes: r.watchMinutes,
      shareOfViews: totalViews > 0 ? yt(r.views / totalViews, { metric: 'views', views: r.views, totalViews }) : noData('No views in this period'),
      previousViews: pv === undefined ? noData(NOT_IN_PREV_SOURCES) : yt(pv, { metric: 'views', period: 'previous' }),
    };
  });
  return { range, coverage: d.coverage, sources: list, totalViews, note: list.length ? null : NO_SOURCES, fetchedAt: new Date(deps.now()).toISOString() };
}

const NO_CURVE = "YouTube returned no retention data for this video in these dates (it shows retention only once a video has enough views; it doesn't publish the threshold).";
const NO_LENGTH = "YouTube didn't give this video's length, so 30 seconds can't be placed on the curve.";
const TOO_SHORT = 'The video is 30 seconds long or shorter.';
const BEFORE_FIRST = "30 seconds comes before YouTube's first retention point (1% of the video's length).";

/** audienceWatchRatio at `sec`, read on the straight line between the two nearest points. */
export function watchRatioAt(curve: RetentionPoint[], durationSec: number | null, sec: number): Measured<number> {
  if (!curve.length) return noData(NO_CURVE);
  if (!durationSec) return noData(NO_LENGTH);
  if (durationSec <= sec) return noData(TOO_SHORT);
  const t = sec / durationSec;
  const after = curve.findIndex((p) => p.elapsedRatio >= t);
  if (after < 0) return noData(NO_CURVE);
  const hi = curve[after]!;
  if (hi.elapsedRatio === t) return yt(hi.audienceWatchRatio, { metric: 'audienceWatchRatio', elapsedRatio: t });
  if (after === 0) return noData(BEFORE_FIRST);
  const lo = curve[after - 1]!;
  const w = lo.audienceWatchRatio + ((hi.audienceWatchRatio - lo.audienceWatchRatio) * (t - lo.elapsedRatio)) / (hi.elapsedRatio - lo.elapsedRatio);
  return yt(w, { metric: 'audienceWatchRatio', elapsedRatio: Number(t.toFixed(4)), between: `${lo.elapsedRatio}–${hi.elapsedRatio}` });
}

/** One of the creator's videos' retention curve for the range; `missing` when it isn't this channel's. */
export async function loadRetention(deps: Deps, a: ChannelAccess, videoId: string, range: RangeKey): Promise<VideoRetention | { missing: true } | GoogleError> {
  const v = await deps.youtube.video(a.accessToken, videoId);
  if (isErr(v)) return v;
  if (!v || v.channelId !== a.channel.channel_id) return { missing: true };
  const d = await dailyFor(deps, a, range);
  if (isErr(d)) return d;
  const p = d.coverage.period;
  const r = await deps.youtube.report(a.accessToken, {
    startDate: p.start, endDate: p.end, metrics: ['audienceWatchRatio', 'relativeRetentionPerformance'], dimensions: ['elapsedVideoTimeRatio'],
    filters: `video==${videoId}`, sort: 'elapsedVideoTimeRatio',
  });
  if (isErr(r)) return r;
  const dur = v.durationSec;
  const curve: RetentionPoint[] = rowsBy(r, 'elapsedVideoTimeRatio')
    .map(({ o }) => {
      const ratio = Number(o.elapsedVideoTimeRatio);
      const rel = Number(o.relativeRetentionPerformance);
      return {
        elapsedRatio: ratio,
        elapsedSec: dur ? Math.round(ratio * dur) : null,
        audienceWatchRatio: Number(o.audienceWatchRatio),
        relativeRetentionPerformance: o.relativeRetentionPerformance !== undefined && Number.isFinite(rel) ? yt(rel, { metric: 'relativeRetentionPerformance' }) : noData('YouTube gave no comparison for this point'),
      };
    })
    .filter((x) => Number.isFinite(x.elapsedRatio) && Number.isFinite(x.audienceWatchRatio))
    .sort((x, y) => x.elapsedRatio - y.elapsedRatio);
  const at30 = watchRatioAt(curve, dur, 30);
  return {
    videoId, title: v.title, durationSec: dur, range, period: { start: p.start, end: p.end }, curve,
    watchingAt30s: at30,
    dropOffBy30s: at30.kind === 'value' ? yt(1 - at30.value, { formula: '1 − watchingAt30s', watchingAt30s: at30.value }) : at30,
    note: curve.length ? null : NO_CURVE,
    fetchedAt: new Date(deps.now()).toISOString(),
  };
}
