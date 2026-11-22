// channel-videos.json / channel-shorts.json: a channel's Videos and Shorts tabs (ytInitialData), captured 2026-11-22, trimmed.
// YouTube shows only rounded counts on channel pages ("3.1M"); exact counts are not on the page.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { type ChannelPage, type GridVideo, gridOutliers, gridSummary, parseChannelPage, parseRoundedCount } from '../src/channel-page';

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const page = (n: string): ChannelPage => {
  const p = parseChannelPage(fx(n));
  if ('error' in p) throw new Error(p.error);
  return p;
};

describe('parseRoundedCount', () => {
  test.each([
    ['No views', 0, 0, 0, true],
    ['1 view', 1, 1, 1, true],
    ['845 views', 845, 845, 845, true],
    ['1,234,567 views', 1234567, 1234567, 1234567, true],
    ['12K', 11500, 12999, 12000, false],
    ['290K views', 289500, 290999, 290000, false],
    ['3.1M', 3050000, 3199999, 3100000, false],
    ['3.1 million views', 3050000, 3199999, 3100000, false],
    ['290 thousand views', 289500, 290999, 290000, false],
    ['1.2B', 1150000000, 1299999999, 1200000000, false],
    ['21M', 20500000, 21999999, 21000000, false],
    ['3,1 Mio. Aufrufe', 3050000, 3199999, 3100000, false],
    ['290.000 Aufrufe', 290000, 290000, 290000, true],
    ['12 Tsd. Aufrufe', 11500, 12999, 12000, false],
    ['Keine Aufrufe', 0, 0, 0, true],
  ])('%j', (text, lo, hi, mid, exact) => {
    expect(parseRoundedCount(text)).toEqual({ lo, hi, mid, exact });
  });
  test.each(['', 'views', 'Veritasium', '3d ago', '1.2.3M', 'lots'])('%j is not a count', (text) => {
    expect(parseRoundedCount(text)).toBeNull();
  });
});

describe('parseChannelPage', () => {
  test('Videos tab', () => {
    const p = page('channel-videos.json');
    expect(p).toMatchObject({ channelId: 'UCHnyfMqiRRG1u-2MsSQLbXA', title: 'Veritasium', tab: 'videos', sort: 'latest', subscribersText: '21.5M subscribers' });
    expect(p.videos).toHaveLength(30);
    expect(p.videos[0]).toEqual<GridVideo>({
      videoId: 'uXuQF_PPg5U', title: 'This Simple Task Is Impossible for Computers',
      views: { lo: 3050000, hi: 3199999, mid: 3100000, exact: false }, viewsText: '3.1M', ageLabel: '3d ago', ageDays: 3, durationSec: 2328,
    });
    // A collaboration lists both channel names before the count.
    expect(p.videos[13]).toMatchObject({ videoId: 'kS-CGkiPetQ', viewsText: '8.9M', ageLabel: '5mo ago' });
  });
  test('Shorts tab', () => {
    const p = page('channel-shorts.json');
    expect(p).toMatchObject({ tab: 'shorts', sort: 'latest' });
    expect(p.videos).toHaveLength(48);
    expect(p.videos[0]).toMatchObject({ videoId: 'HZjRoKgDnow', title: 'Does adding helium reduce a balloon’s mass?', viewsText: '290K views', ageLabel: null, ageDays: null, durationSec: null });
    expect(p.videos[0]!.views?.mid).toBe(290000);
  });
  test('not a channel page', () => {
    expect(parseChannelPage({})).toEqual({ error: 'Not a channel page' });
    expect(parseChannelPage(null)).toEqual({ error: 'Not a channel page' });
  });
  test('grid present but nothing readable is a loud error (YouTube changed the page)', () => {
    const raw = fx('channel-videos.json');
    const tab = raw.contents.twoColumnBrowseResultsRenderer.tabs.find((t: any) => t.tabRenderer?.selected);
    tab.tabRenderer.content.richGridRenderer.contents = [{ richItemRenderer: { content: { somethingNewViewModel: {} } } }];
    expect(parseChannelPage(raw)).toEqual({ error: 'YouTube changed its channel page; no videos could be read' });
  });
  test('sort chip on Popular', () => {
    const raw = fx('channel-videos.json');
    const walk = (o: any) => {
      if (o && typeof o === 'object') {
        if (o.chipViewModel) o.chipViewModel.selected = o.chipViewModel.text === 'Popular';
        Object.values(o).forEach(walk);
      }
    };
    walk(raw);
    expect(page2(raw).sort).toBe('popular');
  });
});

const page2 = (raw: unknown): ChannelPage => {
  const p = parseChannelPage(raw);
  if ('error' in p) throw new Error(p.error);
  return p;
};

const grid = (counts: (number | null)[], sort: ChannelPage['sort'] = 'latest'): ChannelPage => ({
  channelId: 'UCx', title: 'X', tab: 'videos', sort, subscribersText: null,
  videos: counts.map((c, i) => ({
    videoId: `v${String(i).padStart(10, '0')}`, title: `t${i}`, viewsText: c === null ? '' : String(c), ageLabel: null, ageDays: null, durationSec: null,
    views: c === null ? null : { lo: c * 0.95, hi: c * 1.05, mid: c, exact: false },
  })),
});

describe('gridOutliers', () => {
  test('×N against the next older videos, with the range rounding allows', () => {
    const p = grid([1_000_000, 100_000, 100_000, 100_000, 100_000, 100_000]);
    const m = gridOutliers(p).get(p.videos[0]!.videoId)!;
    expect(m).toMatchObject({ kind: 'value', value: 10 });
    if (m.kind === 'value') expect(m.inputs).toMatchObject({ baselineMedian: 100_000, baselineCount: 5, rounded: true, low: 9, high: 11.1 });
  });
  test('needs 5 older videos with counts', () => {
    const p = grid([1_000_000, 100_000, null, 100_000, 100_000, 100_000]);
    const m = gridOutliers(p).get(p.videos[0]!.videoId)!;
    expect(m).toMatchObject({ kind: 'no_data' });
    if (m.kind === 'no_data') expect(m.reason).toContain('Needs 5 earlier videos');
  });
  test('real page: the oldest videos on the page have too few older neighbours', () => {
    const p = page('channel-videos.json');
    const out = gridOutliers(p);
    expect(out.size).toBe(30);
    for (const v of p.videos.slice(-4)) expect(out.get(v.videoId)?.kind).toBe('no_data');
    expect(out.get(p.videos[0]!.videoId)?.kind).toBe('value');
  });
  test('only the Latest order is upload order', () => {
    const p = grid([1_000_000, 100_000, 100_000, 100_000, 100_000, 100_000], 'popular');
    const m = gridOutliers(p).get(p.videos[0]!.videoId)!;
    expect(m).toEqual({ kind: 'no_data', reason: 'Sorted by Popular: ×N needs the Latest order' });
  });
  test('baseline is at most 15 videos', () => {
    const p = grid([500, ...Array(15).fill(100), ...Array(10).fill(1_000_000)]);
    const m = gridOutliers(p).get(p.videos[0]!.videoId)!;
    expect(m).toMatchObject({ kind: 'value', value: 5 });
  });
});

test('gridSummary: median of the latest 15 with counts', () => {
  const s = gridSummary(grid([1, 2, 3, null, 4, 5]));
  expect(s).toMatchObject({ counted: 5, medianViews: { kind: 'value', value: 3 } });
  expect(gridSummary(grid([null])).medianViews.kind).toBe('no_data');
});
