import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import type { OptimizeVideo } from '@viewproof/core';
import type { ChannelRow } from '@viewproof/db';
import { createApp } from '../src/app';
import { httpYouTubeClient, type ReportQuery, type VideoDetails, type YouTubeClient } from '../src/youtube';
import { fakeGoogle } from './fake-google';
import { fakeYouTube } from './fake-youtube';
import { channelFixture, makeDeps, post, signIn } from './helpers';

const NOW = Date.parse('2026-11-21T12:00:00Z');
const VID = 'abcdefghijk';
async function connected(sub: string, channelId: string) {
  const s = await signIn({ sub, channel: channelFixture({ channelId }) });
  await post(s.app, '/connect/confirm', s.cookie, { id: s.pendingId });
  const row = (await env.DB.prepare('SELECT * FROM channels WHERE channel_id = ?').bind(channelId).first<ChannelRow>())!;
  return { cookie: s.cookie, row };
}
function appWith(yt: Partial<YouTubeClient>) {
  const youtube = fakeYouTube(yt);
  return { app: createApp(makeDeps({ youtube, google: fakeGoogle({ refresh: async () => ({ accessToken: 'at' }) }), now: () => NOW })), youtube };
}
const details = (over: Partial<VideoDetails> = {}): VideoDetails => ({
  videoId: VID, channelId: 'UCopt1', title: 'What OK means', description: 'The origin of OK.', tags: ['ok', 'word history'], publishedAt: '2026-10-01T00:00:00Z', durationSec: 600, ...over,
});
const cols = ['insightTrafficSourceDetail', 'views', 'estimatedMinutesWatched'];
const report = async (_t: string, q: ReportQuery) => {
  if (q.dimensions?.[0] === 'day') return { columns: ['day', 'views'], rows: [['2026-11-19', 3]] };
  if (q.filters?.includes(`video==${VID}`)) return { columns: cols, rows: [['okay meaning', 30, 9], ['ok origin', 10, 3]] };
  return { columns: cols, rows: [] };
};

describe('GET /api/channels/:id/optimize/:videoId', () => {
  test('video details with its own search terms', async () => {
    const { cookie, row } = await connected('opt-1', 'UCopt1');
    const { app, youtube } = appWith({ video: async () => details(), report });
    const res = await app.request(`/api/channels/${row.id}/optimize/${VID}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const b = await res.json() as OptimizeVideo;
    expect(b.video).toMatchObject({ title: 'What OK means', description: 'The origin of OK.', tags: ['ok', 'word history'] });
    expect(b.terms).toEqual([{ term: 'okay meaning', views: 30 }, { term: 'ok origin', views: 10 }]);
    expect(b.termsNote).toBeNull();
    expect(b.period.end).toBeTruthy();
    const q = youtube.calls.filter((c) => c.method === 'report').map((c) => c.arg as ReportQuery).find((x) => x.filters?.includes('video=='));
    expect(q!.filters).toBe(`insightTrafficSourceType==YT_SEARCH;video==${VID}`);
    // Second call: from the cache, no new video lookup.
    await app.request(`/api/channels/${row.id}/optimize/${VID}`, { headers: { cookie } });
    expect(youtube.calls.filter((c) => c.method === 'video')).toHaveLength(1);
  });

  test("another channel's video → 404", async () => {
    const { cookie, row } = await connected('opt-2', 'UCopt2');
    const { app } = appWith({ video: async () => details({ channelId: 'UCsomeoneelse' }), report });
    const res = await app.request(`/api/channels/${row.id}/optimize/${VID}`, { headers: { cookie } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found', message: 'Video not found on this channel.' });
  });

  test('unknown video → 404; bad id → 400', async () => {
    const { cookie, row } = await connected('opt-3', 'UCopt3');
    const { app } = appWith({ video: async () => null, report });
    expect((await app.request(`/api/channels/${row.id}/optimize/${VID}`, { headers: { cookie } })).status).toBe(404);
    expect((await app.request(`/api/channels/${row.id}/optimize/bad id!`, { headers: { cookie } })).status).toBe(400);
  });

  test('no search terms → the note', async () => {
    const { cookie, row } = await connected('opt-4', 'UCopt4');
    const { app } = appWith({ video: async () => details({ channelId: 'UCopt4' }), report: async (_t, q) => (q.dimensions?.[0] === 'day' ? { columns: ['day', 'views'], rows: [] } : { columns: cols, rows: [] }) });
    const b = await (await app.request(`/api/channels/${row.id}/optimize/${VID}`, { headers: { cookie } })).json() as OptimizeVideo;
    expect(b.terms).toEqual([]);
    expect(b.termsNote).toContain('enough people searched');
  });
});

describe('httpYouTubeClient.video', () => {
  const fetchWith = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
  test('reads snippet; missing tags means none', async () => {
    const yt = httpYouTubeClient(fetchWith({ kind: 'youtube#videoListResponse', items: [{ id: VID, snippet: { channelId: 'UCx', title: 'T', description: 'D', publishedAt: '2026-10-01T00:00:00Z' }, contentDetails: { duration: 'PT10M' } }] }));
    expect(await yt.video('at', VID)).toEqual({ videoId: VID, channelId: 'UCx', title: 'T', description: 'D', tags: [], publishedAt: '2026-10-01T00:00:00Z', durationSec: 600 });
  });
  test('no item → null', async () => {
    expect(await httpYouTubeClient(fetchWith({ kind: 'youtube#videoListResponse', items: [] })).video('at', VID)).toBeNull();
  });
});
