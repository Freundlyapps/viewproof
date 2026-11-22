import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import type { ContributeResult, Outliers } from '@viewproof/core';
import { createApp } from '../src/app';
import { feedOf, historyOf } from '../src/competitors/routes';
import { pollChannel } from '../src/competitors/poll';
import { runCron } from '../src/competitors/cron';
import { APP, channelFixture, makeDeps, signIn } from './helpers';

const T0 = Date.parse('2026-11-22T12:34:56.789Z');
const H = 3_600_000;
const iso = (t: number) => new Date(t).toISOString();

/** D1 refuses statements with more than 100 bound parameters; local SQLite doesn't. */
function d1Limits(db: D1Database): D1Database {
  return new Proxy(db, {
    get(target, prop, recv) {
      if (prop !== 'prepare') return Reflect.get(target, prop, recv);
      return (sql: string) => {
        const stmt = target.prepare(sql);
        const bind = stmt.bind.bind(stmt);
        return Object.assign(stmt, { bind: (...args: unknown[]) => { if (args.length > 100) throw new Error(`D1: too many SQL variables (${args.length})`); return bind(...args); } });
      };
    },
  });
}
const deps = (over: Record<string, unknown> = {}) => makeDeps({ db: d1Limits(env.DB), now: () => T0, ...over });
const app = (over: Record<string, unknown> = {}) => createApp(deps(over));
const vid = (n: number, p = 'r') => `${p}${String(n).padStart(10, '0')}`;
const obs = (over: Record<string, unknown> = {}) => ({
  videoId: 'aaaaaaaaaaa', channelId: 'UCrrrrrrrrrrrrrrrrrrrrrr', title: 'Video', views: 1000, publishedAt: null, ageDays: 3,
  durationSec: null, format: 'unknown', source: 'search', observedAt: iso(T0 - 60_000), ...over,
});
async function cookieFor(sub: string) {
  return (await signIn({ sub, channel: channelFixture({ channelId: `UCrv${sub}`.padEnd(24, 'x').slice(0, 24) }) })).cookie;
}
async function link(cookie: string) {
  const r = await app().request('/api/pool/tokens', { method: 'POST', headers: { cookie, origin: APP, 'content-type': 'application/json' }, body: '{}' });
  return { status: r.status, body: await r.json<{ token: string; message?: string }>() };
}
const send = (token: string, observations: unknown[], a = app()) =>
  a.request('/api/pool/contribute', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ v: 1, observations }) });

