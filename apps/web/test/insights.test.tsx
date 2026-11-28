import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, test } from 'vitest';
import { App } from '../src/App';
import { ME, channel, cov, measured, mockApi, videos } from './fake-api';

const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
const base = (over: Record<string, unknown>) => ({ '/api/me': ME, '/api/channels': [channel()], ...over });
const AT = '2026-11-21T12:00:00Z';

describe('new My channel tabs', () => {
  test('tabs have plain names', async () => {
    mockApi(base({ '/api/channels/row1/traffic': { range: '28d', coverage: cov(), sources: [], note: 'none', fetchedAt: AT } }));
    renderAt('/channel/traffic');
    const tabs = (await screen.findAllByRole('tab')).map((t) => t.textContent);
    expect(tabs).toEqual(['Overview', 'Videos', 'Video check-up', 'Thumbnails', 'Traffic', 'Audience', 'Search terms', 'Earnings']);
  });

  test('traffic: bars of YouTube views (no percentages) and a table with the previous period', async () => {
    mockApi(base({ '/api/channels/row1/traffic': { range: '28d', coverage: cov(), note: null, fetchedAt: AT, sources: [
      { type: 'YT_SEARCH', label: 'YouTube search', views: 300, watchMinutes: 600, previousViews: measured.v(50) },
      { type: 'RELATED_VIDEO', label: 'Suggested videos', views: 100, watchMinutes: 120, previousViews: measured.nd('not listed') },
    ] } }));
    renderAt('/channel/traffic');
    const bars = await screen.findByTestId('traffic-bars');
    expect(bars.textContent).toContain('YouTube search');
    expect(bars.textContent).toContain('300 views');
    expect(bars.textContent).not.toMatch(/%/);
    expect(screen.getByRole('table').textContent).toContain('No data: not listed');
  });

  test('audience: countries, devices, age and gender, and what YouTube never gives', async () => {
    mockApi(base({ '/api/channels/row1/audience': {
      range: '28d', coverage: cov(), fetchedAt: AT,
      countries: [{ key: 'US', label: 'United States', views: 80, watchMinutes: 100 }], countriesNote: null,
      devices: [], devicesNote: 'YouTube returned no devices for these dates',
      ageGender: [{ ageGroup: '25–34', female: 20, male: 30, other: 0 }], ageGenderNote: null,
      notAvailable: ['Unique viewers', 'New vs returning viewers'],
    } }));
    renderAt('/channel/audience');
    expect((await screen.findByTestId('country-bars')).textContent).toContain('United States');
    expect(screen.getByText('YouTube returned no devices for these dates')).toBeTruthy();
    expect(screen.getByRole('table').textContent).toContain('30.0%');
    expect(screen.getByTestId('country-bars').textContent).not.toMatch(/%/);
    expect(screen.getByText(/Unique viewers, New vs returning viewers/)).toBeTruthy();
  });

  test('thumbnails: waiting state says when data comes', async () => {
    mockApi(base({ '/api/channels/row1/thumbnails': { status: 'waiting', reason: 'ViewProof asked YouTube for thumbnail reports on 2026-11-21.', range: '28d', days: { from: null, to: null, count: 0 }, totals: {}, daily: [], videos: [], sources: [], endScreens: {}, fetchedAt: AT } }));
    renderAt('/channel/thumbnails');
    const s = await screen.findByTestId('thumbs-status');
    expect(s.textContent).toContain('Thumbnail data is on its way');
    expect(s.textContent).toContain('2026-11-21');
  });

  test('thumbnails: impressions, daily CTR per video, sources', async () => {
    mockApi(base({ '/api/channels/row1/thumbnails': {
      status: 'ok', reason: null, range: '28d', days: { from: '2026-11-01', to: '2026-11-19', count: 19 }, fetchedAt: AT,
      totals: { impressions: measured.v(12500) },
      daily: [{ date: '2026-11-18', impressions: 500 }, { date: '2026-11-19', impressions: 700 }],
      videos: [{ videoId: 'a', title: 'AI tools compared', thumbnailUrl: null, impressions: 9000, latestCtr: { kind: 'value', value: 0.031, formula: 'YouTube Reporting API', inputs: { day: '2026-11-19' } }, ctrByDay: [{ date: '2026-11-18', ctr: 0.02 }, { date: '2026-11-19', ctr: 0.031 }] }],
      sources: [{ type: 3, label: 'Browse features', impressions: 8000 }],
      endScreens: { impressions: measured.v(100), clicks: measured.v(7) },
    } }));
    renderAt('/channel/thumbnails');
    expect((await screen.findByTestId('kpi-impressions')).textContent).toContain('12,500');
    expect(screen.getByText(/19 days \(2026-11-01 to 2026-11-19\)/)).toBeTruthy();
    expect(screen.getByRole('table').textContent).toContain('3.1%');
    expect(screen.getByRole('table').textContent).toContain('2026-11-19');
    expect(screen.getByRole('img', { name: /Click-through rate per day: 2026-11-18 2.0%, 2026-11-19 3.1%/ })).toBeTruthy();
    expect(screen.getByTestId('thumb-sources').textContent).toContain('Browse features');
  });

  test("video check-up: picks the newest video, shows YouTube's values with the channel's beside them, switches video", async () => {
    const row = (videoId: string, title: string) => ({ videoId, title, publishedAt: '2026-11-10T10:00:00Z', durationSec: 300, thumbnailUrl: null, lifetimeViews: measured.v(1), views: measured.v(1), watchMinutes: measured.v(1), averageViewDuration: measured.v(1) });
    const checkup = (id: string) => ({
      video: { videoId: id, title: id === 'a' ? 'First' : 'Second', publishedAt: '2026-11-10T10:00:00Z', durationSec: 300, thumbnailUrl: null },
      range: '28d', period: { start: '2026-10-25', end: '2026-11-19' }, views: measured.v(1000), fetchedAt: AT,
      parts: [
        { area: 'Thumbnail & title', guide: 'Of the people who saw the thumbnail, how many clicked.', values: [{ label: 'Click-through rate on 2026-11-19', video: measured.v(0.024), channel: null, unit: 'fraction' }] },
        { area: 'Watching', guide: 'How much of the video people watch.', values: [{ label: 'Average share watched', video: measured.v(55), channel: measured.v(40), unit: 'percent' }] },
        { area: 'Next video', guide: 'End screen elements shown and clicked.', values: [{ label: 'End screen clicks', video: measured.nd('no end screen'), channel: null, unit: 'count' }] },
      ],
      ctrByDay: [{ date: '2026-11-18', ctr: 0.03 }, { date: '2026-11-19', ctr: 0.024 }],
      retention: { videoId: id, title: 't', durationSec: 300, range: '28d', period: { start: 'a', end: 'b' }, curve: [{ elapsedRatio: 0.1, elapsedSec: 30, audienceWatchRatio: 0.6, relativeRetentionPerformance: measured.v(0.5) }, { elapsedRatio: 1, elapsedSec: 300, audienceWatchRatio: 0.2, relativeRetentionPerformance: measured.v(0.5) }], at30s: null, at30sNote: null, note: null, fetchedAt: AT },
      sources: [],
    });
    const seen = mockApi(base({
      '/api/channels/row1/videos': videos([row('a', 'First'), row('b', 'Second')]),
      '/api/channels/row1/checkup/': (u: URL) => checkup(u.pathname.split('/').pop()!),
    }));
    renderAt('/channel/checkup');
    expect((await screen.findByTestId('checkup-summary')).textContent).toContain('1,000 views');
    const watching = screen.getByTestId('part-Watching');
    expect(watching.textContent).toContain('55.0%');
    expect(watching.textContent).toContain('Channel: 40.0%');
    expect(screen.getByTestId('part-Next video').textContent).toContain('No data: no end screen');
    expect(screen.getByTestId('part-Thumbnail & title').textContent).toContain('2.4%');
    expect(screen.queryByText(/Weaker|Better|median/)).toBeNull();
    expect(screen.getByRole('img', { name: /Audience retention/ })).toBeTruthy();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Video' }), 'b');
    expect(await screen.findByRole('heading', { name: 'Second' })).toBeTruthy();
    expect(seen.some((u) => u.startsWith('/api/channels/row1/checkup/b'))).toBe(true);
    expect(within(screen.getByRole('combobox', { name: 'Video' })).getAllByRole('option')).toHaveLength(2);
  });
});
