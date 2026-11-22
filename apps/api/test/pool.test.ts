import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import type { ContributeResult, PoolBrowser } from '@viewproof/core';
import { createApp } from '../src/app';
import { APP, channelFixture, makeDeps, post, signIn } from './helpers';

const T0 = Date.parse('2026-11-22T12:00:00Z');
const H = 3_600_000;
const iso = (t: number) => new Date(t).toISOString();
const app = (now = T0) => createApp(makeDeps({ now: () => now }));
const obs = (over: Record<string, unknown> = {}) => ({
  videoId: 'aaaaaaaaaaa', channelId: 'UCpppppppppppppppppppppp', title: 'Pool video', views: 1000, publishedAt: '2026-11-20T00:00:00.000Z',
  ageDays: null, durationSec: 300, format: 'long', source: 'watch', observedAt: iso(T0 - 60_000), ...over,
});
async function cookieFor(sub: string) {
  return (await signIn({ sub, channel: channelFixture({ channelId: `UCpool${sub}`.padEnd(24, 'x').slice(0, 24) }) })).cookie;
}
async function link(cookie: string, a = app()) {
  const r = await a.request('/api/pool/tokens', { method: 'POST', headers: { cookie, origin: APP, 'content-type': 'application/json' }, body: JSON.stringify({ label: 'Chrome at home' }) });
  expect(r.status).toBe(201);
  return r.json<{ token: string; browser: PoolBrowser }>();
}
const send = (token: string, body: unknown, a = app(), extra: Record<string, string> = {}) =>
  a.request('/api/pool/contribute', { method: 'POST', headers: { authorization: `Bearer ${token}`, origin: 'chrome-extension://abcdef', 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) });
const count = async (sql: string, ...b: unknown[]) => (await env.DB.prepare(sql).bind(...b).first<{ n: number }>())!.n;

