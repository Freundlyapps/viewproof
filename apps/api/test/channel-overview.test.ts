import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import type { Overview, Videos } from '@viewproof/core';
import type { ChannelRow } from '@viewproof/db';
import { createApp } from '../src/app';
import type { ReportQuery, YouTubeClient } from '../src/youtube';
import { fakeGoogle } from './fake-google';
import { fakeYouTube } from './fake-youtube';
import { channelFixture, makeDeps, post, signIn } from './helpers';

const NOW = Date.parse('2026-11-21T12:00:00Z');
const TOTALS = ['views', 'estimatedMinutesWatched', 'averageViewDuration', 'subscribersGained', 'subscribersLost'];

async function connected(sub: string, channelId: string) {
  const s = await signIn({ sub, channel: channelFixture({ channelId }) });
  await post(s.app, '/connect/confirm', s.cookie, { id: s.pendingId });
  const row = (await env.DB.prepare('SELECT * FROM channels WHERE channel_id = ?').bind(channelId).first<ChannelRow>())!;
  return { cookie: s.cookie, row };
}
function appWith(yt: Partial<YouTubeClient>) {
  const youtube = fakeYouTube(yt);
  const google = fakeGoogle({ refresh: async () => ({ accessToken: 'at' }) });
  return { app: createApp(makeDeps({ youtube, google, now: () => NOW })), youtube };
}
const get = (app: ReturnType<typeof createApp>, path: string, cookie?: string) => app.request(path, { headers: cookie ? { cookie } : {} });

const fullReport = async (_t: string, q: ReportQuery) => {
  if (q.dimensions?.[0] === 'day') return { columns: ['day', 'views'], rows: [['2026-11-15', 10], ['2026-11-16', 20], ['2026-11-18', 5]] };
  if (q.startDate === '2026-11-15') return { columns: TOTALS, rows: [[35, 120, 205, 3, 1]] };
  return { columns: TOTALS, rows: [[50, 200, 240, 4, 0]] };
};
const SAME_LENGTH = 'compares only the days YouTube has filled, against the same number of days before';

describe('overview', () => {
  test('signed out is 401', async () => {
    const res = await get(appWith({}).app, '/api/channels/x/overview');
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'signed_out' });
  });

  test("other user's channel is 404", async () => {
    const a = await connected('co-a', 'UCcoa');
    const b = await connected('co-b', 'UCcob');
    const res = await get(appWith({}).app, `/api/channels/${a.row.id}/overview`, b.cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'not_found' });
  });

  test('totals, previous period and daily views from YouTube', async () => {
    const { cookie, row } = await connected('co-full', 'UCcofull');
    const { app, youtube } = appWith({ report: fullReport });
    const o = (await (await get(app, `/api/channels/${row.id}/overview?range=7d`, cookie)).json()) as Overview;
    expect(o.range).toBe('7d');
    // YouTube has data through the 18th: 4 days against the 4 days before (${SAME_LENGTH}).
    expect(o.period).toEqual({ start: '2026-11-15', end: '2026-11-18', prevStart: '2026-11-11', prevEnd: '2026-11-14' });
    expect(o.coverage).toEqual({ period: o.period, dataThrough: '2026-11-18', days: 4, rangeDays: 7 });
    expect(o.totals.views.current).toMatchObject({ kind: 'value', value: 35 });
    expect(o.totals.views.previous).toMatchObject({ kind: 'value', value: 50 });
    expect(o.totals.watchMinutes.current).toMatchObject({ kind: 'value', value: 120 });
    expect(o.totals.averageViewDuration.current).toMatchObject({ kind: 'value', value: 205 });
    expect(o.totals.subscribersGained.current).toMatchObject({ kind: 'value', value: 3 });
    expect(o.totals.subscribersLost.previous).toMatchObject({ kind: 'value', value: 0 });
    expect(o.daily).toEqual([{ date: '2026-11-15', views: 10 }, { date: '2026-11-16', views: 20 }, { date: '2026-11-18', views: 5 }]);
    const qs = youtube.calls.filter((c) => c.method === 'report').map((c) => c.arg as ReportQuery);
    expect(qs.find((q) => q.dimensions?.[0] === 'day')).toMatchObject({ startDate: '2026-11-15', endDate: '2026-11-21', metrics: ['views'], sort: 'day' });
    expect(qs.filter((q) => !q.dimensions).map((q) => [q.startDate, q.endDate, q.metrics.join(',')])).toEqual(
      expect.arrayContaining([['2026-11-15', '2026-11-18', TOTALS.join(',')], ['2026-11-11', '2026-11-14', TOTALS.join(',')]]),
    );
  });

  test('dataThrough is last returned day', async () => {
    const { cookie, row } = await connected('co-thru', 'UCcothru');
    const o = (await (await get(appWith({ report: fullReport }).app, `/api/channels/${row.id}/overview?range=7d`, cookie)).json()) as Overview;
    expect(o.dataThrough).toBe('2026-11-18');
    expect(o.daily.map((d) => d.date)).not.toContain('2026-11-19');
  });

  test('empty channel: every total is no data with a reason, no daily rows', async () => {
    const { cookie, row } = await connected('co-empty', 'UCcoempty');
    const o = (await (await get(appWith({}).app, `/api/channels/${row.id}/overview`, cookie)).json()) as Overview;
    for (const p of Object.values(o.totals)) {
      expect(p.current).toEqual({ kind: 'no_data', reason: 'YouTube returned no data for these dates' });
      expect(p.previous).toEqual({ kind: 'no_data', reason: 'YouTube returned no data for these dates' });
    }
    expect(o.daily).toEqual([]);
    expect(o.dataThrough).toBeNull();
  });

  test('second request within 6 hours makes no Google call', async () => {
    const { cookie, row } = await connected('co-cache', 'UCcocache');
    const first = appWith({ report: fullReport });
    await get(first.app, `/api/channels/${row.id}/overview?range=7d`, cookie);
    const second = appWith({ report: fullReport });
    expect((await get(second.app, `/api/channels/${row.id}/overview?range=7d`, cookie)).status).toBe(200);
    expect(second.youtube.calls).toEqual([]);
  });

  test('gone channel is 409', async () => {
    const { cookie, row } = await connected('co-gone', 'UCcogone');
    await env.DB.prepare("UPDATE channels SET status = 'gone' WHERE id = ?").bind(row.id).run();
    const res = await get(appWith({}).app, `/api/channels/${row.id}/overview`, cookie);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'gone' });
  });

  test('revoked during a report marks reconnect', async () => {
    const { cookie, row } = await connected('co-rev', 'UCcorev');
    const res = await get(appWith({ report: async () => ({ kind: 'revoked' }) }).app, `/api/channels/${row.id}/overview`, cookie);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'reconnect' });
    expect(await env.DB.prepare('SELECT status FROM channels WHERE id = ?').bind(row.id).first()).toEqual({ status: 'reconnect' });
  });

  test('quota or outage is 502 with the reason', async () => {
    const { cookie, row } = await connected('co-quota', 'UCcoquota');
    const res = await get(appWith({ report: async () => ({ kind: 'failed', reason: 'YouTube quota used up for today' }) }).app, `/api/channels/${row.id}/overview`, cookie);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'google_failed', message: 'YouTube quota used up for today' });
  });
});

