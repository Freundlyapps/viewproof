import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import type { ChannelRow } from '@viewproof/db';
import { accessFor, cached, ownedChannel } from '../src/channel-data';
import { createApp } from '../src/app';
import { fakeGoogle } from './fake-google';
import { channelFixture, makeDeps, post, signIn } from './helpers';

const OTHER_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
async function connected(sub: string, channelId: string) {
  const s = await signIn({ sub, channel: channelFixture({ channelId }) });
  await post(s.app, '/connect/confirm', s.cookie, { id: s.pendingId });
  const row = (await env.DB.prepare('SELECT * FROM channels WHERE channel_id = ?').bind(channelId).first<ChannelRow>())!;
  return { ...s, row };
}
const statusOf = (id: string) => env.DB.prepare('SELECT status, status_reason FROM channels WHERE id = ?').bind(id).first();
const cacheCount = async (channelId: string) => (await env.DB.prepare('SELECT COUNT(*) AS n FROM report_cache WHERE channel_id = ?').bind(channelId).first<{ n: number }>())!.n;

describe('ownedChannel', () => {
  test("own channel found, someone else's is null", async () => {
    const a = await connected('cd-own-a', 'UCcdowna');
    const b = await connected('cd-own-b', 'UCcdownb');
    const deps = makeDeps();
    expect((await ownedChannel(deps, a.row.user_id, a.row.id))?.channel_id).toBe('UCcdowna');
    expect(await ownedChannel(deps, b.row.user_id, a.row.id)).toBeNull();
  });
});

describe('accessFor', () => {
  test('fresh access token', async () => {
    const { row } = await connected('cd-ok', 'UCcdok');
    const r = await accessFor(makeDeps({ google: fakeGoogle({ refresh: async () => ({ accessToken: 'fresh' }) }) }), row);
    expect(r).toMatchObject({ accessToken: 'fresh', channel: { id: row.id } });
  });

  test('revoked marks reconnect', async () => {
    const { row } = await connected('cd-rev', 'UCcdrev');
    const r = await accessFor(makeDeps({ google: fakeGoogle({ refresh: async () => ({ kind: 'revoked' }) }) }), row);
    expect(r).toMatchObject({ error: 'reconnect' });
    expect(await statusOf(row.id)).toEqual({ status: 'reconnect', status_reason: 'Google access was removed or expired' });
  });

  test('unreadable token marks reconnect', async () => {
    const { row } = await connected('cd-key', 'UCcdkey');
    const r = await accessFor(makeDeps({}, { TOKEN_KEY: OTHER_KEY }), row);
    expect(r).toMatchObject({ error: 'reconnect' });
    expect(await statusOf(row.id)).toEqual({ status: 'reconnect', status_reason: "Stored access can't be read; reconnect" });
  });

  test('gone channel never calls Google', async () => {
    const { row } = await connected('cd-gone', 'UCcdgone');
    const g = fakeGoogle();
    expect(await accessFor(makeDeps({ google: g }), { ...row, status: 'gone' })).toMatchObject({ error: 'gone' });
    expect(g.calls).toEqual([]);
  });

  test('other Google failures are reported, status unchanged', async () => {
    const { row } = await connected('cd-fail', 'UCcdfail');
    const r = await accessFor(makeDeps({ google: fakeGoogle({ refresh: async () => ({ kind: 'failed', reason: 'HTTP 503' }) }) }), row);
    expect(r).toEqual({ error: 'google_failed', message: 'Google sign-in service failed: HTTP 503' });
    expect(await statusOf(row.id)).toEqual({ status: 'active', status_reason: null });
  });
});

describe('cached', () => {
  test('within TTL no reload; after TTL reload; errors not stored', async () => {
    const { row } = await connected('cd-cache', 'UCcdcache');
    let t = Date.parse('2026-11-21T10:00:00Z');
    const deps = makeDeps({ now: () => t });
    let loads = 0;
    const load = async () => ({ n: ++loads });
    expect(await cached(deps, row.id, 'k', 60_000, load)).toEqual({ n: 1 });
    t += 30_000;
    expect(await cached(deps, row.id, 'k', 60_000, load)).toEqual({ n: 1 });
    t += 60_000;
    expect(await cached(deps, row.id, 'k', 60_000, load)).toEqual({ n: 2 });
    expect(await cached(deps, row.id, 'err', 60_000, async () => ({ kind: 'failed' as const, reason: 'x' }))).toEqual({ kind: 'failed', reason: 'x' });
    expect(await env.DB.prepare("SELECT key FROM report_cache WHERE channel_id = ? AND key = 'err'").bind(row.id).first()).toBeNull();
  });

  test('removing a channel or deleting the account leaves no cached reports', async () => {
    const a = await connected('cd-rm', 'UCcdrm');
    const b = await connected('cd-del', 'UCcddel');
    for (const r of [a.row, b.row]) await cached(makeDeps(), r.id, 'k', 60_000, async () => ({ x: 1 }));
    const app = createApp(makeDeps());
    await post(app, `/channels/${a.row.id}/remove`, a.cookie);
    await post(app, '/account/delete', b.cookie, { confirm: 'delete' });
    expect(await cacheCount(a.row.id)).toBe(0);
    expect(await cacheCount(b.row.id)).toBe(0);
  });
});
