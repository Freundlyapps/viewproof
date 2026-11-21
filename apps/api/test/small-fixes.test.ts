import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import type { Earnings, Overview, UploadTimes } from '@viewproof/core';
import type { ChannelRow } from '@viewproof/db';
import { createApp } from '../src/app';
import { cached } from '../src/channel-data';
import { SCOPES, type GoogleClient } from '../src/google';
import { memoizeRefresh } from '../src/token-memo';
import type { ReportQuery, Upload, YouTubeClient } from '../src/youtube';
import { fakeGoogle } from './fake-google';
import { fakeYouTube } from './fake-youtube';
import { ALL_SCOPES, channelFixture, makeDeps, post, signIn } from './helpers';

const NOW = Date.parse('2026-11-21T12:00:00Z');
async function connected(sub: string, channelId: string, revenue = false) {
  const s = await signIn({ sub, channel: channelFixture({ channelId }), scopes: revenue ? [...ALL_SCOPES, SCOPES.revenue] : ALL_SCOPES, query: revenue ? '?revenue=1' : '' });
  await post(s.app, '/connect/confirm', s.cookie, { id: s.pendingId });
  const row = (await env.DB.prepare('SELECT * FROM channels WHERE channel_id = ?').bind(channelId).first<ChannelRow>())!;
  return { cookie: s.cookie, row };
}
function appWith(yt: Partial<YouTubeClient>, now = () => NOW) {
  const youtube = fakeYouTube(yt);
  const google = fakeGoogle({ refresh: async () => ({ accessToken: 'at' }) });
  return { app: createApp(makeDeps({ youtube, google, now })), youtube, google };
}
const get = (app: ReturnType<typeof createApp>, path: string, cookie: string) => app.request(path, { headers: { cookie } });
const up = (videoId: string, publishedAt: string): Upload => ({ videoId, title: videoId, publishedAt, durationSec: 60, views: 1, thumbnailUrl: null });
const DAY = { columns: ['day', 'views'], rows: [['2026-11-21', 1]] };

describe('first-week window', () => {
  test('starts on the Pacific date of publishing (YouTube days are Pacific)', async () => {
    const { cookie, row } = await connected('sf-fw', 'UCsffw');
    const { app, youtube } = appWith({ uploads: async () => [up('late', '2026-11-02T03:00:00Z')], report: async () => ({ columns: ['views'], rows: [[5]] }) });
    await get(app, `/api/channels/${row.id}/upload-times`, cookie);
    const q = youtube.calls.map((c) => c.arg as ReportQuery).find((x) => x?.filters === 'video==late');
    expect(q).toMatchObject({ startDate: '2026-11-01', endDate: '2026-11-07' });
  });

  test('"no first-week views" is re-asked after 6 hours, a real count is kept 30 days', async () => {
    const { cookie, row } = await connected('sf-fwttl', 'UCsffwttl');
    let t = NOW;
    let views: number | null = null;
    const yt = { uploads: async () => [up('a', '2026-10-01T18:00:00Z')], report: async () => ({ columns: ['views'], rows: views === null ? [] : [[views]] }) };
    const { app, youtube } = appWith(yt, () => t);
    const fwCalls = () => youtube.calls.filter((c) => (c.arg as ReportQuery)?.filters === 'video==a').length;
    await get(app, `/api/channels/${row.id}/upload-times`, cookie);
    expect(fwCalls()).toBe(1);
    views = 77;
    t += 7 * 3_600_000;
    const r = await (await get(app, `/api/channels/${row.id}/upload-times`, cookie)).json<UploadTimes>();
    expect(fwCalls()).toBe(2);
    expect(r.uploads[0]!.firstWeekViews).toMatchObject({ kind: 'value', value: 77 });
    t += 7 * 3_600_000;
    await get(app, `/api/channels/${row.id}/upload-times`, cookie);
    expect(fwCalls()).toBe(2);
  });
});