describe('videos', () => {
  test('uploads with range analytics; a missing row says why', async () => {
    const { cookie, row } = await connected('co-vid', 'UCcovid');
    const { app, youtube } = appWith({
      uploads: async () => [
        { videoId: 'a', title: 'A', publishedAt: '2026-11-10T10:00:00Z', durationSec: 600, views: 900, thumbnailUrl: 'ta' },
        { videoId: 'b', title: 'B', publishedAt: '2026-11-01T10:00:00Z', durationSec: 40, views: null, thumbnailUrl: null },
      ],
      report: async (_t, q) => (q.dimensions?.[0] === 'day'
        ? { columns: ['day', 'views'], rows: [['2026-11-21', 1]] }
        : { columns: ['video', 'views', 'estimatedMinutesWatched', 'averageViewDuration'], rows: [['a', 300, 1500, 300]] }),
    });
    const v = (await (await get(app, `/api/channels/${row.id}/videos?range=28d`, cookie)).json()) as Videos;
    expect(v.videos[0]).toMatchObject({ videoId: 'a', title: 'A', durationSec: 600, thumbnailUrl: 'ta', lifetimeViews: { kind: 'value', value: 900 }, views: { kind: 'value', value: 300 }, watchMinutes: { kind: 'value', value: 1500 }, averageViewDuration: { kind: 'value', value: 300 } });
    const why = "YouTube reported no row for this video in these dates (no views, or below YouTube's reporting threshold)";
    expect(v.videos[1]).toMatchObject({ videoId: 'b', lifetimeViews: { kind: 'no_data', reason: 'View count hidden' }, views: { kind: 'no_data', reason: why }, watchMinutes: { kind: 'no_data', reason: why } });
    expect(youtube.calls.find((c) => c.method === 'uploads')?.arg).toBe(200);
    // Asks about exactly the uploads shown, not YouTube's top 200 of all videos.
    expect(youtube.calls.find((c) => c.method === 'report' && (c.arg as ReportQuery).dimensions?.[0] === 'video')?.arg).toMatchObject({ startDate: '2026-10-25', endDate: '2026-11-21', dimensions: ['video'], filters: 'video==a,b', sort: '-views', maxResults: 200, metrics: ['views', 'estimatedMinutesWatched', 'averageViewDuration'] });
    expect(v.coverage).toMatchObject({ dataThrough: '2026-11-21', days: 28 });
  });

  test('no uploads is an empty list', async () => {
    const { cookie, row } = await connected('co-novid', 'UCconovid');
    const v = (await (await get(appWith({}).app, `/api/channels/${row.id}/videos`, cookie)).json()) as Videos;
    expect(v.videos).toEqual([]);
  });
});
