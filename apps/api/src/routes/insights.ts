// Traffic sources, retention, audience and the video check-up (YouTube Analytics + stored Reporting API rows).
// Every number is a value YouTube returned (or a sum of YouTube's counts); nothing is computed from them:
// no shares, ratios or medians (YouTube API policy III.E.4.h).
import { type Audience, type CheckupPart, type Measured, type Overview, type RangeKey, type RetentionPoint, type Slice, type TrafficSource, type TrafficSources, type VideoCheckup, type VideoRetention, noData } from '@viewproof/core';
import type { Deps } from '../app';
import { type ChannelAccess, cached } from '../channel-data';
import type { GoogleError } from '../google';
import type { Context, Hono } from 'hono';
import { endScreens, loadThumbnails, reachByVideo, reachMeasures } from '../reporting/read';
import type { Report, ReportQuery } from '../youtube';
import { REPORT_TTL_MS, VIDEO_ID, dailyFor, firstRow, isErr, loadOverview, loadVideos, rowsBy, serve, today, yt } from './channel';

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

const sources = (deps: Deps, a: ChannelAccess, start: string, end: string, videoId?: string) =>
  deps.youtube.report(a.accessToken, { startDate: start, endDate: end, metrics: ['views', 'estimatedMinutesWatched'], dimensions: ['insightTrafficSourceType'], sort: '-views', ...(videoId ? { filters: `video==${videoId}` } : {}) });

function sourceList(cur: Report, prev: Report | null): TrafficSource[] {
  const KEY = 'insightTrafficSourceType';
  const prevViews = new Map(prev ? rowsBy(prev, KEY).map(({ key, o }) => [key, Number(o.views)]) : []);
  return rowsBy(cur, KEY)
    .map(({ key, o }) => ({ type: key, views: Number(o.views), watchMinutes: Number(o.estimatedMinutesWatched) }))
    .filter((r) => Number.isFinite(r.views))
    .map((r) => {
      const pv = prevViews.get(r.type);
      return {
        type: r.type, label: SOURCE_LABELS[r.type] ?? r.type, views: r.views, watchMinutes: r.watchMinutes,
        previousViews: !prev ? noData('Not compared for a single video') : pv === undefined ? noData(NOT_IN_PREV_SOURCES) : yt(pv, { metric: 'views', period: 'previous' }),
      };
    });
}

export async function loadTrafficSources(deps: Deps, a: ChannelAccess, range: RangeKey): Promise<TrafficSources | GoogleError> {
  const d = await dailyFor(deps, a, range);
  if (isErr(d)) return d;
  const p = d.coverage.period;
  const [cur, prev] = await Promise.all([sources(deps, a, p.start, p.end), sources(deps, a, p.prevStart, p.prevEnd)]);
  if (isErr(cur)) return cur;
  if (isErr(prev)) return prev;
  const list = sourceList(cur, prev);
  return { range, coverage: d.coverage, sources: list, note: list.length ? null : NO_SOURCES, fetchedAt: new Date(deps.now()).toISOString() };
}

const NO_CURVE = "YouTube returned no retention data for this video in these dates (it shows retention only once a video has enough views; it doesn't publish the threshold).";
const NO_LENGTH = "YouTube didn't give this video's length, so 0:30 can't be found on the curve.";
const TOO_SHORT = 'The video is 30 seconds long or shorter.';

/** YouTube's first retention point at or after `sec`, exactly as given (no value is read between points). */
export function pointAt(curve: RetentionPoint[], durationSec: number | null, sec: number): { point: RetentionPoint | null; note: string | null } {
  if (!curve.length) return { point: null, note: NO_CURVE };
  if (!durationSec) return { point: null, note: NO_LENGTH };
  if (durationSec <= sec) return { point: null, note: TOO_SHORT };
  const point = curve.find((p) => p.elapsedRatio * durationSec >= sec) ?? null;
  return point ? { point, note: null } : { point: null, note: NO_CURVE };
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
  const at = pointAt(curve, dur, 30);
  return {
    videoId, title: v.title, durationSec: dur, range, period: { start: p.start, end: p.end }, curve,
    at30s: at.point, at30sNote: at.note,
    note: curve.length ? null : NO_CURVE,
    fetchedAt: new Date(deps.now()).toISOString(),
  };
}

// ---- Audience: countries, devices, age and gender ----

const DEVICE_LABELS: Record<string, string> = { DESKTOP: 'Computer', MOBILE: 'Mobile phone', TABLET: 'Tablet', TV: 'TV', GAME_CONSOLE: 'Game console', UNKNOWN_PLATFORM: 'Unknown' };
const AGE_LABELS: Record<string, string> = { 'age13-17': '13–17', 'age18-24': '18–24', 'age25-34': '25–34', 'age35-44': '35–44', 'age45-54': '45–54', 'age55-64': '55–64', 'age65-': '65+' };
/** What no YouTube API gives any app; said on the page and to AI apps so nobody guesses it. */
export const NOT_AVAILABLE = ['Unique viewers', 'New vs returning viewers'];
const countryName = (code: string) => {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code; } catch { return code; }
};
const askedWhy = (r: GoogleError) => `YouTube didn't answer: ${'reason' in r ? r.reason : r.kind}`;
const NO_DEMO = "YouTube shows age and gender only for signed-in viewers and only once enough of them watched; it doesn't publish the threshold.";

