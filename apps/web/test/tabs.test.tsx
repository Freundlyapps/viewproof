import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, test } from 'vitest';
import { App } from '../src/App';
import { ME, channel, cov, measured, mockApi, pair, searchTerms, videos } from './fake-api';

const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
const base = (over: Record<string, unknown>) => ({ '/api/me': ME, '/api/channels': [channel()], ...over });
const WHY = "YouTube reported no row for this video in these dates (no views, or below YouTube's reporting threshold)";

describe('videos tab', () => {
  test('columns and values; a missing row shows its reason; Studio link', async () => {
    mockApi(base({ '/api/channels/row1/videos': videos([
      { videoId: 'a', title: 'Centering for beginners', publishedAt: '2026-11-10T10:00:00Z', durationSec: 542, thumbnailUrl: null, lifetimeViews: measured.v(58600), views: measured.v(3100), watchMinutes: measured.v(930), averageViewDuration: measured.v(301) },
      { videoId: 'b', title: 'Kiln day vlog', publishedAt: '2026-10-01T10:00:00Z', durationSec: 220, thumbnailUrl: null, lifetimeViews: measured.nd('View count hidden'), views: measured.nd(WHY), watchMinutes: measured.nd(WHY), averageViewDuration: measured.nd(WHY) },
    ]) }));
    renderAt('/channel/videos');
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Video', 'Views', 'Watch time', 'Avg view', 'Lifetime views', '']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]!.textContent).toContain('3,100');
    expect(rows[0]!.textContent).toContain('15.5 h');
    expect(rows[0]!.textContent).toContain('5:01');
    expect(rows[0]!.textContent).toContain('58,600');
    expect(rows[1]!.textContent).toContain(WHY);
    expect(within(rows[0]!).getByRole('link', { name: 'Open in Studio' }).getAttribute('href')).toBe('https://studio.youtube.com/video/a/analytics');
  });

  test('no uploads', async () => {
    mockApi(base({ '/api/channels/row1/videos': videos([]) }));
    renderAt('/channel/videos');
    expect(await screen.findByText('No uploads yet.')).toBeTruthy();
  });
});

describe('search terms tab', () => {
  test('real terms with previous period and the video they led to', async () => {
    mockApi(base({ '/api/channels/row1/search-terms': searchTerms([
      { term: 'how to trim a bowl', views: 60, watchMinutes: 240, previousViews: measured.v(44), topVideo: { videoId: 'v1', title: 'Trim a bowl' } },
      { term: 'glaze', views: 31, watchMinutes: 92, previousViews: measured.nd("Not in YouTube's top 25 for the previous period"), topVideo: null },
    ]) }));
    renderAt('/channel/search-terms');
    expect(await screen.findByText('What people typed before finding you')).toBeTruthy();
    expect(screen.getByText('REAL · YouTube')).toBeTruthy();
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Term', 'Views', 'Previous period', 'Watch time', 'Your video']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]!.textContent).toContain('44');
    expect(rows[0]!.textContent).toContain('4.0 h');
    expect(rows[0]!.textContent).toContain('Trim a bowl');
    expect(rows[1]!.textContent).toContain("Not in YouTube's top 25 for the previous period");
  });

  test('the threshold note when YouTube lists none', async () => {
    mockApi(base({ '/api/channels/row1/search-terms': searchTerms([], "YouTube lists search terms only once enough people searched; it doesn't publish the threshold.") }));
    renderAt('/channel/search-terms');
    expect(await screen.findByText(/only once enough people searched/)).toBeTruthy();
  });
});

describe('earnings tab', () => {
  test('not granted: offers to add revenue access', async () => {
    mockApi(base({ '/api/channels/row1/earnings': { status: 'not_granted' } }));
    renderAt('/channel/earnings');
    expect(await screen.findByText("Revenue isn't connected")).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add revenue access' }).getAttribute('href')).toBe('/auth/google/start?choose=1&revenue=1');
  });

  test('not available: YouTube’s reason', async () => {
    mockApi(base({ '/api/channels/row1/earnings': { status: 'not_available', reason: 'The channel is not part of the YouTube Partner Program.' } }));
    renderAt('/channel/earnings');
    expect(await screen.findByText("Revenue isn't available for this channel")).toBeTruthy();
    expect(screen.getByText('The channel is not part of the YouTube Partner Program.')).toBeTruthy();
  });

  test('ok: estimated revenue labelled ESTIMATE, CPM, playbacks, top videos, month-end note', async () => {
    mockApi(base({ '/api/channels/row1/earnings': {
      status: 'ok', range: '28d', coverage: cov(), fetchedAt: 'x',
      totals: { estimatedRevenue: pair(412.8, 378), playbackBasedCpm: pair(5.9, 5.5), monetizedPlaybacks: pair(61000, 58000) },
      topVideos: [{ videoId: 'v1', title: 'Centering', estimatedRevenue: 141.2, playbackBasedCpm: measured.v(6.1) }],
    } }));
    renderAt('/channel/earnings');
    const rev = await screen.findByTestId('kpi-revenue');
    expect(within(rev).getByTestId('value').textContent).toBe('$412.80');
    expect(rev.textContent).toContain('ESTIMATE');
    expect(rev.textContent).toContain('Previous 28 days: $378.00');
    expect(within(screen.getByTestId('kpi-cpm')).getByTestId('value').textContent).toBe('$5.90');
    expect(within(screen.getByTestId('kpi-playbacks')).getByTestId('value').textContent).toBe('61,000');
    expect(screen.getByRole('table').textContent).toContain('$141.20');
    expect(screen.getByText("YouTube's estimate; it can change at month end.")).toBeTruthy();
  });
});
