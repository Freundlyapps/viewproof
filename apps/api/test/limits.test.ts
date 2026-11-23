import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import type { KeywordTrends } from '@viewproof/core';
import type { KeywordProvider } from '@viewproof/providers';
import feedXml from '../../../packages/core/test/fixtures/feed-long.xml?raw';
import { createApp } from '../src/app';
import { limitOf } from '../src/plans';
import { usageSummary } from '../src/usage';
import { APP, addUser, makeDeps, sendJsonReq, sessionCookie } from './helpers';

const NOW = Date.parse('2026-11-21T12:00:00Z');
const BILLING = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x', STRIPE_PRICE_ID: 'price_x' };
const UPSELL = ' Upgrade to Pro in Settings → Plan & usage.';
const idN = (n: number) => `UC${String(n).padStart(22, '0')}`;
const VERI = 'UCHnyfMqiRRG1u-2MsSQLbXA';
/** The real fixture feed re-labelled as another channel (same trick as competitors.test.ts). */
const feed = (id: string) => feedXml.replaceAll(VERI, id).replaceAll('HnyfMqiRRG1u-2MsSQLbXA', id.slice(2)).replace(/<yt:videoId>([\w-]+)<\/yt:videoId>/g, (_m: string, v: string) => `<yt:videoId>${id.slice(-4)}${v}</yt:videoId>`);
const ok = (kw: string, c: string): KeywordTrends => ({ status: 'ok', provider: 'fake', label: 'Trends', keyword: kw, country: c, interest: [{ date: '2026-01-04', value: 100 }], note: null, fetchedAt: '2026-11-21T00:00:00Z' });
const provider: KeywordProvider = { name: 'fake', trends: async (kw, c) => ok(kw, c.code) };

async function user(id: string, plan = 'free') {
  await addUser(id, plan);
  return sessionCookie(id);
}

describe('limitOf', () => {
  test('free and pro values from research 09; self-hosted has no limits', () => {
    const keys = ['channels', 'competitors', 'keywordLookups', 'outlierSearches', 'aiQuick', 'aiCoach'] as const;
    expect(keys.map((k) => limitOf('free', false, k))).toEqual([1, 3, 5, 10, 20, 0]);
    expect(keys.map((k) => limitOf('pro', false, k))).toEqual([3, 25, 60, null, 500, 150]);
    expect(keys.map((k) => limitOf('unknown', false, k))).toEqual([1, 3, 5, 10, 20, 0]);
    expect(keys.map((k) => limitOf('free', true, k))).toEqual([null, null, null, null, null, null]);
  });
});

describe('competitor limit per plan', () => {
  test('free: a 4th channel is refused with the upgrade line; pro: 25', async () => {
    const cookie = await user('lim-c1');
    const app = createApp(makeDeps({ now: () => NOW, fetchFeed: async (id) => ({ ok: true, xml: feed(id) }) }, BILLING));
    for (let i = 1; i <= 3; i++) expect((await sendJsonReq(app, 'POST', '/api/competitors', cookie, { input: idN(i) })).status).toBe(201);
    const over = await sendJsonReq(app, 'POST', '/api/competitors', cookie, { input: idN(4) });
    expect(over.status).toBe(422);
    expect(await over.json()).toEqual({ error: 'limit', message: `You can track up to 3 channels.${UPSELL}` });
    const me = await (await app.request('/api/me', { headers: { cookie } })).json<{ maxCompetitors: number }>();
    expect(me.maxCompetitors).toBe(3);
  }, 60_000);

  test('without billing the copy has no upsell', async () => {
    const cookie = await user('lim-c2');
    const app = createApp(makeDeps({ now: () => NOW, fetchFeed: async (id) => ({ ok: true, xml: feed(id) }) }));
    for (let i = 11; i <= 13; i++) await sendJsonReq(app, 'POST', '/api/competitors', cookie, { input: idN(i) });
    expect(await (await sendJsonReq(app, 'POST', '/api/competitors', cookie, { input: idN(14) })).json()).toEqual({ error: 'limit', message: 'You can track up to 3 channels.' });
  }, 60_000);

  test('a downgraded user keeps every tracked channel listed', async () => {
    const cookie = await user('lim-c3', 'pro');
    const app = createApp(makeDeps({ now: () => NOW, fetchFeed: async (id) => ({ ok: true, xml: feed(id) }) }));
    for (let i = 21; i <= 25; i++) expect((await sendJsonReq(app, 'POST', '/api/competitors', cookie, { input: idN(i) })).status).toBe(201);
    await env.DB.prepare("UPDATE users SET plan = 'free' WHERE id = 'lim-c3'").run();
    const list = await (await app.request('/api/competitors', { headers: { cookie } })).json<unknown[]>();
    expect(list).toHaveLength(5);
    expect((await sendJsonReq(app, 'POST', '/api/competitors', cookie, { input: idN(26) })).status).toBe(422);
  }, 60_000);
});

