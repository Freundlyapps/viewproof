import { type Coverage, type Earnings, type Measured, type Overview, type SearchTerm, type SearchTerms, type UploadTimes, type Pair, type RangeKey, type VideoRow, type Videos, type YourTerms, containsKeyword, coverage, noData, parseRange, periodFor, todayPacific, value } from '@viewproof/core';
import type { ChannelRow } from '@viewproof/db';
import type { Context, Hono } from 'hono';
import type { Deps } from '../app';
import { type AccessError, type ChannelAccess, REVOKED_REASON, type Ttl, accessFor, cached, markActive, ownedChannel, peek } from '../channel-data';
import { type GoogleError, SCOPES } from '../google';
import { readSession } from '../session';
import type { Report, ReportQuery } from '../youtube';
import { BAD_KEYWORD, keywordParam } from './keywords';

export const REPORT_TTL_MS = 6 * 3_600_000;
const SOURCE = 'YouTube Analytics';
export const NO_ROWS = 'YouTube returned no data for these dates';
const NO_VIDEO_ROW = "YouTube reported no row for this video in these dates (no views, or below YouTube's reporting threshold)";

type Json = (c: Context, body: unknown, status: number) => Response;
const json: Json = (c, body, status) => c.json(body as object, status as 200);

/** Today in YouTube Analytics' time zone (Pacific). */
export const today = (deps: Deps) => todayPacific(deps.now());
export const yt = (n: number, inputs: Record<string, string | number> = {}): Measured<number> => value(n, SOURCE, inputs);

/** Error from Google while serving a channel endpoint → JSON response (revoked also marks the channel). */
export async function googleFailure(c: Context, deps: Deps, ch: ChannelRow, e: GoogleError): Promise<Response> {
  if (e.kind === 'revoked') {
    await deps.db.prepare("UPDATE channels SET status = 'reconnect', status_reason = ? WHERE id = ?").bind(REVOKED_REASON, ch.id).run();
    return json(c, { error: 'reconnect', message: REVOKED_REASON }, 409);
  }
  return json(c, { error: 'google_failed', message: e.reason }, 502);
}

/** Session → the signed-in user's channel, or the JSON error. */
async function channelOf(c: Context, deps: Deps): Promise<ChannelRow | Response> {
  const s = await readSession(c, deps);
  if (!s) return json(c, { error: 'signed_out', message: 'Sign in first.' }, 401);
  const ch = await ownedChannel(deps, s.userId, c.req.param('id') ?? '');
  return ch ?? json(c, { error: 'not_found', message: 'Channel not found.' }, 404);
}
const accessError = (c: Context, a: AccessError) => json(c, a, a.error === 'google_failed' ? 502 : 409);

const ERROR_KINDS = ['revoked', 'failed', 'forbidden'];
/** A Google error (Measured values also have `kind`, so check the value). */
export const isErr = (x: unknown): x is GoogleError => !!x && typeof x === 'object' && ERROR_KINDS.includes((x as { kind?: string }).kind ?? '');

/** Column value of the first row, or null when YouTube returned no row. */
export function firstRow(r: Report): Record<string, number> | null {
  const row = r.rows[0];
  if (!row) return null;
  return Object.fromEntries(r.columns.map((c, i) => [c, Number(row[i])]));
}

const TOTAL_METRICS = ['views', 'estimatedMinutesWatched', 'averageViewDuration', 'subscribersGained', 'subscribersLost'];

export function pair(cur: Record<string, number> | null, prev: Record<string, number> | null, metric: string, why = NO_ROWS): Pair {
  const m = (r: Record<string, number> | null): Measured<number> =>
    r && Number.isFinite(r[metric]) ? yt(r[metric]!, { metric }) : noData(why);
  return { current: m(cur), previous: m(prev) };
}

/** Views per day for the range, and which days YouTube has filled (cached; every tab uses it). */
async function dailyFor(deps: Deps, a: ChannelAccess, range: RangeKey): Promise<{ daily: { date: string; views: number }[]; coverage: Coverage } | GoogleError> {
  return cached(deps, a.channel.id, `daily:${range}:${today(deps)}`, REPORT_TTL_MS, async () => {
    const p = periodFor(range, today(deps));
    const d = await deps.youtube.report(a.accessToken, { startDate: p.start, endDate: p.end, metrics: ['views'], dimensions: ['day'], sort: 'day' });
    if (isErr(d)) return d;
    const di = d.columns.indexOf('day');
    const vi = d.columns.indexOf('views');
    const daily = di < 0 || vi < 0 ? [] : d.rows.map((r) => ({ date: String(r[di]), views: Number(r[vi]) })).filter((x) => Number.isFinite(x.views));
    return { daily, coverage: coverage(range, today(deps), daily.at(-1)?.date ?? null) };
  });
}