export async function loadAudience(deps: Deps, a: ChannelAccess, range: RangeKey): Promise<Audience | GoogleError> {
  const d = await dailyFor(deps, a, range);
  if (isErr(d)) return d;
  const p = d.coverage.period;
  const q = (x: Partial<ReportQuery>) => deps.youtube.report(a.accessToken, { startDate: p.start, endDate: p.end, metrics: ['views', 'estimatedMinutesWatched'], ...x });
  const [countries, devices, demo] = await Promise.all([
    q({ dimensions: ['country'], sort: '-views', maxResults: 10 }),
    q({ dimensions: ['deviceType'], sort: '-views' }),
    q({ dimensions: ['ageGroup', 'gender'], metrics: ['viewerPercentage'], sort: 'ageGroup' }),
  ]);
  for (const r of [countries, devices, demo]) if (isErr(r) && r.kind === 'revoked') return r;
  const slices = (r: Report, key: string, label: (k: string) => string): Slice[] =>
    rowsBy(r, key).map(({ key: k, o }) => ({ key: k, label: label(k), views: Number(o.views), watchMinutes: Number(o.estimatedMinutesWatched) })).filter((x) => Number.isFinite(x.views));
  // One row per age group, YouTube's viewerPercentage per gender as given.
  const ageGender = new Map<string, { ageGroup: string; female: number; male: number; other: number }>();
  if (!isErr(demo)) {
    for (const { o } of rowsBy(demo, 'ageGroup')) {
      const pct = Number(o.viewerPercentage);
      if (!Number.isFinite(pct)) continue;
      const age = AGE_LABELS[String(o.ageGroup)] ?? String(o.ageGroup);
      const row = ageGender.get(age) ?? { ageGroup: age, female: 0, male: 0, other: 0 };
      if (o.gender === 'female') row.female = pct;
      else if (o.gender === 'male') row.male = pct;
      else row.other = pct;
      ageGender.set(age, row);
    }
  }
  return {
    range, coverage: d.coverage,
    countries: isErr(countries) ? [] : slices(countries, 'country', countryName),
    countriesNote: isErr(countries) ? askedWhy(countries) : countries.rows.length ? null : 'YouTube returned no countries for these dates',
    devices: isErr(devices) ? [] : slices(devices, 'deviceType', (k) => DEVICE_LABELS[k] ?? k),
    devicesNote: isErr(devices) ? askedWhy(devices) : devices.rows.length ? null : 'YouTube returned no devices for these dates',
    ageGender: [...ageGender.values()],
    ageGenderNote: isErr(demo) ? askedWhy(demo) : ageGender.size ? null : NO_DEMO,
    notAvailable: NOT_AVAILABLE,
    fetchedAt: new Date(deps.now()).toISOString(),
  };
}

// ---- Video check-up: one video's YouTube values, next to the channel's where YouTube gives the same measure ----

const NOT_LISTED = 'This video is not among your newest 200 uploads';

