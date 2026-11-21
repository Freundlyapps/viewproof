import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import type { Earnings, SearchTerms, UploadTimes } from '@viewproof/core';
import type { ChannelRow } from '@viewproof/db';
import { createApp } from '../src/app';
import { SCOPES } from '../src/google';
import type { ReportQuery, Upload, YouTubeClient } from '../src/youtube';
import { fakeGoogle } from './fake-google';
import { fakeYouTube } from './fake-youtube';
import { ALL_SCOPES, channelFixture, makeDeps, post, signIn } from './helpers';

const NOW = Date.parse('2026-11-21T12:00:00Z');
async function connected(sub: string, channelId: string, revenue = false) {
  const s = await signIn({ sub, channel: channelFixture({ channelId }), scopes: revenue ? [...ALL_SCOPES, SCOPES.revenue] : ALL_SCOPES, query: revenue ? '?revenue=1' : '' });
  await post(s.app, '/connect/confirm', s.cookie, { id: s.pendingId });
  const row = (await env.DB.prepare('SELECT * FROM channels WHERE channel_id = ?').bind(channelId).first<ChannelRow>())!;
  return { cookie: s.cookie, row };
}
function appWith(yt: Partial<YouTubeClient>) {
  const youtube = fakeYouTube(yt);
  return { app: createApp(makeDeps({ youtube, google: fakeGoogle({ refresh: async () => ({ accessToken: 'at' }) }), now: () => NOW })), youtube };
}
const getJson = async <T>(app: ReturnType<typeof createApp>, path: string, cookie: string) => (await app.request(path, { headers: { cookie } })).json() as Promise<T>;
const up = (videoId: string, title: string, publishedAt = '2026-10-01T10:00:00Z'): Upload => ({ videoId, title, publishedAt, durationSec: 600, views: 100, thumbnailUrl: null });
const reports = (yt: ReturnType<typeof appWith>['youtube']) => yt.calls.filter((c) => c.method === 'report').map((c) => c.arg as ReportQuery);

describe('search terms', () => {
  test('terms with previous-period views and the video that got most views for each', async () => {
    const { cookie, row } = await connected('cm-terms', 'UCcmterms');
    const { app, youtube } = appWith({
      uploads: async () => [up('v1', 'Trim a bowl'), up('v2', 'Glaze tests')],
      report: async (_t, q) => {
        const cols = ['insightTrafficSourceDetail', 'views', 'estimatedMinutesWatched'];
        if (q.dimensions?.[0] === 'video') return { columns: ['video', 'views'], rows: [['v1', 90], ['v2', 40]] };
        if (q.filters?.includes('video==v1')) return { columns: cols, rows: [['how to trim a bowl', 50, 200], ['glaze', 1, 2]] };
        if (q.filters?.includes('video==v2')) return { columns: cols, rows: [['glaze', 30, 90]] };
        if (q.startDate === '2026-10-25') return { columns: cols, rows: [['how to trim a bowl', 60, 240], ['glaze', 31, 92], ['kiln', 5, 9]] };
        return { columns: cols, rows: [['how to trim a bowl', 44, 100]] };
      },
    });
    const r = await getJson<SearchTerms>(app, `/api/channels/${row.id}/search-terms?range=28d`, cookie);
    expect(r.terms).toEqual([
      { term: 'how to trim a bowl', views: 60, watchMinutes: 240, previousViews: expect.objectContaining({ kind: 'value', value: 44 }), topVideo: { videoId: 'v1', title: 'Trim a bowl' } },
      { term: 'glaze', views: 31, watchMinutes: 92, previousViews: { kind: 'no_data', reason: "Not in YouTube's top 25 for the previous period" }, topVideo: { videoId: 'v2', title: 'Glaze tests' } },
      { term: 'kiln', views: 5, watchMinutes: 9, previousViews: { kind: 'no_data', reason: "Not in YouTube's top 25 for the previous period" }, topVideo: null },
    ]);
    expect(r.note).toBeNull();
    const main = reports(youtube).find((q) => q.startDate === '2026-10-25' && q.dimensions?.[0] === 'insightTrafficSourceDetail' && q.filters === 'insightTrafficSourceType==YT_SEARCH');
    expect(main).toMatchObject({ sort: '-views', maxResults: 25, metrics: ['views', 'estimatedMinutesWatched'] });
    expect(reports(youtube).find((q) => q.dimensions?.[0] === 'video')).toMatchObject({ sort: '-views', maxResults: 10 });
  });

  test('no terms explains the threshold', async () => {
    const { cookie, row } = await connected('cm-noterms', 'UCcmnoterms');
    const r = await getJson<SearchTerms>(appWith({}).app, `/api/channels/${row.id}/search-terms`, cookie);
    expect(r.terms).toEqual([]);
    expect(r.note).toBe("YouTube lists search terms only once enough people searched; it doesn't publish the threshold.");
  });
});