describe('fewer calls to Google', () => {
  test('a cached answer is served without renewing Google access', async () => {
    const { cookie, row } = await connected('sf-peek', 'UCsfpeek');
    const { app, google } = appWith({ report: async (_t, q) => (q.dimensions?.[0] === 'day' ? DAY : { columns: [], rows: [] }) });
    await get(app, `/api/channels/${row.id}/overview`, cookie);
    const before = google.calls.filter((c) => c === 'refresh').length;
    expect((await get(app, `/api/channels/${row.id}/overview`, cookie)).status).toBe(200);
    expect(google.calls.filter((c) => c === 'refresh').length).toBe(before);
  });

  test('two tabs loading at once fetch the uploads list once', async () => {
    const { cookie, row } = await connected('sf-once', 'UCsfonce');
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { app, youtube } = appWith({
      uploads: async () => { await gate; return [up('v', '2026-10-01T18:00:00Z')]; },
      report: async (_t, q) => (q.dimensions?.[0] === 'day' ? DAY : { columns: [], rows: [] }),
    });
    const both = Promise.all([get(app, `/api/channels/${row.id}/videos`, cookie), get(app, `/api/channels/${row.id}/upload-times`, cookie)]);
    await new Promise((r) => setTimeout(r, 200));
    release();
    await both;
    expect(youtube.calls.filter((c) => c.method === 'uploads').length).toBe(1);
  });

  test('cached() shares one load between concurrent callers', async () => {
    const { row } = await connected('sf-share', 'UCsfshare');
    let loads = 0;
    const load = async () => { loads++; await new Promise((r) => setTimeout(r, 50)); return { n: loads }; };
    const deps = makeDeps();
    const [a, b] = await Promise.all([cached(deps, row.id, 'k', 60_000, load), cached(deps, row.id, 'k', 60_000, load)]);
    expect(loads).toBe(1);
    expect(a).toEqual(b);
  });

  test('memoizeRefresh: one Google call per refresh token for 45 minutes; failures not kept', async () => {
    let t = 0;
    let n = 0;
    let fail = true;
    const g: GoogleClient = { ...fakeGoogle(), refresh: async () => (n++, fail ? { kind: 'failed', reason: 'x' } : { accessToken: `at${n}` }) };
    const store = new Map();
    const m = memoizeRefresh(g, store, () => t);
    expect(await m.refresh('rt')).toEqual({ kind: 'failed', reason: 'x' });
    fail = false;
    const [a, b] = await Promise.all([m.refresh('rt'), m.refresh('rt')]);
    expect(a).toEqual({ accessToken: 'at2' });
    expect(b).toEqual(a);
    t += 44 * 60_000;
    expect(await m.refresh('rt')).toEqual({ accessToken: 'at2' });
    t += 2 * 60_000;
    expect(await m.refresh('rt')).toEqual({ accessToken: 'at3' });
    expect(await m.refresh('other')).toEqual({ accessToken: 'at4' });
  });
});

describe('reconnect status', () => {
  test('clears once YouTube answers again', async () => {
    const { cookie, row } = await connected('sf-heal', 'UCsfheal');
    await env.DB.prepare("UPDATE channels SET status = 'reconnect', status_reason = 'Google access was removed or expired' WHERE id = ?").bind(row.id).run();
    const { app } = appWith({ report: async (_t, q) => (q.dimensions?.[0] === 'day' ? DAY : { columns: [], rows: [] }) });
    expect((await get(app, `/api/channels/${row.id}/overview`, cookie)).status).toBe(200);
    const s = await env.DB.prepare('SELECT status, status_reason FROM channels WHERE id = ?').bind(row.id).first();
    expect(s).toEqual({ status: 'active', status_reason: null });
  });

  test('a cached answer does not hide that access is still broken', async () => {
    const { cookie, row } = await connected('sf-stale', 'UCsfstale');
    const ok = appWith({ report: async (_t, q) => (q.dimensions?.[0] === 'day' ? DAY : { columns: [], rows: [] }) });
    await get(ok.app, `/api/channels/${row.id}/overview`, cookie);
    await env.DB.prepare("UPDATE channels SET status = 'reconnect' WHERE id = ?").bind(row.id).run();
    const broken = createApp(makeDeps({ youtube: fakeYouTube(), google: fakeGoogle({ refresh: async () => ({ kind: 'revoked' }) }), now: () => NOW }));
    expect((await get(broken, `/api/channels/${row.id}/overview`, cookie)).status).toBe(409);
  });
});

describe('earnings not available', () => {
  test('is re-checked after 30 minutes, not 6 hours', async () => {
    const { cookie, row } = await connected('sf-ypp', 'UCsfypp', true);
    let t = NOW;
    let joined = false;
    const { app } = appWith({
      report: async (_t, q) => (q.dimensions?.[0] === 'day' ? DAY : joined ? { columns: ['estimatedRevenue', 'playbackBasedCpm', 'monetizedPlaybacks'], rows: [[1, 2, 3]] } : { kind: 'forbidden', reason: 'Not in YPP' }),
    }, () => t);
    expect((await (await get(app, `/api/channels/${row.id}/earnings`, cookie)).json<Earnings>()).status).toBe('not_available');
    joined = true;
    t += 31 * 60_000;
    expect((await (await get(app, `/api/channels/${row.id}/earnings`, cookie)).json<Earnings>()).status).toBe('ok');
  });
});

describe('web app files', () => {
  test('a missing file anywhere under /app is a 404, not the app page', async () => {
    const assets = { fetch: async (req: Request) => (new URL(req.url).pathname === '/app/index.html' ? new Response('<div id="root">') : new Response('nf', { status: 404 })) };
    const app = createApp(makeDeps({ assets }));
    expect((await app.request('/app/x.js')).status).toBe(404);
    expect((await app.request('/app/favicon.ico')).status).toBe(404);
    expect((await app.request('/app/channel/videos')).status).toBe(200);
  });
});

void ({} as Overview);
