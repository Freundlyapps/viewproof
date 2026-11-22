import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import type { Competitor, CompetitorDetail, CompetitorUploads } from '@viewproof/core';
import feedXml from '../../../packages/core/test/fixtures/feed-long.xml?raw';
import { createApp } from '../src/app';
import type { ChannelStatsClient } from '../src/competitors/stats';
import { runCron } from '../src/competitors/cron';
import { APP, addUser, channelFixture, makeDeps, post, signIn } from './helpers';
import { fakeGoogle } from './fake-google';

const VERI = 'UCHnyfMqiRRG1u-2MsSQLbXA';
const T0 = Date.parse('2026-11-21T12:00:00Z');
const H = 3_600_000;
/** The fixture feed re-labelled as another channel (ids prefixed so videos stay distinct). */
const feedFor = (id: string, title = `Chan ${id.slice(-4)}`) => (id === VERI ? feedXml : feedXml.replaceAll(VERI, id).replaceAll('HnyfMqiRRG1u-2MsSQLbXA', id.slice(2)).replace('<title>Veritasium</title>', `<title>${title}</title>`).replace(/<yt:videoId>([\w-]+)<\/yt:videoId>/g, (_m: string, v: string) => `<yt:videoId>${id.slice(-4)}${v}</yt:videoId>`));
const idN = (n: number) => `UC${String(n).padStart(22, '0')}`;

