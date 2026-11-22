import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import feedXml from '../../../packages/core/test/fixtures/feed-long.xml?raw';
import { archiveDay } from '../src/pool/archive';
import { runCron } from '../src/competitors/cron';
import { makeDeps } from './helpers';

const T0 = Date.parse('2026-11-22T12:00:00Z');
const D = 86_400_000;
const VERI = 'UCHnyfMqiRRG1u-2MsSQLbXA';
const idN = (n: number) => `UCp${String(n).padStart(21, '0')}`;
const feedFor = (id: string) => feedXml.replaceAll(VERI, id).replaceAll('HnyfMqiRRG1u-2MsSQLbXA', id.slice(2)).replace(/<yt:videoId>([\w-]+)<\/yt:videoId>/g, (_m: string, v: string) => `<yt:videoId>${id.slice(-4)}${v.slice(4)}</yt:videoId>`);
const iso = (t: number) => new Date(t).toISOString();

async function poolChannel(id: string, seenAt: number) {
  await env.DB.batch([
    env.DB.prepare('INSERT OR REPLACE INTO pool_channels (channel_id, first_seen_at, last_seen_at) VALUES (?, ?, ?)').bind(id, iso(seenAt), iso(seenAt)),
    env.DB.prepare('INSERT OR IGNORE INTO tracked_channels (channel_id, title, created_at) VALUES (?, ?, ?)').bind(id, id, iso(seenAt)),
  ]);
}
function deps(now: number, extra: Record<string, unknown> = {}) {
  const fetched: string[] = [];
  return { fetched, deps: makeDeps({ now: () => now, fetchFeed: async (id) => { fetched.push(id); return { ok: true, xml: feedFor(id) }; }, ...extra }) };
}

describe('pool cron', () => {
  test('pool channels are polled after tracked ones, within budgets; titles come from the feed', async () => {
    await env.DB.prepare('DELETE FROM tracked_channels').run();
    for (let i = 0; i < 20; i++) await poolChannel(idN(i), T0 - D);
    const d = deps(T0);
    await runCron(d.deps, new Date(T0));
    expect(d.fetched).toHaveLength(15);
    expect(await env.DB.prepare('SELECT title FROM tracked_channels WHERE channel_id = ?').bind(d.fetched[0]).first()).toEqual({ title: 'Veritasium' });
  });

  test('a pool channel not seen for 30 days is pruned and no longer polled', async () => {
    await env.DB.prepare('DELETE FROM tracked_channels').run();
    await env.DB.prepare('DELETE FROM pool_channels').run();
    await poolChannel(idN(50), T0 - 31 * D);
    await env.DB.prepare("INSERT INTO pool_videos VALUES ('p50xxxxxxxx', ?, 't', NULL, 'long', NULL, ?, ?)").bind(idN(50), iso(T0 - 31 * D), iso(T0 - 31 * D)).run();
    const d = deps(T0);
    await runCron(d.deps, new Date(T0));
    expect(d.fetched).not.toContain(idN(50));
    expect(await env.DB.prepare('SELECT COUNT(*) n FROM pool_channels WHERE channel_id = ?').bind(idN(50)).first()).toEqual({ n: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM pool_videos WHERE video_id = 'p50xxxxxxxx'").first()).toEqual({ n: 0 });
    expect(await env.DB.prepare('SELECT COUNT(*) n FROM tracked_channels WHERE channel_id = ?').bind(idN(50)).first()).toEqual({ n: 0 });
  });

  test('archive writes one gzipped NDJSON per day, once', async () => {
    await poolChannel(idN(60), T0);
    await env.DB.prepare("INSERT OR IGNORE INTO pool_videos VALUES ('p60xxxxxxxx', ?, 't', NULL, 'long', NULL, ?, ?)").bind(idN(60), iso(T0), iso(T0)).run();
    await env.DB.prepare("INSERT OR IGNORE INTO pool_observations VALUES ('p60xxxxxxxx', '2026-11-21T08:00:00.000Z', 10, 'watch'), ('p60xxxxxxxx', '2026-11-21T20:00:00.000Z', 20, 'search'), ('p60xxxxxxxx', '2026-11-22T01:00:00.000Z', 30, 'watch')").run();
    const d = makeDeps({ now: () => T0, pool: env.POOL });
    expect(await archiveDay(d, '2026-11-21')).toBe('written');
    expect(await archiveDay(d, '2026-11-21')).toBe('exists');
    const obj = await env.POOL!.get('pool/2026/11/21.ndjson.gz');
    const text = await new Response(obj!.body.pipeThrough(new DecompressionStream('gzip'))).text();
    const lines = text.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.filter((l) => l.videoId === 'p60xxxxxxxx')).toEqual([
      { videoId: 'p60xxxxxxxx', channelId: idN(60), at: '2026-11-21T08:00:00.000Z', views: 10, source: 'watch' },
      { videoId: 'p60xxxxxxxx', channelId: idN(60), at: '2026-11-21T20:00:00.000Z', views: 20, source: 'search' },
    ]);
  });

  test('no R2 binding → archive skipped', async () => {
    expect(await archiveDay(makeDeps({ now: () => T0 }), '2026-11-21')).toBe('skipped');
  });

  test('cron at 04 UTC archives yesterday', async () => {
    const at = Date.parse('2026-11-23T04:17:00Z');
    await runCron(makeDeps({ now: () => at, pool: env.POOL, fetchFeed: async () => ({ ok: false, reason: 'x' }) }), new Date(at));
    expect(await env.POOL!.head('pool/2026/11/22.ndjson.gz')).not.toBeNull();
  });
});
