import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, test } from 'vitest';
import { App } from '../src/App';
import { ME, channel, measured, mockApi } from './fake-api';

const { v, nd } = measured;
const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
const row = (id: string, title: string, ch: string, n: number, over: Record<string, unknown> = {}) => ({
  videoId: id, title, publishedAt: '2026-11-19T12:00:00Z', format: 'long', views: v(50000), vph: v(700), outlier: v(n), history: [],
  channelId: `UC${ch}`, channelTitle: ch, channelMedian: v(5000), ...over,
});
function api(rows: unknown[], coverage = { videos: 40, channels: 12, channelsWaiting: 3, days: 30 }) {
  const seen = mockApi({ '/api/me': ME, '/api/channels': [channel()], '/api/outliers': { rows, coverage } });
  return seen;
}

describe('outliers', () => {
  test('grid, coverage line, and Outliers tab is built', async () => {
    api([row('aaaaaaaaaaa', 'Throwing a big bowl', 'Small Pottery', 10), row('bbbbbbbbbbb', 'Glaze test', 'Medium Clay', 3, { format: 'short', vph: nd('Published less than an hour ago') })]);
    renderAt('/research/outliers');
    const grid = await screen.findByRole('list', { name: 'Outliers' });
    const items = within(grid).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText('×10')).toBeTruthy();
    expect(within(items[0]!).getByRole('link', { name: 'Throwing a big bowl' }).getAttribute('href')).toBe('https://www.youtube.com/watch?v=aaaaaaaaaaa');
    expect(within(items[0]!).getByText(/50,000 views/)).toBeTruthy();
    expect(within(items[0]!).getByText(/usual 5,000/)).toBeTruthy();
    expect(within(items[1]!).getByText('Short')).toBeTruthy();
    expect(within(items[1]!).getByText('No data: Published less than an hour ago')).toBeTruthy();
    expect(screen.getByText(/40 videos from 12 channels that our network found in the last 30 days/)).toBeTruthy();
    expect(screen.getByText(/3 channels are waiting for their first feed check/)).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Outliers' })).toBeTruthy();
  });

  test('filters go into the URL and the request', async () => {
    const seen = api([]);
    renderAt('/research/outliers');
    await screen.findByText(/No video beats its channel's usual by ×2 with these filters/);
    await userEvent.selectOptions(screen.getByLabelText('Format'), 'short');
    await userEvent.selectOptions(screen.getByLabelText('Uploaded within'), '90');
    await userEvent.selectOptions(screen.getByLabelText('Channel size'), 'small');
    await userEvent.selectOptions(screen.getByLabelText('At least'), '5');
    await userEvent.type(screen.getByLabelText('Keyword in title'), 'bowl{Enter}');
    expect(await screen.findByText(/No video beats its channel's usual by ×5 with these filters/)).toBeTruthy();
    const last = seen.filter((u) => u.startsWith('/api/outliers')).at(-1)!;
    expect(new URL(last, 'http://x').searchParams.toString()).toBe('format=short&days=90&size=small&min=5&q=bowl');
  });

  test('empty pool says how to start', async () => {
    api([], { videos: 0, channels: 0, channelsWaiting: 0, days: 30 });
    renderAt('/research/outliers');
    expect(await screen.findByText((_c, el) => el?.tagName === 'P' && el.textContent === "Your network hasn't found videos yet. Link your browser in Settings → Extension & data.")).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Settings → Extension & data' }).getAttribute('href')).toBe('/settings/extension');
  });
});