function setup(opts: { stats?: Partial<ChannelStatsClient>; key?: string; now?: () => number; feeds?: Record<string, string> } = {}) {
  const fetched: string[] = [];
  const statsCalls: { method: string; auth: unknown }[] = [];
  const channelStats: ChannelStatsClient = {
    byIds: async (ids, auth) => (statsCalls.push({ method: 'byIds', auth }), new Map(ids.map((id) => [id, { title: 'T', subscribers: id === idN(7) ? null : 1234, totalViews: 99, videoCount: 5 }]))),
    byHandle: async (h, auth) => (statsCalls.push({ method: 'byHandle', auth }), h === '@veritasium' ? VERI : null),
    ...opts.stats,
  };
  const deps = makeDeps({
    channelStats, now: opts.now ?? (() => T0), google: fakeGoogle({ refresh: async () => ({ accessToken: 'user-token' }) }),
    fetchFeed: async (id) => { fetched.push(id); if (id.startsWith('UCy')) return { ok: false, reason: 'HTTP 503' }; const x = opts.feeds?.[id] ?? (id.startsWith('UCx') ? undefined : feedFor(id)); return x ? { ok: true, xml: x } : { ok: false, reason: 'HTTP 404' }; },
  }, opts.key ? { YOUTUBE_API_KEY: opts.key } : {});
  return { app: createApp(deps), deps, fetched, statsCalls };
}
const json = (app: ReturnType<typeof createApp>, method: string, path: string, cookie: string, body?: unknown) =>
  app.request(path, { method, headers: { cookie, origin: APP, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
async function user(sub: string, withChannel = false) {
  if (!withChannel) {
    const s = await signIn({ sub, channel: channelFixture({ channelId: `UCown${sub}`.padEnd(24, 'x').slice(0, 24) }) });
    return s.cookie;
  }
  const s = await signIn({ sub, channel: channelFixture({ channelId: `UCown${sub}`.padEnd(24, 'x').slice(0, 24) }) });
  await post(s.app, '/connect/confirm', s.cookie, { id: s.pendingId });
  return s.cookie;
}

describe('competitors', () => {
  test('add by /channel/ link, list, detail', async () => {
    const cookie = await user('cp-add');
    const { app } = setup();
    const add = await json(app, 'POST', '/api/competitors', cookie, { input: `https://www.youtube.com/channel/${VERI}` });
    expect(add.status).toBe(201);
    expect(await add.json<Competitor>()).toMatchObject({ channelId: VERI, title: 'Veritasium', checkError: null });
    const list = await (await json(app, 'GET', '/api/competitors', cookie)).json<Competitor[]>();
    expect(list.map((c) => c.channelId)).toEqual([VERI]);
    expect(list[0]!.summary.inLast30Days.ofFeed).toBe(15);
    const d = await (await json(app, 'GET', `/api/competitors/${VERI}`, cookie)).json<CompetitorDetail>();
    expect(d.videos).toHaveLength(15);
    expect(d.videos[0]!.views.kind).toBe('value');
    expect(Date.parse(d.videos[0]!.publishedAt)).toBeGreaterThanOrEqual(Date.parse(d.videos[1]!.publishedAt));
  });

  test('add by handle without a key or a connected channel explains', async () => {
    const cookie = await user('cp-nokey');
    const r = await json(setup().app, 'POST', '/api/competitors', cookie, { input: '@Veritasium' });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'bad_request', message: "To add by @handle, connect your channel (Account) or paste the channel's /channel/UC… link." });
  });

  test('add by handle with a key, or with the connected channel’s access', async () => {
    const a = await user('cp-key');
    const s1 = setup({ key: 'k' });
    expect((await json(s1.app, 'POST', '/api/competitors', a, { input: 'https://www.youtube.com/@Veritasium/videos' })).status).toBe(201);
    expect(s1.statsCalls[0]).toEqual({ method: 'byHandle', auth: { key: 'k' } });
    const b = await user('cp-tok', true);
    const s2 = setup();
    expect((await json(s2.app, 'POST', '/api/competitors', b, { input: '@veritasium' })).status).toBe(201);
    expect(s2.statsCalls[0]).toEqual({ method: 'byHandle', auth: { token: 'user-token' } });
    const nf = await json(s2.app, 'POST', '/api/competitors', b, { input: '@nobodyhere' });
    expect(nf.status).toBe(404);
    expect(await nf.json()).toEqual({ error: 'not_found', message: 'No YouTube channel found for @nobodyhere.' });
  });

  test('invalid input, unknown id, already tracked', async () => {
    const cookie = await user('cp-bad');
    const { app } = setup();
    expect((await json(app, 'POST', '/api/competitors', cookie, { input: 'hello' })).status).toBe(400);
    const missing = await json(app, 'POST', '/api/competitors', cookie, { input: 'UCxxxxxxxxxxxxxxxxxxxxxx' });
    expect(missing.status).toBe(404);
    expect(await json(app, 'POST', '/api/competitors', cookie, { input: VERI })).toHaveProperty('status', 201);
    const again = await json(app, 'POST', '/api/competitors', cookie, { input: VERI });
    expect(again.status).toBe(409);
  });

  test('a feed that fails to load is not reported as a missing channel', async () => {
    const cookie = await user('cp-feedfail');
    const r = await json(setup().app, 'POST', '/api/competitors', cookie, { input: 'UCyyyyyyyyyyyyyyyyyyyyyy' });
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ error: 'google_failed', message: "Couldn't read the channel's feed (HTTP 503). Try again later." });
    const s = setup({ key: 'k', stats: { byHandle: async () => 'UCyyyyyyyyyyyyyyyyyyyyyz' } });
    const h = await json(s.app, 'POST', '/api/competitors', cookie, { input: '@realone' });
    expect(h.status).toBe(502);
  });

  test('new-channel lookups are capped per user per day', async () => {
    const cookie = await user('cp-addcap');
    const { app } = setup();
    for (let i = 0; i < 50; i++) await json(app, 'POST', '/api/competitors', cookie, { input: `UCx${String(i).padStart(21, '0')}` });
    const r = await json(app, 'POST', '/api/competitors', cookie, { input: idN(900) });
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: 'limit', message: 'You looked up 50 new channels today. More tomorrow.' });
  }, 120_000);

  test('limit 25', async () => {
    const cookie = await user('cp-limit');
    const { app } = setup();
    for (let i = 1; i <= 25; i++) expect((await json(app, 'POST', '/api/competitors', cookie, { input: idN(100 + i) })).status).toBe(201);
    const over = await json(app, 'POST', '/api/competitors', cookie, { input: idN(200) });
    expect(over.status).toBe(422);
    expect(await over.json()).toEqual({ error: 'limit', message: 'You can track up to 25 channels.' });
  }, 120_000);

  test('shared channel: one fetch per window; removing it for one user keeps it for the other', async () => {
    const a = await user('cp-sh-a');
    const b = await user('cp-sh-b');
    const id = idN(300);
    const s = setup();
    await json(s.app, 'POST', '/api/competitors', a, { input: id });
    await json(s.app, 'POST', '/api/competitors', b, { input: id });
    await json(s.app, 'GET', '/api/competitors', a);
    await json(s.app, 'GET', `/api/competitors/${id}`, b);
    expect(s.fetched.filter((x) => x === id)).toHaveLength(1);
    expect((await json(s.app, 'DELETE', `/api/competitors/${id}`, a)).status).toBe(204);
    expect((await (await json(s.app, 'GET', '/api/competitors', a)).json<Competitor[]>()).map((c) => c.channelId)).not.toContain(id);
    expect((await json(s.app, 'GET', `/api/competitors/${id}`, b)).status).toBe(200);
  });

  test("another user's channel → 404", async () => {
    const a = await user('cp-own-a');
    const b = await user('cp-own-b');
    const { app } = setup();
    await json(app, 'POST', '/api/competitors', a, { input: idN(400) });
    expect((await json(app, 'GET', `/api/competitors/${idN(400)}`, b)).status).toBe(404);
  });

  test('uploads: newest first across channels, with channel title', async () => {
    const cookie = await user('cp-up');
    const { app } = setup();
    await json(app, 'POST', '/api/competitors', cookie, { input: idN(500) });
    await json(app, 'POST', '/api/competitors', cookie, { input: idN(501) });
    const r = await (await json(app, 'GET', '/api/competitors/uploads', cookie)).json<CompetitorUploads>();
    expect(r.uploads.length).toBe(30);
    expect(new Set(r.uploads.map((u) => u.channelTitle)).size).toBe(2);
    for (let i = 1; i < r.uploads.length; i++) expect(Date.parse(r.uploads[i - 1]!.publishedAt)).toBeGreaterThanOrEqual(Date.parse(r.uploads[i]!.publishedAt));
  });

  test('stats shown as of; hidden count and missing key explained', async () => {
    const cookie = await user('cp-stats');
    const s = setup({ key: 'k' });
    await json(s.app, 'POST', '/api/competitors', cookie, { input: idN(600) });
    await json(s.app, 'POST', '/api/competitors', cookie, { input: idN(7) });
    const list = await (await json(s.app, 'GET', '/api/competitors', cookie)).json<Competitor[]>();
    expect(list.find((c) => c.channelId === idN(600))!.subscribers).toMatchObject({ kind: 'value', value: 1234, inputs: { asOf: new Date(T0).toISOString() } });
    expect(list.find((c) => c.channelId === idN(7))!.subscribers).toEqual({ kind: 'no_data', reason: 'This channel hides its subscriber count' });
    const other = await user('cp-stats2');
    const n = setup();
    await json(n.app, 'POST', '/api/competitors', other, { input: idN(601) });
    const l2 = await (await json(n.app, 'GET', '/api/competitors', other)).json<Competitor[]>();
    expect(l2[0]!.subscribers).toEqual({ kind: 'no_data', reason: 'Subscriber counts need a YouTube API key on this server (or your connected channel)' });
  });

  test("without a key, missing or day-old counts refresh with the user's connected channel", async () => {
    const cookie = await user('cp-tokstats', true);
    const id = idN(650);
    await env.DB.prepare("INSERT INTO tracked_channels (channel_id, title, last_polled_at, created_at) VALUES (?, 'Seeded', ?, ?)").bind(id, new Date(T0).toISOString(), new Date(T0).toISOString()).run();
    await env.DB.prepare("INSERT INTO user_competitors SELECT id, ?, ? FROM users WHERE google_sub = 'cp-tokstats'").bind(id, new Date(T0).toISOString()).run();
    const s = setup();
    const list = await (await json(s.app, 'GET', '/api/competitors', cookie)).json<Competitor[]>();
    expect(s.statsCalls).toContainEqual({ method: 'byIds', auth: { token: 'user-token' } });
    expect(list[0]!.subscribers).toMatchObject({ kind: 'value', value: 1234 });
    const again = setup({ now: () => T0 + 2 * H });
    await json(again.app, 'GET', '/api/competitors', cookie);
    expect(again.statsCalls.filter((c) => c.method === 'byIds')).toHaveLength(0);
  });

  test('Data API counts older than 30 days are never shown', async () => {
    const cookie = await user('cp-old');
    const s = setup({ key: 'k' });
    await json(s.app, 'POST', '/api/competitors', cookie, { input: idN(660) });
    await env.DB.prepare('UPDATE tracked_channels SET stats_at = ? WHERE channel_id = ?').bind(new Date(T0 - 31 * 24 * H).toISOString(), idN(660)).run();
    const list = await (await json(s.app, 'GET', '/api/competitors', cookie)).json<Competitor[]>();
    expect(list[0]!.subscribers).toEqual({ kind: 'no_data', reason: 'Not fetched yet' });
  });

  test('scheduled run polls stale channels, refreshes stats daily, prunes orphans after account deletion', async () => {
    await env.DB.prepare('DELETE FROM tracked_channels').run(); // only this test's channel is due
    const cookie = await user('cp-cron');
    const id = idN(700);
    const s = setup({ key: 'k' });
    await json(s.app, 'POST', '/api/competitors', cookie, { input: id });
    const later = setup({ key: 'k', now: () => T0 + 4 * H });
    await runCron(later.deps, new Date(T0 + 4 * H));
    expect(later.fetched).toContain(id);
    const atThree = setup({ key: 'k', now: () => Date.parse('2026-11-22T03:05:00Z') });
    await runCron(atThree.deps, new Date('2026-11-22T03:05:00Z'));
    expect(atThree.statsCalls.some((c) => c.method === 'byIds')).toBe(true);
    await post(s.app, '/account/delete', cookie, { confirm: 'delete' });
    await runCron(atThree.deps, new Date('2026-11-22T03:05:00Z'));
    expect(await env.DB.prepare('SELECT channel_id FROM tracked_channels WHERE channel_id = ?').bind(id).first()).toBeNull();
  });

  test('signed out → 401', async () => {
    expect((await createApp(makeDeps()).request('/api/competitors')).status).toBe(401);
  });
});

void addUser;
