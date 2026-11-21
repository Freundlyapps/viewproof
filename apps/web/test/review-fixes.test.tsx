import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, test } from 'vitest';
import { App } from '../src/App';
import { ME, channel, cov, measured, mockApi, overview, pair, searchTerms, uploadTimes, videos } from './fake-api';

const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
const routes = (over: Record<string, unknown> = {}) => ({
  '/api/me': ME, '/api/channels': [channel()],
  '/api/channels/row1/overview': overview(), '/api/channels/row1/videos': videos(), '/api/channels/row1/upload-times': uploadTimes(),
  '/api/channels/row1/search-terms': searchTerms(), ...over,
});

describe('coverage: how far YouTube data goes', () => {
  test('overview says how many days it compares, and the previous label matches', async () => {
    mockApi(routes({ '/api/channels/row1/overview': overview({ range: '7d', dataThrough: '2026-11-18', coverage: cov(4, 7, '2026-11-18') }) }));
    renderAt('/channel/overview?range=7d');
    expect(await screen.findByText('Data through 2026-11-18 (4 of 7 days, compared with the 4 days before)')).toBeTruthy();
    expect(screen.getByTestId('kpi-views').textContent).toContain('Previous 4 days: 2,000');
  });

  test('videos, search terms and earnings each say it', async () => {
    mockApi(routes({
      '/api/channels/row1/videos': videos([], cov(26, 28, '2026-11-19')),
      '/api/channels/row1/search-terms': searchTerms([], 'none', cov(26, 28, '2026-11-19')),
      '/api/channels/row1/earnings': { status: 'ok', range: '28d', coverage: cov(26, 28, '2026-11-19'), fetchedAt: 'x', totals: { estimatedRevenue: pair(1, 1), playbackBasedCpm: pair(1, 1), monetizedPlaybacks: pair(1, 1) }, topVideos: [] },
    }));
    for (const tab of ['videos', 'search-terms', 'earnings']) {
      const { unmount } = renderAt(`/channel/${tab}`);
      expect(await screen.findByText(/^Data through 2026-11-19 \(26 of 28 days/)).toBeTruthy();
      unmount();
    }
  });

  test('no data yet says so', async () => {
    mockApi(routes({ '/api/channels/row1/videos': videos([], cov(0, 28, null)) }));
    renderAt('/channel/videos');
    expect(await screen.findByText('YouTube has no data for these dates yet.')).toBeTruthy();
  });
});

describe('errors and empty states', () => {
  test('access lost mid-session: the error offers Reconnect', async () => {
    mockApi(routes({ '/api/channels/row1/videos': new Response(JSON.stringify({ error: 'reconnect', message: 'Google access was removed or expired' }), { status: 409 }) }));
    renderAt('/channel/videos');
    expect(await screen.findByText('Google access was removed or expired')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Reconnect' }).getAttribute('href')).toBe('/auth/google/start?choose=1');
  });

  test('a channel that is gone offers to remove it', async () => {
    mockApi(routes({ '/api/channels/row1/videos': new Response(JSON.stringify({ error: 'gone', message: 'YouTube no longer returns this channel' }), { status: 409 }) }));
    renderAt('/channel/videos');
    expect((await screen.findByRole('link', { name: 'Remove it' })).getAttribute('href')).toBe('/account');
  });

  test('the previous period keeps its no-data reason', async () => {
    mockApi(routes({ '/api/channels/row1/overview': overview({ totals: { ...overview().totals, views: { current: measured.v(5), previous: measured.nd('YouTube returned no data for these dates') } } }) }));
    renderAt('/channel/overview');
    expect((await screen.findByTestId('kpi-views')).textContent).toContain('Previous 28 days: No data: YouTube returned no data for these dates');
  });

  test('no uploads yet: no empty grid', async () => {
    mockApi(routes());
    renderAt('/channel/overview');
    expect(await screen.findByText('No uploads older than 10 days yet.')).toBeTruthy();
    expect(screen.queryByLabelText('Your uploads by weekday and time')).toBeNull();
  });
});
void within;