describe('pool', () => {
  test('link, list, revoke', async () => {
    const cookie = await cookieFor('pl-link');
    const { token, browser } = await link(cookie);
    expect(token).toMatch(/^[\w-]{43}$/);
    expect(browser).toMatchObject({ label: 'Chrome at home', status: 'active', acceptedToday: 0, acceptedTotal: 0 });
    expect(await count('SELECT COUNT(*) n FROM pool_tokens WHERE id_hash = ?', token)).toBe(0); // only the hash is stored
    const list = await (await app().request('/api/pool/browsers', { headers: { cookie } })).json<PoolBrowser[]>();
    expect(list.map((b) => b.id)).toEqual([browser.id]);
    const del = await app().request(`/api/pool/browsers/${browser.id}`, { method: 'DELETE', headers: { cookie, origin: APP } });
    expect(del.status).toBe(204);
    expect((await send(token, { v: 1, observations: [obs()] })).status).toBe(401);
  });

  test('contribute accepted; stored without who sent it', async () => {
    const cookie = await cookieFor('pl-ok');
    const { token, browser } = await link(cookie);
    const r = await send(token, { v: 1, observations: [obs(), obs({ videoId: 'bbbbbbbbbbb', source: 'search', publishedAt: null, ageDays: 3, format: 'unknown', durationSec: null })] });
    expect(r.status).toBe(200);
    expect(await r.json<ContributeResult>()).toEqual({ accepted: 2, rejected: 0, reasons: [] });
    expect(await count("SELECT COUNT(*) n FROM pool_videos WHERE video_id IN ('aaaaaaaaaaa','bbbbbbbbbbb')")).toBe(2);
    expect(await count("SELECT COUNT(*) n FROM pool_channels WHERE channel_id = 'UCpppppppppppppppppppppp'")).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM pool_observations WHERE video_id = 'aaaaaaaaaaa'")).toBe(1);
    for (const t of ['pool_observations', 'pool_videos', 'pool_channels']) {
      const cols = (await env.DB.prepare(`PRAGMA table_info(${t})`).all<{ name: string }>()).results.map((c) => c.name);
      expect(cols.some((c) => /user|token/.test(c)), `${t}: ${cols}`).toBe(false);
    }
    const [b] = await (await app().request('/api/pool/browsers', { headers: { cookie } })).json<PoolBrowser[]>();
    expect(b).toMatchObject({ id: browser.id, acceptedToday: 2, rejectedToday: 0, acceptedTotal: 2, lastUsedAt: iso(T0) });
  });

  test('plausibility against stored history; bad items named', async () => {
    const { token } = await link(await cookieFor('pl-plaus'));
    await send(token, { v: 1, observations: [obs({ videoId: 'ccccccccccc', views: 10000, observedAt: iso(T0 - 2 * H) })] });
    const r = await (await send(token, { v: 1, observations: [obs({ videoId: 'ccccccccccc', views: 10, observedAt: iso(T0 - H) }), obs({ videoId: 'bad' })] })).json<ContributeResult>();
    expect(r).toEqual({ accepted: 0, rejected: 2, reasons: ['views fell from 10000 to 10', 'videoId: not a YouTube video id'] });
    expect(await count("SELECT COUNT(*) n FROM pool_observations WHERE video_id = 'ccccccccccc'")).toBe(1);
  });

  test('batch limits', async () => {
    const { token } = await link(await cookieFor('pl-limits'));
    expect((await send(token, { v: 1, observations: Array.from({ length: 301 }, () => obs()) })).status).toBe(400);
    expect((await send(token, 'nope')).status).toBe(400);
    await env.DB.prepare("UPDATE pool_token_days SET accepted = 3000 WHERE token_id IN (SELECT id FROM pool_tokens)").run();
    await env.DB.prepare("INSERT OR REPLACE INTO pool_token_days (token_id, day, accepted, rejected) SELECT id, '2026-11-22', 3000, 0 FROM pool_tokens WHERE label = 'Chrome at home'").run();
    const r = await send(token, { v: 1, observations: [obs({ videoId: 'ddddddddddd' })] });
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: 'limit', message: 'This browser shared 3000 observations today. More tomorrow.' });
  });

  test('duplicate batch: stored once, no error', async () => {
    const { token } = await link(await cookieFor('pl-dup'));
    const batch = { v: 1, observations: [obs({ videoId: 'eeeeeeeeeee' })] };
    expect(await (await send(token, batch)).json<ContributeResult>()).toMatchObject({ accepted: 1 });
    expect(await (await send(token, batch)).json<ContributeResult>()).toMatchObject({ accepted: 1, rejected: 0 });
    expect(await count("SELECT COUNT(*) n FROM pool_observations WHERE video_id = 'eeeeeeeeeee'")).toBe(1);
  });

  test('suspended after 200 rejections in a day', async () => {
    const cookie = await cookieFor('pl-susp');
    const { token } = await link(cookie);
    const bad = Array.from({ length: 201 }, () => obs({ videoId: 'x' }));
    expect(await (await send(token, { v: 1, observations: bad })).json<ContributeResult>()).toMatchObject({ rejected: 201 });
    const r = await send(token, { v: 1, observations: [obs({ videoId: 'fffffffffff' })] });
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: 'limit', message: 'Contribution paused: too much data was rejected.' });
    const [b] = await (await app().request('/api/pool/browsers', { headers: { cookie } })).json<PoolBrowser[]>();
    expect(b!.status).toBe('suspended');
  });

  test('deleted account → 401; unknown token → 401 with how to relink', async () => {
    const cookie = await cookieFor('pl-del');
    const { token } = await link(cookie);
    await post(app(), '/account/delete', cookie, { confirm: 'delete' });
    const r = await send(token, { v: 1, observations: [obs()] });
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: 'signed_out', message: 'This browser is not linked. Link it again in ViewProof → Settings → Extension & data.' });
    expect((await send('garbage', { v: 1, observations: [] })).status).toBe(401);
  });

  test('contribute ignores cookies and needs no app origin', async () => {
    const cookie = await cookieFor('pl-cookie');
    const r = await app().request('/api/pool/contribute', { method: 'POST', headers: { cookie, origin: APP, 'content-type': 'application/json' }, body: JSON.stringify({ v: 1, observations: [obs()] }) });
    expect(r.status).toBe(401);
    expect(r.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('token routes need a session and the app origin', async () => {
    expect((await app().request('/api/pool/browsers')).status).toBe(401);
    const cookie = await cookieFor('pl-csrf');
    expect((await app().request('/api/pool/tokens', { method: 'POST', headers: { cookie, origin: 'https://evil.example' } })).status).toBe(403);
  });
});
