import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import type { KeywordTrends, YourTerms } from '@viewproof/core';
import type { ChannelRow } from '@viewproof/db';
import { type KeywordProvider, noProvider } from '@viewproof/providers';
import { createApp } from '../src/app';
import { keywordProviderFor } from '../src/keyword-provider';
import { fakeGoogle } from './fake-google';
import { fakeYouTube } from './fake-youtube';
import { channelFixture, makeDeps, post, signIn } from './helpers';

const NOW = Date.parse('2026-11-21T12:00:00Z');
const DAY = 86_400_000;
async function connected(sub: string, channelId: string) {
  const s = await signIn({ sub, channel: channelFixture({ channelId }) });
  await post(s.app, '/connect/confirm', s.cookie, { id: s.pendingId });
  const row = (await env.DB.prepare('SELECT * FROM channels WHERE channel_id = ?').bind(channelId).first<ChannelRow>())!;
  return { cookie: s.cookie, row };
}
function counting(answer: (kw: string, c: string) => KeywordTrends) {
  const calls: string[] = [];
  const p: KeywordProvider = { name: 'fake', trends: async (kw, c) => (calls.push(`${kw}|${c.code}`), answer(kw, c.code)) };
  return { p, calls };
}
const ok = (kw: string, c: string): KeywordTrends => ({ status: 'ok', provider: 'fake', label: 'Trends', keyword: kw, country: c, interest: [{ date: '2026-01-04', value: 100 }], note: null, fetchedAt: '2026-11-21T00:00:00Z' });
const get = async (app: ReturnType<typeof createApp>, path: string, cookie = '') => app.request(path, { headers: { cookie } });

describe('keyword trends', () => {
  test('is cached 30 days and shared between users', async () => {
    const a = await connected('kw-a', 'UCkwa');
    const b = await connected('kw-b', 'UCkwb');
    const { p, calls } = counting(ok);
    let t = NOW;
    const app = createApp(makeDeps({ keywords: p, now: () => t }));
    const r = await (await get(app, '/api/keywords/trends?q=Pottery%20Wheel&country=DE', a.cookie)).json<KeywordTrends>();
    expect(r.status).toBe('ok');
    await get(app, '/api/keywords/trends?q=pottery+wheel&country=DE', b.cookie);
    expect(calls).toEqual(['pottery wheel|DE']);
    // Age the shared row (moving the clock would also expire the test's login session).
    await env.DB.prepare("UPDATE keyword_cache SET fetched_at = ? WHERE keyword = 'pottery wheel'").bind(new Date(t - 31 * DAY).toISOString()).run();
    await get(app, '/api/keywords/trends?q=pottery+wheel&country=DE', b.cookie);
    expect(calls).toHaveLength(2);
  });

  test('off and failed are not cached', async () => {
    const a = await connected('kw-off', 'UCkwoff');
    let status: 'off' | 'failed' = 'off';
    const { p, calls } = counting(() => ({ status, reason: 'r' }));
    const app = createApp(makeDeps({ keywords: p }));
    expect(await (await get(app, '/api/keywords/trends?q=glaze', a.cookie)).json()).toEqual({ status: 'off', reason: 'r' });
    status = 'failed';
    await get(app, '/api/keywords/trends?q=glaze', a.cookie);
    expect(calls).toHaveLength(2);
  });

  test('country falls back to US', async () => {
    const a = await connected('kw-cc', 'UCkwcc');
    const { p, calls } = counting(ok);
    await get(createApp(makeDeps({ keywords: p })), '/api/keywords/trends?q=kiln&country=XX', a.cookie);
    expect(calls).toEqual(['kiln|US']);
  });

  test('signed out → 401; bad keyword → 400', async () => {
    const app = createApp(makeDeps());
    expect((await get(app, '/api/keywords/trends?q=x')).status).toBe(401);
    const a = await connected('kw-bad', 'UCkwbad');
    const empty = await get(app, '/api/keywords/trends?q=%20%20', a.cookie);
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: 'bad_request', message: 'Type a keyword (up to 100 characters).' });
    expect((await get(app, `/api/keywords/trends?q=${'a'.repeat(101)}`, a.cookie)).status).toBe(400);
  });
});

describe('provider choice', () => {
  const base = { DATAFORSEO_LOGIN: 'l', DATAFORSEO_PASSWORD: 'p' };
  const f = (async () => new Response('{}')) as unknown as typeof fetch;
  test('DataForSEO only with written OK and credentials', async () => {
    expect(keywordProviderFor({ ...base, DATAFORSEO_DISPLAY_OK: 'yes' }, f).name).toBe('DataForSEO');
    expect(await keywordProviderFor(base, f).trends('x', { code: 'US', locationCode: 2840 })).toEqual({ status: 'off', reason: 'YouTube search interest is off: DataForSEO has not yet confirmed that its data may be shown to users.' });
    expect(await keywordProviderFor({ DATAFORSEO_DISPLAY_OK: 'yes' }, f).trends('x', { code: 'US', locationCode: 2840 })).toEqual({ status: 'off', reason: 'YouTube search interest is optional and not configured on this server.' });
  });
});