describe('keyword lookups per month', () => {
  test('free: 5 new lookups a month, cached ones free, next month resets', async () => {
    const cookie = await user('lim-k1');
    let now = NOW;
    const app = createApp(makeDeps({ keywords: provider, now: () => now }, BILLING));
    const get = (q: string) => app.request(`/api/keywords/trends?q=${q}`, { headers: { cookie } });
    for (let i = 0; i < 5; i++) expect((await get(`k${i}`)).status).toBe(200);
    const over = await get('k-over');
    expect(over.status).toBe(429);
    expect(await over.json()).toEqual({ error: 'limit', message: `You used all 5 new keyword lookups included this month; keywords looked up before still work.${UPSELL}` });
    expect((await get('k0')).status).toBe(200);
    now = Date.parse('2026-12-01T00:00:01Z');
    expect((await get('k-over')).status).toBe(200);
  }, 60_000);

  test('pro: 60 a month', async () => {
    await user('lim-k2', 'pro');
    const deps = makeDeps({ keywords: provider, now: () => NOW });
    await env.DB.prepare("INSERT INTO usage_counts (user_id, kind, period, count) VALUES ('lim-k2', 'keyword', '2026-11', 59)").run();
    const { keywordTrends } = await import('../src/routes/keywords');
    expect('limit' in (await keywordTrends(deps, 'lim-k2', 'p1', 'US'))).toBe(false);
    expect('limit' in (await keywordTrends(deps, 'lim-k2', 'p2', 'US'))).toBe(true);
  });
});

describe('outlier searches per day', () => {
  test('free: 10 distinct searches a day; repeating one is free; pro has no limit', async () => {
    const cookie = await user('lim-o1');
    const app = createApp(makeDeps({ now: () => NOW }, BILLING));
    const get = (q: string, c = cookie) => app.request(`/api/outliers?q=${q}`, { headers: { cookie: c } });
    for (let i = 0; i < 10; i++) expect((await get(`o${i}`)).status).toBe(200);
    const over = await get('o-over');
    expect(over.status).toBe(429);
    expect(await over.json()).toEqual({ error: 'limit', message: `You used all 10 outlier searches for today. More tomorrow.${UPSELL}` });
    expect((await get('o3')).status).toBe(200);
    const pro = await user('lim-o2', 'pro');
    for (let i = 0; i < 12; i++) expect((await get(`p${i}`, pro)).status).toBe(200);
  }, 60_000);
});

describe('usageSummary', () => {
  test('six rows with used, limit and period; resets on the 1st of next month', async () => {
    await user('lim-u1');
    await env.DB.batch([
      env.DB.prepare("INSERT INTO usage_counts (user_id, kind, period, count) VALUES ('lim-u1', 'keyword', '2026-11', 2)"),
      env.DB.prepare("INSERT INTO outlier_searches (user_id, day, query) VALUES ('lim-u1', '2026-11-21', 'a'), ('lim-u1', '2026-11-21', 'b'), ('lim-u1', '2026-11-20', 'c')"),
      env.DB.prepare("INSERT INTO ai_usage (user_id, month, quick, coach) VALUES ('lim-u1', '2026-11', 7, 0)"),
    ]);
    const s = await usageSummary(makeDeps({ now: () => NOW }), 'lim-u1');
    expect(s).toMatchObject({ plan: 'free', month: '2026-11', resetsOn: '2026-12-01' });
    expect(s.rows.map((r) => [r.key, r.used, r.limit, r.per])).toEqual([
      ['channels', 0, 1, 'total'],
      ['competitors', 0, 3, 'total'],
      ['keywordLookups', 2, 5, 'month'],
      ['outlierSearches', 2, 10, 'day'],
      ['aiQuick', 7, 20, 'month'],
      ['aiCoach', 0, 0, 'month'],
    ]);
    expect(s.rows.every((r) => r.label.length > 0)).toBe(true);
  });
});

void APP;