describe('earnings', () => {
  test('without revenue access: not_granted and no Google call', async () => {
    const { cookie, row } = await connected('cm-nogrant', 'UCcmnogrant');
    const { app, youtube } = appWith({});
    expect(await getJson<Earnings>(app, `/api/channels/${row.id}/earnings`, cookie)).toEqual({ status: 'not_granted' });
    expect(youtube.calls).toEqual([]);
  });

  test('forbidden revenue: not_available with YouTube’s reason', async () => {
    const { cookie, row } = await connected('cm-forbid', 'UCcmforbid', true);
    const r = await getJson<Earnings>(appWith({ report: async () => ({ kind: 'forbidden', reason: 'The channel is not part of the YouTube Partner Program.' }) }).app, `/api/channels/${row.id}/earnings`, cookie);
    expect(r).toEqual({ status: 'not_available', reason: 'The channel is not part of the YouTube Partner Program.' });
  });

  test('revenue totals and top videos', async () => {
    const { cookie, row } = await connected('cm-rev', 'UCcmrev', true);
    const { app, youtube } = appWith({
      uploads: async () => [up('v1', 'Centering')],
      report: async (_t, q) => {
        const m = ['estimatedRevenue', 'playbackBasedCpm', 'monetizedPlaybacks'];
        if (q.dimensions?.[0] === 'video') return { columns: ['video', 'estimatedRevenue', 'playbackBasedCpm'], rows: [['v1', 141.2, 6.1]] };
        return q.startDate === '2026-10-25' ? { columns: m, rows: [[412.8, 5.9, 61000]] } : { columns: m, rows: [[378, 5.5, 58000]] };
      },
    });
    const r = await getJson<Earnings>(app, `/api/channels/${row.id}/earnings?range=28d`, cookie);
    if (r.status !== 'ok') throw new Error(`unexpected ${r.status}`);
    expect(r.totals.estimatedRevenue.current).toMatchObject({ kind: 'value', value: 412.8 });
    expect(r.totals.estimatedRevenue.previous).toMatchObject({ kind: 'value', value: 378 });
    expect(r.totals.monetizedPlaybacks.current).toMatchObject({ kind: 'value', value: 61000 });
    expect(r.topVideos).toEqual([{ videoId: 'v1', title: 'Centering', estimatedRevenue: 141.2, playbackBasedCpm: expect.objectContaining({ kind: 'value', value: 6.1 }) }]);
    expect(reports(youtube).find((q) => q.dimensions?.[0] === 'video')).toMatchObject({ sort: '-estimatedRevenue', maxResults: 10 });
  });
});

describe('upload times', () => {
  test('first-week views of uploads at least 10 days old, cached per video', async () => {
    const { cookie, row } = await connected('cm-times', 'UCcmtimes');
    const uploads = async () => [up('new', 'Too new', '2026-11-15T09:00:00Z'), up('old', 'Old one', '2026-11-01T18:30:00Z'), up('quiet', 'Quiet', '2026-10-20T07:00:00Z')];
    const report = async (_t: string, q: ReportQuery) => (q.filters === 'video==old' ? { columns: ['views'], rows: [[420]] } : { columns: ['views'], rows: [] });
    const first = appWith({ uploads, report });
    const r = await getJson<UploadTimes>(first.app, `/api/channels/${row.id}/upload-times`, cookie);
    expect(r.uploads).toEqual([
      { videoId: 'old', title: 'Old one', publishedAt: '2026-11-01T18:30:00Z', firstWeekViews: expect.objectContaining({ kind: 'value', value: 420 }) },
      { videoId: 'quiet', title: 'Quiet', publishedAt: '2026-10-20T07:00:00Z', firstWeekViews: { kind: 'no_data', reason: 'YouTube reported no views for its first week' } },
    ]);
    expect(reports(first.youtube).find((q) => q.filters === 'video==old')).toMatchObject({ startDate: '2026-11-01', endDate: '2026-11-07', metrics: ['views'] });
    await env.DB.prepare("DELETE FROM report_cache WHERE channel_id = ? AND key LIKE 'upload-times:%'").bind(row.id).run();
    const second = appWith({ uploads, report });
    await getJson<UploadTimes>(second.app, `/api/channels/${row.id}/upload-times`, cookie);
    expect(reports(second.youtube)).toEqual([]);
  });
});
