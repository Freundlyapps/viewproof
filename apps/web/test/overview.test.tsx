import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, test } from 'vitest';
import { App } from '../src/App';
import { ME, channel, measured, mockApi, overview, searchTerms, uploadTimes, videos } from './fake-api';

const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
const NO = 'YouTube returned no data for these dates';
const allNoData = { current: measured.nd(NO), previous: measured.nd(NO) };
const routes = (over: Record<string, unknown> = {}) => ({
  '/api/me': ME, '/api/channels': [channel()],
  '/api/channels/row1/overview': overview(), '/api/channels/row1/videos': videos(), '/api/channels/row1/upload-times': uploadTimes(),
  '/api/channels/row1/search-terms': searchTerms(), '/api/agent': { settings: { weekly: false, lastAttemptAt: null, lastError: null }, brief: null, changes: [], usage: { used: 0, limit: 0 } }, ...over,
});

describe('overview', () => {
  test('KPIs show YouTube values, formatted, with the previous period beside them', async () => {
    mockApi(routes());
    renderAt('/channel/overview');
    const views = await screen.findByTestId('kpi-views');
    expect(within(views).getByTestId('value').textContent).toBe('1,234');
    expect(views.textContent).toContain('Previous 28 days: 2,000');
    expect(views.textContent).toContain('REAL');
    expect(within(screen.getByTestId('kpi-watch')).getByTestId('value').textContent).toBe('2.0 h');
    expect(within(screen.getByTestId('kpi-avg')).getByTestId('value').textContent).toBe('3:25');
    expect(screen.queryByText(/%/)).toBeNull();
  });

  test('renders no_data reasons, never a number', async () => {
    mockApi(routes({ '/api/channels/row1/overview': overview({ dataThrough: null, daily: [], totals: { views: allNoData, watchMinutes: allNoData, averageViewDuration: allNoData, subscribersGained: allNoData, subscribersLost: allNoData } }) }));
    renderAt('/channel/overview');
    const views = await screen.findByTestId('kpi-views');
    expect(within(views).getByTestId('value').textContent).toBe(`No data: ${NO}`);
    for (const id of ['kpi-views', 'kpi-watch', 'kpi-avg', 'kpi-subs']) expect(within(screen.getByTestId(id)).getByTestId('value').textContent).not.toMatch(/\d/);
    expect(screen.getByText('No daily data from YouTube for these dates')).toBeTruthy();
  });

  test('range chips refetch with the chosen range', async () => {
    const seen = mockApi(routes());
    renderAt('/channel/overview');
    await screen.findByTestId('kpi-views');
    await userEvent.click(screen.getByRole('button', { name: '7 days' }));
    await screen.findByTestId('kpi-views');
    expect(seen).toContain('/api/channels/row1/overview?range=7d');
  });

  test('chart says how far YouTube data goes', async () => {
    mockApi(routes());
    renderAt('/channel/overview');
    expect(await screen.findByText('Data through 2026-11-18')).toBeTruthy();
  });

  test('best time links to YouTube Studio and lists uploads by first-week views', async () => {
    mockApi(routes({ '/api/channels/row1/upload-times': uploadTimes([
      { videoId: 'a', title: 'Low one', publishedAt: '2026-11-01T18:30:00Z', firstWeekViews: measured.v(10) },
      { videoId: 'b', title: 'High one', publishedAt: '2026-10-20T07:00:00Z', firstWeekViews: measured.v(420) },
      { videoId: 'c', title: 'Quiet', publishedAt: '2026-10-10T07:00:00Z', firstWeekViews: measured.nd('YouTube reported no views for its first week') },
    ]) }));
    renderAt('/channel/overview');
    const link = await screen.findByRole('link', { name: /YouTube Studio/ });
    expect(link.getAttribute('href')).toBe('https://studio.youtube.com/channel/UCaaa/analytics/tab-audience/period-default');
    const items = await screen.findAllByTestId('upload-time');
    expect(items[0]!.textContent).toContain('High one');
    expect(items[0]!.textContent).toContain('420 first-week views');
    expect(items[2]!.textContent).toContain('YouTube reported no views for its first week');
  });

  test('needs attention offers revenue access when it was not given', async () => {
    mockApi(routes());
    renderAt('/channel/overview');
    expect((await screen.findByRole('link', { name: 'Add revenue access' })).getAttribute('href')).toBe('/auth/google/start?choose=1&revenue=1');
  });

  test('switcher changes which channel the data comes from', async () => {
    const seen = mockApi(routes({ '/api/channels': [channel(), channel({ id: 'row2', channelId: 'UCbbb', title: 'Second' })], '/api/channels/row2/overview': overview({ channelId: 'UCbbb' }), '/api/channels/row2/videos': videos(), '/api/channels/row2/upload-times': uploadTimes() }));
    renderAt('/channel/overview');
    await screen.findByTestId('kpi-views');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Channel' }), 'row2');
    await screen.findByTestId('kpi-views');
    expect(seen.some((u) => u.startsWith('/api/channels/row2/overview'))).toBe(true);
  });

  test('a Google failure shows its message', async () => {
    mockApi(routes({ '/api/channels/row1/overview': new Response(JSON.stringify({ error: 'google_failed', message: 'YouTube quota used up for today' }), { status: 502 }) }));
    renderAt('/channel/overview');
    expect(await screen.findByText(/YouTube quota used up for today/)).toBeTruthy();
  });
});

describe('home', () => {
  test('KPIs, top search terms, needs attention; the weekly brief card replaces the old placeholders', async () => {
    mockApi(routes({ '/api/channels/row1/search-terms': searchTerms([{ term: 'how to trim a bowl', views: 60, watchMinutes: 240, previousViews: measured.v(44), topVideo: null }]) }));
    renderAt('/');
    expect(await screen.findByText('how to trim a bowl')).toBeTruthy();
    expect(await screen.findByTestId('kpi-views')).toBeTruthy();
    expect(await screen.findByTestId('weekly-brief')).toBeTruthy();
    expect(screen.queryAllByText('Arrives in a later update')).toHaveLength(0);
    expect(screen.getByRole('heading', { name: /Needs attention/ })).toBeTruthy();
  });
});
