import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import feedXml from '../../../packages/core/test/fixtures/feed-long.xml?raw';
import { pollChannel, pollStale, pruneCompetitors } from '../src/competitors/poll';
import { makeDeps } from './helpers';

const CH = 'UCHnyfMqiRRG1u-2MsSQLbXA';
const T0 = Date.parse('2026-11-21T12:00:00Z');
const H = 3_600_000;
async function track(id: string, polledAt: string | null = null) {
  await env.DB.prepare('INSERT OR REPLACE INTO tracked_channels (channel_id, title, last_polled_at, created_at) VALUES (?, ?, ?, ?)').bind(id, 'T', polledAt, '2026-11-01T00:00:00Z').run();
}
const count = async (sql: string, ...b: unknown[]) => (await env.DB.prepare(sql).bind(...b).first<{ n: number }>())!.n;
function feeds(xml: () => string | { fail: string }) {
  const calls: string[] = [];
  return { calls, fetchFeed: async (id: string) => { calls.push(id); const x = xml(); return typeof x === 'string' ? { ok: true as const, xml: x } : { ok: false as const, reason: x.fail }; } };
}
const bump = (xml: string, by: number) => xml.replace(/views="(\d+)"/g, (_m, v) => `views="${Number(v) + by}"`);

describe('pollChannel', () => {
  test('first poll stores videos and snapshots', async () => {
    await track(CH);
    const f = feeds(() => feedXml);
    expect(await pollChannel(makeDeps({ fetchFeed: f.fetchFeed, now: () => T0 }), CH)).toBe('polled');
    expect(await count('SELECT COUNT(*) n FROM feed_videos WHERE channel_id = ?', CH)).toBe(15);
    expect(await count('SELECT COUNT(*) n FROM video_snapshots s JOIN feed_videos v USING (video_id) WHERE v.channel_id = ?', CH)).toBe(15);
    const ch = await env.DB.prepare('SELECT last_polled_at, last_poll_ok_at, last_poll_error FROM tracked_channels WHERE channel_id = ?').bind(CH).first();
    expect(ch).toEqual({ last_polled_at: new Date(T0).toISOString(), last_poll_ok_at: new Date(T0).toISOString(), last_poll_error: null });
  });

  test('skipped within 3 h; unchanged views write no snapshot within 24 h; changed views do', async () => {
    const id = 'UCaaaaaaaaaaaaaaaaaaaaaa';
    await track(id);
    let xml = feedXml.replaceAll(CH, id).replace(/<yt:videoId>([\w-]+)<\/yt:videoId>/g, (_m, v) => `<yt:videoId>a${v}</yt:videoId>`);
    const f = feeds(() => xml);
    const at = (t: number) => makeDeps({ fetchFeed: f.fetchFeed, now: () => t });
    await pollChannel(at(T0), id);
    expect(await pollChannel(at(T0 + 2 * H), id)).toBe('skipped');
    expect(f.calls).toHaveLength(1);
    await pollChannel(at(T0 + 4 * H), id);
    const snaps = 'SELECT COUNT(*) n FROM video_snapshots s JOIN feed_videos v USING (video_id) WHERE v.channel_id = ?';
    expect(await count(snaps, id)).toBe(15);
    xml = bump(xml, 10);
    await pollChannel(at(T0 + 8 * H), id);
    expect(await count(snaps, id)).toBe(30);
    xml = bump(xml, -10);
    xml = bump(xml, 10);
    await pollChannel(at(T0 + 33 * H), id);
    expect(await count(snaps, id)).toBe(45); // unchanged, but the latest is ≥ 24 h old
  });

  test('failed poll keeps data and records the reason', async () => {
    const id = 'UCbbbbbbbbbbbbbbbbbbbbbb';
    await track(id);
    let answer: string | { fail: string } = feedXml.replaceAll(CH, id).replace(/<yt:videoId>([\w-]+)<\/yt:videoId>/g, (_m, v) => `<yt:videoId>b${v}</yt:videoId>`);
    const f = feeds(() => answer);
    await pollChannel(makeDeps({ fetchFeed: f.fetchFeed, now: () => T0 }), id);
    answer = { fail: 'HTTP 404' };
    expect(await pollChannel(makeDeps({ fetchFeed: f.fetchFeed, now: () => T0 + 4 * H }), id)).toEqual({ error: 'HTTP 404' });
    answer = '<html>consent</html>';
    expect(await pollChannel(makeDeps({ fetchFeed: f.fetchFeed, now: () => T0 + 8 * H }), id)).toEqual({ error: 'not a YouTube feed (no <feed> element)' });
    const ch = await env.DB.prepare('SELECT last_poll_ok_at, last_poll_error FROM tracked_channels WHERE channel_id = ?').bind(id).first();
    expect(ch).toEqual({ last_poll_ok_at: new Date(T0).toISOString(), last_poll_error: 'not a YouTube feed (no <feed> element)' });
    expect(await count('SELECT COUNT(*) n FROM feed_videos WHERE channel_id = ?', id)).toBe(15);
  });
});