export async function loadCheckup(deps: Deps, a: ChannelAccess, videoId: string, range: RangeKey): Promise<VideoCheckup | { missing: true } | GoogleError> {
  const v = await deps.youtube.video(a.accessToken, videoId);
  if (isErr(v)) return v;
  if (!v || v.channelId !== a.channel.channel_id) return { missing: true };
  const day = today(deps);
  const [vids, ov, ret] = await Promise.all([
    cached(deps, a.channel.id, `videos:${range}:${day}`, REPORT_TTL_MS, () => loadVideos(deps, a, range)),
    cached<Overview>(deps, a.channel.id, `overview:${range}:${day}`, REPORT_TTL_MS, () => loadOverview(deps, a, range)),
    cached(deps, a.channel.id, `retention:${videoId}:${range}:${day}`, REPORT_TTL_MS, () => loadRetention(deps, a, videoId, range)),
  ]);
  if (isErr(vids)) return vids;
  if (isErr(ov)) return ov;
  if (isErr(ret)) return ret;
  const p = vids.coverage.period;
  const src = await sources(deps, a, p.start, p.end, videoId);
  if (isErr(src)) return src;
  const row = vids.videos.find((x) => x.videoId === videoId);
  const get = (m: Measured<number> | undefined): Measured<number> => m ?? noData(NOT_LISTED);
  const reach = await reachByVideo(deps, a.channel.id, p.start, p.end, videoId);
  const rm = reachMeasures(reach, videoId);
  const es = await endScreens(deps, a.channel.id, p.start, p.end, videoId);
  const retention = 'missing' in ret ? null : ret;
  const at = retention?.at30s ?? null;
  const atWhy = retention?.at30sNote ?? NO_CURVE;
  const at30Label = at?.elapsedSec != null ? `Still watching at ${Math.floor(at.elapsedSec / 60)}:${String(at.elapsedSec % 60).padStart(2, '0')}` : 'Still watching at 0:30';
  const latestDay = rm.latestCtr.kind === 'value' ? String(rm.latestCtr.inputs.day) : null;

  const parts: CheckupPart[] = [
    { area: 'Reach', guide: 'How often YouTube showed this thumbnail. Few impressions means YouTube is showing the video to few people: compare with your other videos in the Thumbnails tab.',
      values: [{ label: 'Thumbnail impressions', video: rm.impressions, channel: null, unit: 'count' }, { label: 'Views', video: get(row?.views), channel: null, unit: 'count' }] },
    { area: 'Thumbnail & title', guide: 'Of the people who saw the thumbnail, how many clicked. If it is low next to your other videos, try a clearer thumbnail or title. The daily chart shows how it changed.',
      values: [{ label: latestDay ? `Click-through rate on ${latestDay}` : 'Click-through rate (latest day)', video: rm.latestCtr, channel: null, unit: 'fraction' }] },
    { area: 'Opening', guide: "YouTube's score compares this point with videos of similar length: 0.5 is typical, higher holds viewers better. If many leave early, check that the first seconds deliver what the title promises.",
      values: [
        { label: at30Label, video: at ? yt(at.audienceWatchRatio, { metric: 'audienceWatchRatio', elapsedRatio: at.elapsedRatio }) : noData(atWhy), channel: null, unit: 'fraction' },
        { label: "YouTube's score vs similar videos", video: at ? at.relativeRetentionPerformance : noData(atWhy), channel: null, unit: 'score' },
      ] },
    { area: 'Watching', guide: 'How much of the video people watch, next to your whole channel in the same dates. The retention chart below shows where they stop.',
      values: [
        { label: 'Average share watched', video: get(row?.averageViewPercentage), channel: ov.totals.averageViewPercentage?.current ?? noData(NOT_LISTED), unit: 'percent' },
        { label: 'Average view duration', video: get(row?.averageViewDuration), channel: ov.totals.averageViewDuration.current, unit: 'seconds' },
      ] },
    { area: 'Subscribers', guide: 'Subscribers this video brought in and lost in these dates. Ask viewers to subscribe when the video has just delivered on its promise.',
      values: [{ label: 'Subscribers gained', video: get(row?.subscribersGained), channel: null, unit: 'count' }, { label: 'Subscribers lost', video: get(row?.subscribersLost), channel: null, unit: 'count' }] },
    { area: 'Next video', guide: 'End screen elements shown and clicked. Few clicks? Point to one clearly related video and say why to watch it next.',
      values: [{ label: 'End screen impressions', video: es.impressions, channel: null, unit: 'count' }, { label: 'End screen clicks', video: es.clicks, channel: null, unit: 'count' }] },
  ];
  return {
    video: { videoId, title: v.title, publishedAt: v.publishedAt, durationSec: v.durationSec, thumbnailUrl: row?.thumbnailUrl ?? null },
    range, period: { start: p.start, end: p.end },
    views: get(row?.views),
    parts,
    retention,
    ctrByDay: reach.byVideo.get(videoId)?.byDay ?? [],
    sources: sourceList(src, null),
    fetchedAt: new Date(deps.now()).toISOString(),
  };
}

const THUMBS_TTL_MS = 3_600_000;
const videoIdCheck = (c: Context) => (VIDEO_ID.test(c.req.param('videoId') ?? '') ? null : c.json({ error: 'bad_request', message: 'That is not a YouTube video id.' }, 400));
const notThis = <T extends object>(b: T | { missing: true }, c: Context) => ('missing' in b ? c.json({ error: 'not_found', message: 'Video not found on this channel.' }, 404) : b);

export function insightRoutes(app: Hono, deps: Deps): void {
  app.get('/api/channels/:id/traffic', serve(deps, (r) => `traffic:${r}:${today(deps)}`, loadTrafficSources));
  app.get('/api/channels/:id/audience', serve(deps, (r) => `audience:${r}:${today(deps)}`, loadAudience));
  app.get('/api/channels/:id/thumbnails', serve(deps, (r) => `thumbs:${r}:${today(deps)}`, loadThumbnails, THUMBS_TTL_MS));
  app.get('/api/channels/:id/retention/:videoId', serve<VideoRetention | { missing: true }>(deps, (r, c) => `retention:${c.req.param('videoId')}:${r}:${today(deps)}`,
    (d, a, r, c) => loadRetention(d, a, c.req.param('videoId')!, r), REPORT_TTL_MS, videoIdCheck, notThis));
  app.get('/api/channels/:id/checkup/:videoId', serve<VideoCheckup | { missing: true }>(deps, (r, c) => `checkup:${c.req.param('videoId')}:${r}:${today(deps)}`,
    (d, a, r, c) => loadCheckup(d, a, c.req.param('videoId')!, r), REPORT_TTL_MS, videoIdCheck, notThis));
}
