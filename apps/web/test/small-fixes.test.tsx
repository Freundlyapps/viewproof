import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, test } from 'vitest';
import { App } from '../src/App';
import { DailyChart } from '../src/channel/DailyChart';
import { ME, channel, mockApi, overview, uploadTimes, videos } from './fake-api';

const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

describe('daily chart', () => {
  test('a day YouTube skipped is a gap, placed by date', () => {
    const { container } = render(<DailyChart start="2026-11-01" dataThrough="2026-11-05" daily={[
      { date: '2026-11-01', views: 10 }, { date: '2026-11-02', views: 20 }, { date: '2026-11-04', views: 30 }, { date: '2026-11-05', views: 40 },
    ]} />);
    const lines = container.querySelectorAll('polyline');
    expect(lines).toHaveLength(2);
    // 5 days → x at 0, 250, 500, 750, 1000; the 4th is placed by its date, not by its index.
    expect(lines[0]!.getAttribute('points')!.split(' ').map((p) => p.split(',')[0])).toEqual(['0.0', '250.0']);
    expect(lines[1]!.getAttribute('points')!.split(' ').map((p) => p.split(',')[0])).toEqual(['750.0', '1000.0']);
    expect(screen.getByText(/gaps are days YouTube returned no row for/i)).toBeTruthy();
  });

  test('no gap, no gap note', () => {
    render(<DailyChart start="2026-11-01" dataThrough="2026-11-02" daily={[{ date: '2026-11-01', views: 1 }, { date: '2026-11-02', views: 2 }]} />);
    expect(screen.queryByText(/gaps are days/i)).toBeNull();
  });
});

describe('sidebar', () => {
  test('"My channel" stays highlighted on its other tabs', async () => {
    mockApi({ '/api/me': ME, '/api/channels': [channel()], '/api/channels/row1/videos': videos() });
    renderAt('/channel/videos');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    const link = within(nav).getAllByRole('link').find((a) => a.getAttribute('data-label') === 'My channel')!;
    expect(link.className).toContain('on');
  });
});

describe('reconnect banner', () => {
  test('clears by itself once the channel answers again', async () => {
    let status = 'reconnect';
    mockApi({
      '/api/me': ME,
      '/api/channels/row1/overview': () => { status = 'active'; return overview(); },
      '/api/channels/row1/upload-times': uploadTimes(),
      '/api/channels/row1/videos': videos(),
      '/api/channels': () => [channel({ status, statusReason: status === 'reconnect' ? 'Google access was removed or expired' : null })],
    });
    renderAt('/channel/overview');
    expect((await screen.findAllByText('Reconnect needed')).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryAllByText('Reconnect needed')).toHaveLength(0));
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
  });
});