describe('your matching search terms', () => {
  const report = async (_t: string, q: { dimensions?: string[]; startDate: string }) => {
    const cols = ['insightTrafficSourceDetail', 'views', 'estimatedMinutesWatched'];
    if (q.dimensions?.[0] === 'day') return { columns: ['day', 'views'], rows: [['2026-11-21', 1]] };
    if (q.dimensions?.[0] === 'video') return { columns: ['video', 'views'], rows: [] };
    return { columns: cols, rows: [['how to trim a bowl', 60, 240], ['glaze', 31, 92], ['bowl trimming tool', 4, 8]] };
  };
  const appWith = () => createApp(makeDeps({ youtube: fakeYouTube({ report }), google: fakeGoogle({ refresh: async () => ({ accessToken: 'at' }) }), now: () => NOW }));

  test('filter the cached 90-day terms to those containing every keyword word', async () => {
    const { cookie, row } = await connected('kw-terms', 'UCkwterms');
    const r = await (await get(appWith(), `/api/channels/${row.id}/keyword-terms?q=Trim%20%20Bowl`, cookie)).json<YourTerms>();
    expect(r.keyword).toBe('trim bowl');
    expect(r.terms.map((t) => t.term)).toEqual(['how to trim a bowl']);
    expect(r.note).toBeNull();
    expect(r.coverage.rangeDays).toBe(90);
    expect(await env.DB.prepare("SELECT key FROM report_cache WHERE channel_id = ? AND key LIKE 'terms:90d:%'").bind(row.id).first()).not.toBeNull();
  });

  test('no match note', async () => {
    const { cookie, row } = await connected('kw-none', 'UCkwnone');
    const r = await (await get(appWith(), `/api/channels/${row.id}/keyword-terms?q=kiln`, cookie)).json<YourTerms>();
    expect(r.terms).toEqual([]);
    expect(r.note).toBe("None of your channel's top 25 search terms (last 90 days) contains this keyword.");
  });

  test("another user's channel → 404", async () => {
    const mine = await connected('kw-me', 'UCkwme');
    const theirs = await connected('kw-them', 'UCkwthem');
    expect((await get(appWith(), `/api/channels/${theirs.row.id}/keyword-terms?q=x`, mine.cookie)).status).toBe(404);
  });
});

void noProvider;

describe('review fixes', () => {
  test('a failed answer is not cached', async () => {
    const a = await connected('kw-tr', 'UCkwtr');
    const { p, calls } = counting(() => ({ status: 'failed', reason: 'DataForSEO: Internal error.' }));
    const app = createApp(makeDeps({ keywords: p }));
    await get(app, '/api/keywords/trends?q=slip', a.cookie);
    await get(app, '/api/keywords/trends?q=slip', a.cookie);
    expect(calls).toHaveLength(2);
  });

  test('each user gets 50 new paid lookups a day; cached keywords still work', async () => {
    const a = await connected('kw-cap', 'UCkwcap');
    const b = await connected('kw-cap2', 'UCkwcap2');
    const { p, calls } = counting(ok);
    const app = createApp(makeDeps({ keywords: p, now: () => NOW }));
    for (let i = 0; i < 50; i++) expect((await get(app, `/api/keywords/trends?q=cap${i}`, a.cookie)).status).toBe(200);
    const over = await get(app, '/api/keywords/trends?q=cap-over', a.cookie);
    expect(over.status).toBe(429);
    expect(await over.json()).toEqual({ error: 'limit', message: 'You reached 50 new keyword trend lookups today; keywords looked up before still work. More tomorrow.' });
    expect((await get(app, '/api/keywords/trends?q=cap0', a.cookie)).status).toBe(200);
    expect((await get(app, '/api/keywords/trends?q=cap-over', b.cookie)).status).toBe(200);
    expect(calls).toHaveLength(51);
  }, 120_000);

  test('with no provider configured, lookups are not counted', async () => {
    const a = await connected('kw-none-cap', 'UCkwnonecap');
    const app = createApp(makeDeps({ now: () => NOW }));
    for (let i = 0; i < 52; i++) await get(app, `/api/keywords/trends?q=n${i}`, a.cookie);
    expect((await get(app, '/api/keywords/trends?q=last', a.cookie)).status).toBe(200);
    expect(await env.DB.prepare('SELECT count FROM keyword_lookups WHERE user_id = (SELECT user_id FROM channels WHERE channel_id = ?)').bind('UCkwnonecap').first()).toBeNull();
  }, 120_000);
});