test('videos gone from the feed (deleted, private, aged out) are dropped with their snapshots', async () => {
  const id = 'UCiiiiiiiiiiiiiiiiiiiiii';
  await track(id);
  let xml = feedXml.replaceAll(CH, id).replace(/<yt:videoId>([\w-]+)<\/yt:videoId>/g, (_m: string, v: string) => `<yt:videoId>i${v}</yt:videoId>`);
  const f = feeds(() => xml);
  await pollChannel(makeDeps({ fetchFeed: f.fetchFeed, now: () => T0 }), id);
  const first = /<yt:videoId>([\w-]+)<\/yt:videoId>/.exec(xml)![1]!;
  xml = xml.replace(/<entry>[\s\S]*?<\/entry>/, '');
  await pollChannel(makeDeps({ fetchFeed: f.fetchFeed, now: () => T0 + 4 * H }), id);
  expect(await count('SELECT COUNT(*) n FROM feed_videos WHERE channel_id = ?', id)).toBe(14);
  expect(await count('SELECT COUNT(*) n FROM video_snapshots WHERE video_id = ?', first)).toBe(0);
});

test('pollStale: never-polled and oldest first, capped', async () => {
  await env.DB.prepare("DELETE FROM tracked_channels").run();
  await track('UCcccccccccccccccccccccc', '2026-11-21T01:00:00.000Z');
  await track('UCdddddddddddddddddddddd', null);
  await track('UCeeeeeeeeeeeeeeeeeeeeee', '2026-11-21T00:00:00.000Z');
  await track('UCffffffffffffffffffffff', '2026-11-21T11:00:00.000Z');
  const f = feeds(() => ({ fail: 'x' }));
  expect(await pollStale(makeDeps({ fetchFeed: f.fetchFeed, now: () => T0 }), 2)).toBe(2);
  expect(f.calls).toEqual(['UCdddddddddddddddddddddd', 'UCeeeeeeeeeeeeeeeeeeeeee']);
});

test('prune: untracked channels go with their data; old snapshots and 30-day-old stats go', async () => {
  await env.DB.prepare("DELETE FROM tracked_channels").run();
  await track('UCgggggggggggggggggggggg');
  await env.DB.prepare("INSERT INTO feed_videos VALUES ('g1', 'UCgggggggggggggggggggggg', 't', '2026-01-01T00:00:00Z', 'long', '2026-01-01T00:00:00Z')").run();
  await env.DB.prepare("INSERT INTO video_snapshots VALUES ('g1', '2026-08-01T00:00:00.000Z', 5)").run();
  await env.DB.prepare("INSERT INTO users (id, google_sub, email, name, plan, created_at) VALUES ('pr-u', 'sub-pr-u', 'x@example.com', 'x', 'free', '2026-01-01T00:00:00Z')").run();
  await track('UChhhhhhhhhhhhhhhhhhhhhh');
  await env.DB.prepare("UPDATE tracked_channels SET subscribers = 9, stats_at = '2026-10-01T00:00:00.000Z' WHERE channel_id = 'UChhhhhhhhhhhhhhhhhhhhhh'").run();
  await env.DB.prepare("INSERT INTO user_competitors VALUES ('pr-u', 'UChhhhhhhhhhhhhhhhhhhhhh', '2026-11-01T00:00:00Z')").run();
  await env.DB.prepare("INSERT INTO feed_videos VALUES ('h1', 'UChhhhhhhhhhhhhhhhhhhhhh', 't', '2026-01-01T00:00:00Z', 'long', '2026-01-01T00:00:00Z')").run();
  await env.DB.prepare("INSERT INTO video_snapshots VALUES ('h1', '2026-08-01T00:00:00.000Z', 5), ('h1', '2026-11-20T00:00:00.000Z', 6)").run();
  await pruneCompetitors(makeDeps({ now: () => T0 }));
  expect(await count("SELECT COUNT(*) n FROM tracked_channels WHERE channel_id = 'UCgggggggggggggggggggggg'")).toBe(0);
  expect(await count("SELECT COUNT(*) n FROM video_snapshots WHERE video_id = 'g1'")).toBe(0);
  expect(await count("SELECT COUNT(*) n FROM video_snapshots WHERE video_id = 'h1'")).toBe(1);
  expect(await env.DB.prepare("SELECT subscribers, stats_at FROM tracked_channels WHERE channel_id = 'UChhhhhhhhhhhhhhhhhhhhhh'").first()).toEqual({ subscribers: null, stats_at: null });
});