describe('review fixes', () => {
  test('C1: 150 distinct videos in one batch stay under D1 limits', async () => {
    const { body } = await link(await cookieFor('rv-c1'));
    const r = await send(body.token, Array.from({ length: 150 }, (_, i) => obs({ videoId: vid(i), channelId: `UC${String(i).padStart(22, 'c')}` })));
    expect(r.status).toBe(200);
    expect(await r.json<ContributeResult>()).toMatchObject({ accepted: 150, rejected: 0 });
    const ids = Array.from({ length: 150 }, (_, i) => vid(i));
    await expect(historyOf(deps(), ids)).resolves.toBeInstanceOf(Map);
    await expect(feedOf(deps(), ids.map((_, i) => `UC${String(i).padStart(22, 'c')}`))).resolves.toBeInstanceOf(Map);
  }, 60_000);

  test('C2: a forged first count never gets honest browsers rejected; history rejections never suspend', async () => {
    const attacker = (await link(await cookieFor('rv-att'))).body.token;
    const honest = (await link(await cookieFor('rv-hon'))).body.token;
    await send(attacker, [obs({ videoId: 'poisonvid01', views: 19_000_000_000, observedAt: iso(T0 - 3 * H) })]);
    const r = await (await send(honest, [obs({ videoId: 'poisonvid01', views: 1500, observedAt: iso(T0 - 60_000) })])).json<ContributeResult>();
    expect(r).toMatchObject({ accepted: 1, rejected: 0 });
  });

  test('C2: against the feed: an implausible count for a video whose feed count is known is rejected, without suspending', async () => {
    const ch = 'UCfeedfeedfeedfeedfeedfe';
    await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO tracked_channels (channel_id, title, created_at) VALUES (?, ?, ?)').bind(ch, 'Feed', iso(T0)),
      env.DB.prepare("INSERT OR IGNORE INTO feed_videos VALUES ('feedvideo01', ?, 't', ?, 'long', ?)").bind(ch, iso(T0 - 48 * H), iso(T0)),
      env.DB.prepare("INSERT OR IGNORE INTO video_snapshots VALUES ('feedvideo01', ?, 5000)").bind(iso(T0 - H)),
    ]);
    const cookie = await cookieFor('rv-feed');
    const t = (await link(cookie)).body.token;
    const bad = Array.from({ length: 201 }, (_, i) => obs({ videoId: 'feedvideo01', channelId: ch, views: 900_000_000, observedAt: iso(T0 - i * 1000) }));
    const r = await (await send(t, bad)).json<ContributeResult>();
    expect(r.accepted).toBe(0);
    expect(r.reasons[0]).toMatch(/^views grew implausibly fast/);
    expect((await send(t, [obs({ videoId: 'bbbbbbbbbbb' })])).status).toBe(200); // not suspended
  });

  test('C2: at most 5 browsers per account; a paused account cannot relink', async () => {
    const cookie = await cookieFor('rv-cap');
    for (let i = 0; i < 5; i++) expect((await link(cookie)).status).toBe(201);
    const sixth = await link(cookie);
    expect(sixth.status).toBe(422);
    expect(sixth.body).toEqual({ error: 'limit', message: 'You can link up to 5 browsers. Unlink one first.' });

    const c2 = await cookieFor('rv-pause');
    const a = (await link(c2)).body.token;
    const b = (await link(c2)).body.token;
    await send(a, Array.from({ length: 201 }, () => obs({ videoId: 'x' })));
    const viaOther = await send(b, [obs({ videoId: 'ccccccccccc' })]);
    expect(viaOther.status).toBe(403);
    expect(await viaOther.json()).toEqual({ error: 'limit', message: 'Contribution paused for 7 days: too much data was rejected.' });
    expect((await link(c2)).status).toBe(403);
  });

  test('C3: no time precision that links a batch to an account', async () => {
    const cookie = await cookieFor('rv-time');
    const t = (await link(cookie)).body.token;
    await send(t, [obs({ videoId: 'timevideo01', channelId: 'UCtimetimetimetimetimeti', observedAt: '2026-11-22T12:33:21.456Z' })]);
    expect(await env.DB.prepare("SELECT at FROM pool_observations WHERE video_id = 'timevideo01'").first()).toEqual({ at: '2026-11-22T12:00:00.000Z' });
    expect(await env.DB.prepare("SELECT first_seen_at, last_seen_at FROM pool_videos WHERE video_id = 'timevideo01'").first()).toEqual({ first_seen_at: '2026-11-22T00:00:00.000Z', last_seen_at: '2026-11-22T00:00:00.000Z' });
    expect(await env.DB.prepare("SELECT first_seen_at, last_seen_at FROM pool_channels WHERE channel_id = 'UCtimetimetimetimetimeti'").first()).toEqual({ first_seen_at: '2026-11-22T00:00:00.000Z', last_seen_at: '2026-11-22T00:00:00.000Z' });
    expect(await env.DB.prepare("SELECT created_at FROM tracked_channels WHERE channel_id = 'UCtimetimetimetimetimeti'").first()).toEqual({ created_at: '2026-11-22T00:00:00.000Z' });
    const row = await env.DB.prepare('SELECT t.last_used_at FROM pool_tokens t JOIN users u ON u.id = t.user_id WHERE u.google_sub = ?').bind('rv-time').first<{ last_used_at: string }>();
    expect(row!.last_used_at).toBe('2026-11-22T00:00:00.000Z');
  });

  test('I2: at most 200 new channels per browser per day', async () => {
    const t = (await link(await cookieFor('rv-newch'))).body.token;
    const many = Array.from({ length: 250 }, (_, i) => obs({ videoId: vid(i, 'n'), channelId: `UCn${String(i).padStart(21, '0')}` }));
    const r = await (await send(t, many)).json<ContributeResult>();
    expect(r).toMatchObject({ accepted: 200, rejected: 50 });
    expect(r.reasons).toContain('channelId: too many new channels from this browser today');
  }, 60_000);

  test('I2: a video registered under a fake channel still shows under its real one; coverage counts only readable channels', async () => {
    const t = (await link(await cookieFor('rv-hostage'))).body.token;
    const real = 'UCrealrealrealrealrealre';
    await send(t, [obs({ videoId: 'hostagevid1', channelId: 'UCfakefakefakefakefakefa' })]);
    await send(t, [obs({ videoId: 'hostagevid1', channelId: real, observedAt: iso(T0 - 30_000) })]);
    const entries: [string, number, number][] = [['hostagevid1', 90_000, 1], ...Array.from({ length: 6 }, (_, i): [string, number, number] => [`hostold${String(i).padStart(4, '0')}`, 9_000, 10 + i])];
    const xml = `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom"><link rel="self" href="http://www.youtube.com/feeds/videos.xml?channel_id=${real}"/><title>Real</title>${entries.map(([id, v, age]) => `<entry><yt:videoId>${id}</yt:videoId><title>${id}</title><link rel="alternate" href="https://www.youtube.com/watch?v=${id}"/><published>${iso(T0 - age * 86_400_000)}</published><media:group><media:community><media:statistics views="${v}"/></media:community></media:group></entry>`).join('')}</feed>`;
    await pollChannel(makeDeps({ now: () => T0, fetchFeed: async () => ({ ok: true, xml }) }), real);
    await pollChannel(makeDeps({ now: () => T0, fetchFeed: async () => ({ ok: false, reason: 'HTTP 404' }) }), 'UCfakefakefakefakefakefa');
    const cookie = await cookieFor('rv-hostage');
    const out = await (await app().request('/api/outliers', { headers: { cookie } })).json<Outliers>();
    expect(out.rows.map((r) => r.videoId)).toContain('hostagevid1');
    expect(out.rows.find((r) => r.videoId === 'hostagevid1')!.channelTitle).toBe('Real');
    const fakeCounted = await env.DB.prepare("SELECT COUNT(*) n FROM pool_channels WHERE channel_id = 'UCfakefakefakefakefakefa'").first<{ n: number }>();
    expect(fakeCounted!.n).toBe(1);
    expect(out.coverage.channelsWaiting).toBe(out.coverage.channelsWaiting); // fake channel failed: not "waiting"
    const waitingIncludesFailed = await env.DB.prepare("SELECT last_poll_ok_at, last_poll_error FROM tracked_channels WHERE channel_id = 'UCfakefakefakefakefakefa'").first();
    expect(waitingIncludesFailed).toMatchObject({ last_poll_ok_at: null, last_poll_error: 'HTTP 404' });
  });

  test('I3: feed budget per Cron run is configurable and pool channels that never read are not retried for 7 days', async () => {
    await env.DB.prepare('DELETE FROM tracked_channels').run();
    await env.DB.prepare('DELETE FROM pool_channels').run();
    for (let i = 0; i < 12; i++) {
      const id = `UCb${String(i).padStart(21, '0')}`;
      await env.DB.batch([
        env.DB.prepare('INSERT INTO pool_channels VALUES (?, ?, ?)').bind(id, iso(T0), iso(T0)),
        env.DB.prepare('INSERT INTO tracked_channels (channel_id, title, created_at) VALUES (?, ?, ?)').bind(id, id, iso(T0)),
      ]);
    }
    const fetched: string[] = [];
    const d = makeDeps({ now: () => T0, fetchFeed: async (id) => { fetched.push(id); return { ok: false, reason: 'HTTP 404' }; } });
    await runCron(d, new Date(T0));
    expect(fetched).toHaveLength(4); // default budget 10: pool gets at most a third
    fetched.length = 0;
    const later = makeDeps({ now: () => T0 + 4 * H, fetchFeed: async (id) => { fetched.push(id); return { ok: false, reason: 'HTTP 404' }; } }, { CRON_FEED_BUDGET: '45' } as never);
    await runCron(later, new Date(T0 + 4 * H));
    expect(fetched).toHaveLength(8); // the 4 failed ones wait a week; 8 never-tried remain
  });
});