async function loadOverview(deps: Deps, a: ChannelAccess, range: RangeKey): Promise<Overview | GoogleError> {
  const d = await dailyFor(deps, a, range);
  if (isErr(d)) return d;
  const p = d.coverage.period;
  const q = (start: string, end: string) => deps.youtube.report(a.accessToken, { startDate: start, endDate: end, metrics: TOTAL_METRICS });
  const [cur, prev] = await Promise.all([q(p.start, p.end), q(p.prevStart, p.prevEnd)]);
  if (isErr(cur)) return cur;
  if (isErr(prev)) return prev;
  const c = firstRow(cur);
  const pr = firstRow(prev);
  return {
    channelId: a.channel.channel_id,
    range,
    period: p,
    dataThrough: d.coverage.dataThrough,
    totals: {
      views: pair(c, pr, 'views'),
      watchMinutes: pair(c, pr, 'estimatedMinutesWatched'),
      averageViewDuration: pair(c, pr, 'averageViewDuration'),
      subscribersGained: pair(c, pr, 'subscribersGained'),
      subscribersLost: pair(c, pr, 'subscribersLost'),
    },
    daily: d.daily,
    coverage: d.coverage,
    fetchedAt: new Date(deps.now()).toISOString(),
  };
}

/** Uploads (newest first, ≤ 200), cached like reports. */
export function uploadsOf(deps: Deps, a: ChannelAccess) {
  return cached(deps, a.channel.id, `uploads:${today(deps)}`, REPORT_TTL_MS, () => deps.youtube.uploads(a.accessToken, 200));
}

async function loadVideos(deps: Deps, a: ChannelAccess, range: RangeKey): Promise<Videos | GoogleError> {
  const [ups, d] = await Promise.all([uploadsOf(deps, a), dailyFor(deps, a, range)]);
  if (isErr(ups)) return ups;
  if (isErr(d)) return d;
  const p = d.coverage.period;
  // Ask about exactly the uploads shown (YouTube accepts a list of video ids), not its top videos overall.
  const rep = ups.length === 0 ? { columns: [], rows: [] } : await deps.youtube.report(a.accessToken, {
    startDate: p.start, endDate: p.end, metrics: ['views', 'estimatedMinutesWatched', 'averageViewDuration'], dimensions: ['video'],
    filters: `video==${ups.map((u) => u.videoId).join(',')}`, sort: '-views', maxResults: 200,
  });
  if (isErr(rep)) return rep;
  const byVideo = new Map(rep.rows.map((r) => [String(r[rep.columns.indexOf('video')]), r]));
  const col = (r: (string | number)[] | undefined, name: string): Measured<number> => {
    const i = rep.columns.indexOf(name);
    return r && i >= 0 && Number.isFinite(Number(r[i])) ? yt(Number(r[i]), { metric: name }) : noData(NO_VIDEO_ROW);
  };
  const videos: VideoRow[] = ups.map((u) => {
    const r = byVideo.get(u.videoId);
    return {
      videoId: u.videoId, title: u.title, publishedAt: u.publishedAt, durationSec: u.durationSec, thumbnailUrl: u.thumbnailUrl,
      lifetimeViews: u.views === null ? noData('View count hidden') : value(u.views, 'YouTube Data API', { metric: 'viewCount' }),
      views: col(r, 'views'), watchMinutes: col(r, 'estimatedMinutesWatched'), averageViewDuration: col(r, 'averageViewDuration'),
    };
  });
  return { range, dataThrough: d.coverage.dataThrough, coverage: d.coverage, videos, fetchedAt: new Date(deps.now()).toISOString() };
}

/**
 * GET handler: channel → cached answer (no Google call) → else fresh access → load → JSON, with Google errors mapped.
 * Cached answers are only served for channels in good standing, so a broken connection still shows.
 */
export function serve<T>(
  deps: Deps, key: (range: RangeKey, c: Context) => string, load: (deps: Deps, a: ChannelAccess, range: RangeKey, c: Context) => Promise<T | GoogleError>,
  ttl: Ttl<T> = REPORT_TTL_MS, before?: (c: Context, ch: ChannelRow) => Response | null,
  /** Shape the (cached) body for this request, e.g. filter it. */
  shape: (body: T, c: Context) => unknown = (b) => b,
) {
  return async (c: Context) => {
    const ch = await channelOf(c, deps);
    if (ch instanceof Response) return ch;
    const range = parseRange(c.req.query('range'));
    const k = key(range, c);
    if (ch.status === 'active') {
      const early = before?.(c, ch);
      if (early) return early;
      const hit = await peek(deps, ch.id, k, ttl);
      if (hit !== undefined) return c.json(shape(hit, c) as object);
    }
    const a = await accessFor(deps, ch);
    if ('error' in a) return accessError(c, a);
    const early = before?.(c, ch);
    if (early) return early;
    const r = await cached(deps, ch.id, k, ttl, () => load(deps, a, range, c));
    if (isErr(r)) return googleFailure(c, deps, ch, r);
    if (ch.status === 'reconnect') await markActive(deps, ch);
    return c.json(shape(r as T, c) as object);
  };
}

