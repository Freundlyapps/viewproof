import { describe, expect, test, vi } from 'vitest';
import { httpYouTubeClient } from '../src/youtube';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const client = (impl: (url: string) => Promise<Response>) => {
  const f = vi.fn(async (input: RequestInfo | URL) => impl(String(input)));
  return { yt: httpYouTubeClient(f as unknown as typeof fetch), urls: () => f.mock.calls.map((c) => String(c[0])) };
};

describe('report', () => {
  test('sends the query and maps columns and rows', async () => {
    const { yt, urls } = client(async () => json({ columnHeaders: [{ name: 'day' }, { name: 'views' }], rows: [['2026-11-01', 12]] }));
    const r = await yt.report('tok', { startDate: '2026-11-01', endDate: '2026-11-07', metrics: ['views'], dimensions: ['day'], sort: 'day' });
    expect(r).toEqual({ columns: ['day', 'views'], rows: [['2026-11-01', 12]] });
    const u = new URL(urls()[0]!);
    expect(u.origin + u.pathname).toBe('https://youtubeanalytics.googleapis.com/v2/reports');
    expect(u.searchParams.get('ids')).toBe('channel==MINE');
    expect(u.searchParams.get('startDate')).toBe('2026-11-01');
    expect(u.searchParams.get('endDate')).toBe('2026-11-07');
    expect(u.searchParams.get('metrics')).toBe('views');
    expect(u.searchParams.get('dimensions')).toBe('day');
    expect(u.searchParams.get('sort')).toBe('day');
    expect(u.searchParams.has('filters')).toBe(false);
    expect(u.searchParams.has('maxResults')).toBe(false);
  });

  test('joins metrics, passes filters and maxResults; missing rows is an empty list', async () => {
    const { yt, urls } = client(async () => json({ columnHeaders: [{ name: 'views' }, { name: 'estimatedMinutesWatched' }] }));
    const r = await yt.report('tok', { startDate: 'a', endDate: 'b', metrics: ['views', 'estimatedMinutesWatched'], filters: 'video==x', maxResults: 25 });
    expect(r).toEqual({ columns: ['views', 'estimatedMinutesWatched'], rows: [] });
    const u = new URL(urls()[0]!);
    expect(u.searchParams.get('metrics')).toBe('views,estimatedMinutesWatched');
    expect(u.searchParams.get('filters')).toBe('video==x');
    expect(u.searchParams.get('maxResults')).toBe('25');
  });

  test('error mapping', async () => {
    const q = { startDate: 'a', endDate: 'b', metrics: ['views'] };
    expect(await client(async () => json({}, 401)).yt.report('t', q)).toEqual({ kind: 'revoked' });
    expect(await client(async () => json({ error: { message: 'Forbidden: not in YPP' } }, 403)).yt.report('t', q)).toEqual({ kind: 'forbidden', reason: 'Forbidden: not in YPP' });
    expect(await client(async () => json({}, 429)).yt.report('t', q)).toEqual({ kind: 'failed', reason: 'YouTube quota used up for today' });
    expect(await client(async () => json({ error: { message: 'q', errors: [{ reason: 'quotaExceeded' }] } }, 403)).yt.report('t', q)).toEqual({ kind: 'failed', reason: 'YouTube quota used up for today' });
    expect(await client(async () => json({}, 500)).yt.report('t', q)).toEqual({ kind: 'failed', reason: 'HTTP 500' });
    expect(await client(async () => { throw new Error('offline'); }).yt.report('t', q)).toEqual({ kind: 'failed', reason: 'offline' });
  });
});

describe('uploads', () => {
  const video = (n: number) => ({
    id: `v${n}`,
    snippet: { title: `Video ${n}`, publishedAt: `2026-10-${String(n % 28 + 1).padStart(2, '0')}T10:00:00Z`, thumbnails: { medium: { url: `m${n}` }, default: { url: `d${n}` } } },
    contentDetails: { duration: 'PT1H2M3S' },
    statistics: { viewCount: String(n * 10) },
  });
  function fakeApi(total: number) {
    const ids = Array.from({ length: total }, (_, i) => `v${i + 1}`);
    return async (url: string) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/channels')) return json({ items: [{ contentDetails: { relatedPlaylists: { uploads: 'UUx' } } }] });
      if (u.pathname.endsWith('/playlistItems')) {
        const page = Number(u.searchParams.get('pageToken') ?? 0);
        const slice = ids.slice(page * 50, page * 50 + 50);
        return json({ items: slice.map((id) => ({ contentDetails: { videoId: id } })), ...(page * 50 + 50 < ids.length ? { nextPageToken: String(page + 1) } : {}) });
      }
      if (u.pathname.endsWith('/videos')) return json({ items: u.searchParams.get('id')!.split(',').map((id) => video(Number(id.slice(1)))) });
      return json({}, 404);
    };
  }

  test('pages through the uploads playlist and maps videos', async () => {
    const { yt, urls } = client(fakeApi(120));
    const r = await yt.uploads('tok', 120);
    if ('kind' in r) throw new Error('unexpected error');
    expect(r).toHaveLength(120);
    expect(r.find((v) => v.videoId === 'v1')).toEqual({ videoId: 'v1', title: 'Video 1', publishedAt: '2026-10-02T10:00:00Z', durationSec: 3723, views: 10, thumbnailUrl: 'm1' });
    const called = urls().map((x) => new URL(x));
    expect(called[0]!.searchParams.get('mine')).toBe('true');
    expect(called.filter((u) => u.pathname.endsWith('/playlistItems'))).toHaveLength(3);
    expect(called.filter((u) => u.pathname.endsWith('/videos')).map((u) => u.searchParams.get('id')!.split(',').length)).toEqual([50, 50, 20]);
    for (let i = 1; i < r.length; i++) expect(Date.parse(r[i - 1]!.publishedAt)).toBeGreaterThanOrEqual(Date.parse(r[i]!.publishedAt));
  });

  test('stops at max', async () => {
    const r = await client(fakeApi(120)).yt.uploads('tok', 30);
    expect('kind' in r ? r : r.length).toBe(30);
  });

  test('hidden views, odd duration and missing thumbnails are null', async () => {
    const { yt } = client(async (url) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/channels')) return json({ items: [{ contentDetails: { relatedPlaylists: { uploads: 'UUx' } } }] });
      if (u.pathname.endsWith('/playlistItems')) return json({ items: [{ contentDetails: { videoId: 'a' } }] });
      return json({ items: [{ id: 'a', snippet: { title: 'A', publishedAt: '2026-11-01T00:00:00Z', thumbnails: {} }, contentDetails: { duration: 'P0D-weird' }, statistics: {} }] });
    });
    expect(await yt.uploads('t', 10)).toEqual([{ videoId: 'a', title: 'A', publishedAt: '2026-11-01T00:00:00Z', durationSec: null, views: null, thumbnailUrl: null }]);
  });

  test('channel without an uploads playlist has no uploads', async () => {
    expect(await client(async () => json({ items: [{ contentDetails: { relatedPlaylists: {} } }] })).yt.uploads('t', 10)).toEqual([]);
  });

  test('401 is revoked', async () => {
    expect(await client(async () => json({}, 401)).yt.uploads('t', 10)).toEqual({ kind: 'revoked' });
  });
});
