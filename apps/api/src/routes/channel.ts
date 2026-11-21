import { type Measured, type Overview, type Pair, type RangeKey, type VideoRow, type Videos, noData, parseRange, periodFor, value } from '@viewproof/core';
import type { ChannelRow } from '@viewproof/db';
import type { Context, Hono } from 'hono';
import type { Deps } from '../app';
import { type ChannelAccess, REVOKED_REASON, accessFor, cached, ownedChannel } from '../channel-data';
import type { GoogleError } from '../google';
import { readSession } from '../session';
import type { Report, ReportQuery } from '../youtube';

export const REPORT_TTL_MS = 6 * 3_600_000;
const SOURCE = 'YouTube Analytics';
export const NO_ROWS = 'YouTube returned no data for these dates';
const NO_VIDEO_ROW = "YouTube reported no row for this video in these dates (no views, or below YouTube's reporting threshold)";

type Json = (c: Context, body: unknown, status: number) => Response;
const json: Json = (c, body, status) => c.json(body as object, status as 200);

export const today = (deps: Deps) => new Date(deps.now()).toISOString().slice(0, 10);
export const yt = (n: number, inputs: Record<string, string | number> = {}): Measured<number> => value(n, SOURCE, inputs);

/** Error from Google while serving a channel endpoint → JSON response (revoked also marks the channel). */
export async function googleFailure(c: Context, deps: Deps, ch: ChannelRow, e: GoogleError): Promise<Response> {
  if (e.kind === 'revoked') {
    await deps.db.prepare("UPDATE channels SET status = 'reconnect', status_reason = ? WHERE id = ?").bind(REVOKED_REASON, ch.id).run();
    return json(c, { error: 'reconnect', message: REVOKED_REASON }, 409);
  }
  return json(c, { error: 'google_failed', message: e.reason }, 502);
}

/** Session → own channel → fresh access, or the JSON error for whichever step failed. */
export async function channelAccess(c: Context, deps: Deps): Promise<ChannelAccess | Response> {
  const s = await readSession(c, deps);
  if (!s) return json(c, { error: 'signed_out', message: 'Sign in first.' }, 401);
  const ch = await ownedChannel(deps, s.userId, c.req.param('id') ?? '');
  if (!ch) return json(c, { error: 'not_found', message: 'Channel not found.' }, 404);
  const a = await accessFor(deps, ch);
  if ('error' in a) return json(c, a, a.error === 'google_failed' ? 502 : 409);
  return a;
}

export const isErr = (x: unknown): x is GoogleError => !!x && typeof x === 'object' && 'kind' in x;

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

async function loadOverview(deps: Deps, a: ChannelAccess, range: RangeKey): Promise<Overview | GoogleError> {
  const p = periodFor(range, today(deps));
  const q = (o: Omit<ReportQuery, 'startDate' | 'endDate'>, start: string, end: string) => deps.youtube.report(a.accessToken, { startDate: start, endDate: end, ...o });
  const [cur, prev, daily] = await Promise.all([
    q({ metrics: TOTAL_METRICS }, p.start, p.end),
    q({ metrics: TOTAL_METRICS }, p.prevStart, p.prevEnd),
    q({ metrics: ['views'], dimensions: ['day'], sort: 'day' }, p.start, p.end),
  ]);
  for (const r of [cur, prev, daily]) if (isErr(r)) return r;
  const c = firstRow(cur as Report);
  const pr = firstRow(prev as Report);
  const d = daily as Report;
  const di = d.columns.indexOf('day');
  const vi = d.columns.indexOf('views');
  const days = d.rows.map((r) => ({ date: String(r[di]), views: Number(r[vi]) }));
  return {
    channelId: a.channel.channel_id,
    range,
    period: p,
    dataThrough: days.at(-1)?.date ?? null,
    totals: {
      views: pair(c, pr, 'views'),
      watchMinutes: pair(c, pr, 'estimatedMinutesWatched'),
      averageViewDuration: pair(c, pr, 'averageViewDuration'),
      subscribersGained: pair(c, pr, 'subscribersGained'),
      subscribersLost: pair(c, pr, 'subscribersLost'),
    },
    daily: days,
    fetchedAt: new Date(deps.now()).toISOString(),
  };
}

/** Uploads (newest first, ≤ 200), cached like reports. */
export function uploadsOf(deps: Deps, a: ChannelAccess) {
  return cached(deps, a.channel.id, `uploads:${today(deps)}`, REPORT_TTL_MS, () => deps.youtube.uploads(a.accessToken, 200));
}

async function loadVideos(deps: Deps, a: ChannelAccess, range: RangeKey): Promise<Videos | GoogleError> {
  const p = periodFor(range, today(deps));
  const [ups, rep] = await Promise.all([
    uploadsOf(deps, a),
    deps.youtube.report(a.accessToken, { startDate: p.start, endDate: p.end, metrics: ['views', 'estimatedMinutesWatched', 'averageViewDuration'], dimensions: ['video'], sort: '-views', maxResults: 200 }),
  ]);
  if (isErr(ups)) return ups;
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
  return { range, dataThrough: null, videos, fetchedAt: new Date(deps.now()).toISOString() };
}

/** GET handler: access → cached load → JSON, with Google errors mapped. */
export function serve<T>(deps: Deps, key: (range: RangeKey, c: Context) => string, load: (deps: Deps, a: ChannelAccess, range: RangeKey, c: Context) => Promise<T | GoogleError>, ttl = REPORT_TTL_MS) {
  return async (c: Context) => {
    const a = await channelAccess(c, deps);
    if (a instanceof Response) return a;
    const range = parseRange(c.req.query('range'));
    const r = await cached(deps, a.channel.id, key(range, c), ttl, () => load(deps, a, range, c));
    if (isErr(r)) return googleFailure(c, deps, a.channel, r);
    return c.json(r as object);
  };
}

export function channelRoutes(app: Hono, deps: Deps): void {
  app.get('/api/channels/:id/overview', serve(deps, (r) => `overview:${r}:${today(deps)}`, loadOverview));
  app.get('/api/channels/:id/videos', serve(deps, (r) => `videos:${r}:${today(deps)}`, loadVideos));
}