const YT_SEARCH = 'insightTrafficSourceType==YT_SEARCH';
const NOT_IN_PREV = "Not in YouTube's top 25 for the previous period";
const NO_TERMS = "YouTube lists search terms only once enough people searched; it doesn't publish the threshold.";
const FIRST_WEEK_TTL_MS = 30 * 86_400_000;
const NOT_AVAILABLE_TTL_MS = 30 * 60_000;
const DAY_MS = 86_400_000;

const terms = (deps: Deps, a: ChannelAccess, start: string, end: string, video?: string) =>
  deps.youtube.report(a.accessToken, {
    startDate: start, endDate: end, metrics: ['views', 'estimatedMinutesWatched'], dimensions: ['insightTrafficSourceDetail'],
    filters: video ? `${YT_SEARCH};video==${video}` : YT_SEARCH, sort: '-views', maxResults: 25,
  });
const rowsBy = (r: Report, key: string) => r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]])) as Record<string, string | number>).map((o) => ({ key: String(o[key]), o }));

async function titles(deps: Deps, a: ChannelAccess): Promise<Map<string, string>> {
  const ups = await uploadsOf(deps, a);
  return new Map(isErr(ups) ? [] : ups.map((u) => [u.videoId, u.title]));
}

async function loadSearchTerms(deps: Deps, a: ChannelAccess, range: RangeKey): Promise<SearchTerms | GoogleError> {
  const d = await dailyFor(deps, a, range);
  if (isErr(d)) return d;
  const p = d.coverage.period;
  const [cur, prev, top] = await Promise.all([
    terms(deps, a, p.start, p.end),
    terms(deps, a, p.prevStart, p.prevEnd),
    deps.youtube.report(a.accessToken, { startDate: p.start, endDate: p.end, metrics: ['views'], dimensions: ['video'], sort: '-views', maxResults: 10 }),
  ]);
  if (isErr(cur)) return cur;
  if (isErr(prev)) return prev;
  if (isErr(top)) return top;
  const prevViews = new Map(rowsBy(prev, 'insightTrafficSourceDetail').map(({ key, o }) => [key, Number(o.views)]));
  // For each term, which of the period's top videos got the most views from it.
  const best = new Map<string, { videoId: string; views: number }>();
  const topIds = rowsBy(top, 'video').map((x) => x.key);
  const perVideo = await Promise.all(topIds.map((id) => terms(deps, a, p.start, p.end, id)));
  for (const [i, r] of perVideo.entries()) {
    if (isErr(r)) return r;
    for (const { key, o } of rowsBy(r, 'insightTrafficSourceDetail')) {
      const v = Number(o.views);
      if (!best.has(key) || best.get(key)!.views < v) best.set(key, { videoId: topIds[i]!, views: v });
    }
  }
  const names = best.size ? await titles(deps, a) : new Map<string, string>();
  const list: SearchTerm[] = rowsBy(cur, 'insightTrafficSourceDetail').map(({ key, o }) => {
    const b = best.get(key);
    const pv = prevViews.get(key);
    return {
      term: key, views: Number(o.views), watchMinutes: Number(o.estimatedMinutesWatched),
      previousViews: pv === undefined ? noData(NOT_IN_PREV) : yt(pv, { metric: 'views', period: 'previous' }),
      topVideo: b ? { videoId: b.videoId, title: names.get(b.videoId) ?? b.videoId } : null,
    };
  });
  return { range, coverage: d.coverage, terms: list, note: list.length ? null : NO_TERMS, fetchedAt: new Date(deps.now()).toISOString() };
}

const REVENUE_METRICS = ['estimatedRevenue', 'playbackBasedCpm', 'monetizedPlaybacks'];

