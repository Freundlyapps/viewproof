import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import type { Outliers } from '@viewproof/core';
import { createApp } from '../src/app';
import { pollChannel } from '../src/competitors/poll';
import { channelFixture, makeDeps, signIn } from './helpers';

const T0 = Date.parse('2026-11-22T12:00:00Z');
const D = 86_400_000;
const iso = (t: number) => new Date(t).toISOString();

/** A channel feed: entries newest first; each [videoId, views, ageDays, 'long'|'short', title]. */
function feed(channelId: string, title: string, entries: [string, number, number, 'long' | 'short', string?][]) {
  const items = entries.map(([id, views, age, fmt, t]) => `<entry><id>yt:video:${id}</id><yt:videoId>${id}</yt:videoId><yt:channelId>${channelId}</yt:channelId>
    <title>${t ?? `Video ${id}`}</title><link rel="alternate" href="https://www.youtube.com/${fmt === 'short' ? `shorts/${id}` : `watch?v=${id}`}"/>
    <published>${iso(T0 - age * D)}</published><media:group><media:community><media:statistics views="${views}"/></media:community></media:group></entry>`).join('');
  return `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
    <link rel="self" href="http://www.youtube.com/feeds/videos.xml?channel_id=${channelId}"/><yt:channelId>${channelId.slice(2)}</yt:channelId><title>${title}</title>${items}</feed>`;
}
const vid = (p: string, n: number) => `${p}${String(n).padStart(11 - p.length, '0')}`;
/** 1 recent video with `views`, then `n` earlier long videos at `base` views. */
function channel(p: string, recentViews: number, base: number, opts: { fmt?: 'long' | 'short'; age?: number; title?: string } = {}): [string, number, number, 'long' | 'short', string?][] {
  return [[vid(p, 0), recentViews, opts.age ?? 3, opts.fmt ?? 'long', opts.title], ...Array.from({ length: 8 }, (_, i) => [vid(p, i + 1), base, 10 + i * 5, opts.fmt ?? 'long'] as [string, number, number, 'long' | 'short'])];
}

async function seed(channelId: string, title: string, entries: ReturnType<typeof channel>, poll = true) {
  await env.DB.batch([
    env.DB.prepare('INSERT OR REPLACE INTO pool_channels VALUES (?, ?, ?)').bind(channelId, iso(T0 - D), iso(T0 - D)),
    env.DB.prepare('INSERT OR IGNORE INTO tracked_channels (channel_id, title, created_at) VALUES (?, ?, ?)').bind(channelId, channelId, iso(T0 - D)),
    // The pool saw the recent video only.
    env.DB.prepare("INSERT OR REPLACE INTO pool_videos VALUES (?, ?, 'pool title', NULL, 'unknown', NULL, ?, ?)").bind(entries[0]![0], channelId, iso(T0 - D), iso(T0 - D)),
  ]);
  if (poll) await pollChannel(makeDeps({ now: () => T0 - 3600_000, fetchFeed: async () => ({ ok: true, xml: feed(channelId, title, entries) }) }), channelId);
}

let cookie = '';
const get = async (q = '') => {
  if (!cookie) cookie = (await signIn({ sub: 'ol-user', channel: channelFixture({ channelId: 'UColuserxxxxxxxxxxxxxxx' }) })).cookie;
  const r = await createApp(makeDeps({ now: () => T0, fetchFeed: async () => { throw new Error('outliers must not fetch feeds'); } })).request(`/api/outliers${q}`, { headers: { cookie } });
  expect(r.status).toBe(200);
  return r.json<Outliers>();
};

describe('outliers', () => {
  test('setup', async () => {
    await env.DB.prepare('DELETE FROM pool_channels').run();
    await seed('UCaaaaaaaaaaaaaaaaaaaaaa', 'Small Pottery', channel('sa', 50_000, 5_000, { title: 'Throwing a big bowl' }));      // ×10, median 5k (small)
    await seed('UCbbbbbbbbbbbbbbbbbbbbbb', 'Medium Clay', channel('mb', 90_000, 30_000));                                       // ×3, median 30k (medium)
    await seed('UCcccccccccccccccccccccc', 'Big Shorts', channel('lc', 1_000_000, 200_000, { fmt: 'short' }));                // ×5 Short, median 200k (large)
    await seed('UCdddddddddddddddddddddd', 'Steady', channel('dd', 11_000, 10_000));                                          // ×1.1 — below min
    await seed('UCeeeeeeeeeeeeeeeeeeeeee', 'Old one', channel('ee', 100_000, 1_000, { age: 2 }).map((e, i) => (i === 0 ? [e[0], e[1], 200, e[3]] : [e[0], e[1], 300 + i, e[3]])) as ReturnType<typeof channel>); // 200 days old
    await seed('UCffffffffffffffffffffff', 'Not polled yet', channel('ff', 99_999, 1), false);
  });

  test('outlier found and sorted by ×N; values from the feed', async () => {
    const r = await get();
    expect(r.rows.map((x) => [x.channelTitle, x.outlier.kind === 'value' ? x.outlier.value : null])).toEqual([['Small Pottery', 10], ['Big Shorts', 5], ['Medium Clay', 3]]);
    expect(r.rows[0]).toMatchObject({ videoId: vid('sa', 0), title: 'Throwing a big bowl', views: { kind: 'value', value: 50_000 }, channelMedian: { kind: 'value', value: 5_000 } });
  });

  test('filters: format, days, size, q, min', async () => {
    expect((await get('?format=short')).rows.map((x) => x.channelTitle)).toEqual(['Big Shorts']);
    expect((await get('?format=long')).rows.map((x) => x.channelTitle)).toEqual(['Small Pottery', 'Medium Clay']);
    expect((await get('?days=365')).rows.map((x) => x.channelTitle)).toContain('Old one');
    expect((await get('?size=small')).rows.map((x) => x.channelTitle)).toEqual(['Small Pottery']);
    expect((await get('?size=medium')).rows.map((x) => x.channelTitle)).toEqual(['Medium Clay']);
    expect((await get('?size=large')).rows.map((x) => x.channelTitle)).toEqual(['Big Shorts']);
    expect((await get('?q=bowl')).rows.map((x) => x.channelTitle)).toEqual(['Small Pottery']);
    expect((await get('?q=bow')).rows).toEqual([]);
    expect((await get('?min=5')).rows.map((x) => x.channelTitle)).toEqual(['Small Pottery', 'Big Shorts']);
    expect((await get('?min=1.5&format=long')).rows.map((x) => x.channelTitle)).toEqual(['Small Pottery', 'Medium Clay']);
  });

  test('unpolled channel: not listed, counted as waiting', async () => {
    const r = await get('?min=1.5&days=365');
    expect(r.rows.map((x) => x.channelTitle)).not.toContain('Not polled yet');
    expect(r.coverage).toEqual({ videos: 6, channels: 6, channelsWaiting: 1, days: 30 });
  });

  test('bad filter values fall back to defaults', async () => {
    expect((await get('?format=zzz&days=2&min=0&size=huge')).rows.map((x) => x.channelTitle)).toEqual(['Small Pottery', 'Big Shorts', 'Medium Clay']);
  });

  test('signed out → 401', async () => {
    expect((await createApp(makeDeps()).request('/api/outliers')).status).toBe(401);
  });
});