async function loadEarnings(deps: Deps, a: ChannelAccess, range: RangeKey): Promise<Earnings | GoogleError> {
  const d = await dailyFor(deps, a, range);
  if (isErr(d)) return d;
  const p = d.coverage.period;
  const [cur, prev, top] = await Promise.all([
    deps.youtube.report(a.accessToken, { startDate: p.start, endDate: p.end, metrics: REVENUE_METRICS }),
    deps.youtube.report(a.accessToken, { startDate: p.prevStart, endDate: p.prevEnd, metrics: REVENUE_METRICS }),
    deps.youtube.report(a.accessToken, { startDate: p.start, endDate: p.end, metrics: ['estimatedRevenue', 'playbackBasedCpm'], dimensions: ['video'], sort: '-estimatedRevenue', maxResults: 10 }),
  ]);
  for (const r of [cur, prev, top]) {
    if (isErr(r) && r.kind === 'forbidden') return { status: 'not_available', reason: r.reason };
    if (isErr(r)) return r;
  }
  const c = firstRow(cur as Report);
  const pr = firstRow(prev as Report);
  const names = await titles(deps, a);
  return {
    status: 'ok',
    range,
    coverage: d.coverage,
    totals: { estimatedRevenue: pair(c, pr, 'estimatedRevenue'), playbackBasedCpm: pair(c, pr, 'playbackBasedCpm'), monetizedPlaybacks: pair(c, pr, 'monetizedPlaybacks') },
    topVideos: rowsBy(top as Report, 'video').map(({ key, o }) => ({
      videoId: key, title: names.get(key) ?? key, estimatedRevenue: Number(o.estimatedRevenue),
      playbackBasedCpm: Number.isFinite(Number(o.playbackBasedCpm)) ? yt(Number(o.playbackBasedCpm), { metric: 'playbackBasedCpm' }) : noData(NO_ROWS),
    })),
    fetchedAt: new Date(deps.now()).toISOString(),
  };
}

async function loadUploadTimes(deps: Deps, a: ChannelAccess): Promise<UploadTimes | GoogleError> {
  const ups = await uploadsOf(deps, a);
  if (isErr(ups)) return ups;
  const ripe = ups.filter((u) => deps.now() - Date.parse(u.publishedAt) >= 10 * DAY_MS).slice(0, 20);
  const out: UploadTimes['uploads'] = [];
  for (const u of ripe) {
    // YouTube's days are Pacific, so the first week starts on the Pacific date of publishing.
    const start = todayPacific(Date.parse(u.publishedAt));
    const end = new Date(Date.parse(`${start}T00:00:00Z`) + 6 * DAY_MS).toISOString().slice(0, 10);
    // A real count is final; "no views yet" may just be YouTube's delay, so ask again after 6 hours.
    const ttl = (m: Measured<number>) => (m.kind === 'value' ? FIRST_WEEK_TTL_MS : REPORT_TTL_MS);
    const fw = await cached(deps, a.channel.id, `fw:${u.videoId}`, ttl, async (): Promise<Measured<number> | GoogleError> => {
      const r = await deps.youtube.report(a.accessToken, { startDate: start, endDate: end, metrics: ['views'], filters: `video==${u.videoId}` });
      if (isErr(r)) return r;
      const row = firstRow(r);
      return row && Number.isFinite(row.views) ? yt(row.views!, { metric: 'views', start, end }) : noData('YouTube reported no views for its first week');
    });
    if (isErr(fw)) return fw;
    out.push({ videoId: u.videoId, title: u.title, publishedAt: u.publishedAt, firstWeekViews: fw });
  }
  return { uploads: out, fetchedAt: new Date(deps.now()).toISOString() };
}

const NO_MATCH = "None of your channel's top 25 search terms (last 90 days) contains this keyword.";
function matchingTerms(t: SearchTerms, keyword: string, deps: Deps): YourTerms {
  const terms = t.terms.filter((x) => containsKeyword(x.term, keyword));
  return { keyword, coverage: t.coverage, terms, note: terms.length ? null : t.note ?? NO_MATCH, fetchedAt: new Date(deps.now()).toISOString() };
}

export function channelRoutes(app: Hono, deps: Deps): void {
  app.get('/api/channels/:id/search-terms', serve(deps, (r) => `terms:${r}:${today(deps)}`, loadSearchTerms));
  app.get('/api/channels/:id/upload-times', serve(deps, () => `upload-times:${today(deps)}`, (d, a) => loadUploadTimes(d, a)));
  app.get('/api/channels/:id/earnings', serve(deps, (r) => `earnings:${r}:${today(deps)}`, loadEarnings,
    (e) => (e.status === 'not_available' ? NOT_AVAILABLE_TTL_MS : REPORT_TTL_MS), (c, ch) =>
    ch.scopes.split(' ').includes(SCOPES.revenue) ? null : c.json({ status: 'not_granted' } satisfies Earnings)));
  app.get('/api/channels/:id/overview', serve(deps, (r) => `overview:${r}:${today(deps)}`, loadOverview));
  // The creator's real search terms containing a keyword: the cached 90-day search terms, filtered.
  app.get('/api/channels/:id/keyword-terms', (c) => (keywordParam(c) ? keywordTerms(c) : c.json(BAD_KEYWORD, 400)));
  const keywordTerms = serve(deps, () => `terms:90d:${today(deps)}`, (d, a) => loadSearchTerms(d, a, '90d'), REPORT_TTL_MS, undefined, (t, c) => matchingTerms(t, keywordParam(c)!, deps));
  app.get('/api/channels/:id/videos', serve(deps, (r) => `videos:${r}:${today(deps)}`, loadVideos));
}
