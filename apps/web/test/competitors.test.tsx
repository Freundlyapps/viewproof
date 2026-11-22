import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, test } from 'vitest';
import { App } from '../src/App';
import { ME, channel, measured, mockApi } from './fake-api';

const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
const { v, nd } = measured;
const summary = { latestUploadAt: '2026-11-20T12:00:00Z', inLast30Days: { count: 6, ofFeed: 15 }, medianViewsLong: v(50000), medianViewsShorts: nd("No Shorts in the feed's latest 15 uploads") };
const comp = (id: string, title: string, over: Record<string, unknown> = {}) => ({
  channelId: id, title, handle: null, addedAt: '2026-11-21T00:00:00Z', lastCheckedAt: '2026-11-21T11:00:00Z', checkError: null,
  subscribers: { kind: 'value', value: 1234567, formula: 'YouTube Data API', inputs: { asOf: '2026-11-21T03:00:00Z' } }, totalViews: nd('x'), summary, ...over,
});
const video = (id: string, title: string, views: number, vph: unknown, outlier: unknown, over: Record<string, unknown> = {}) => ({
  videoId: id, title, publishedAt: '2026-11-20T10:00:00Z', format: 'long', views: v(views), vph, outlier, history: [], ...over,
});
const vph = (n: number, mode = 'delta') => ({ kind: 'value', value: n, formula: mode === 'delta' ? 'view change ÷ hours between your two visits' : 'views ÷ hours since upload (average)', inputs: { mode } });
const uploads = [
  { ...video('a1', 'Slow riser', 900, vph(10), v(0.4)), channelId: 'UCa', channelTitle: 'Alpha', publishedAt: '2026-11-21T09:00:00Z' },
  { ...video('b1', 'Rocket', 50000, vph(4000), v(6.2)), channelId: 'UCb', channelTitle: 'Beta', publishedAt: '2026-11-20T09:00:00Z' },
  { ...video('b2', 'Fresh one', 20, nd('Published less than an hour ago'), nd('Needs 5 earlier videos of the same type; found 2')), channelId: 'UCb', channelTitle: 'Beta', publishedAt: '2026-11-21T11:30:00Z' },
];

function api(list: unknown[], extra: Record<string, unknown> = {}) {
  const state = { list: [...list] };
  const calls: { method: string; path: string; body?: unknown }[] = [];
  mockApi({
    '/api/me': ME, '/api/channels': [channel()],
    '/api/competitors': (url: URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.pathname === '/api/competitors/uploads') return { uploads: state.list.length ? uploads : [] };
      if (method === 'POST') {
        const input = (JSON.parse(String(init!.body)) as { input: string }).input;
        if (input === 'bad') return new Response(JSON.stringify({ error: 'bad_request', message: 'Paste a channel link, its @handle or its UC… id.' }), { status: 400 });
        const c = comp('UCnew', 'New Channel');
        state.list.push(c);
        return new Response(JSON.stringify(c), { status: 201 });
      }
      if (method === 'DELETE') { state.list = state.list.filter((c) => !url.pathname.endsWith((c as { channelId: string }).channelId)); return new Response(null, { status: 204 }); }
      const m = /^\/api\/competitors\/(UC\w+)$/.exec(url.pathname);
      if (m) return extra[m[1]!] ?? new Response(JSON.stringify({ error: 'not_found', message: 'You are not tracking this channel.' }), { status: 404 });
      return state.list;
    },
  });
  return calls;
}

describe('competitors', () => {
  test('nav Competitors is built; empty state', async () => {
    api([]);
    renderAt('/competitors');
    expect(await screen.findByRole('heading', { name: 'Competitors' })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const link = within(nav).getAllByRole('link').find((a) => a.getAttribute('data-label') === 'Competitors')!;
    expect(within(link).queryByText('soon')).toBeNull();
    expect(await screen.findByText('Track a competitor by pasting its channel link or @handle.')).toBeTruthy();
    expect(screen.getByText('0 of 25')).toBeTruthy();
  });

  test('add shows it and the counter; error message', async () => {
    const calls = api([comp('UCa', 'Alpha')]);
    renderAt('/competitors?tab=channels');
    expect(await screen.findByText('1 of 25')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Competitor channel'), 'bad');
    await userEvent.click(screen.getByRole('button', { name: 'Track' }));
    expect(await screen.findByText('Paste a channel link, its @handle or its UC… id.')).toBeTruthy();
    await userEvent.clear(screen.getByLabelText('Competitor channel'));
    await userEvent.type(screen.getByLabelText('Competitor channel'), '@newchannel');
    await userEvent.click(screen.getByRole('button', { name: 'Track' }));
    expect(await screen.findByText('2 of 25')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'New Channel' }).getAttribute('href')).toBe('/competitors/UCnew');
    expect(calls.find((c) => c.method === 'POST' && (c.body as { input: string }).input === '@newchannel')).toBeTruthy();
  });

  test('channels table: subscribers as of, feed facts, check error, remove', async () => {
    api([comp('UCa', 'Alpha'), comp('UCb', 'Beta', { checkError: 'Feed check failed: HTTP 404', subscribers: nd('This channel hides its subscriber count') })]);
    renderAt('/competitors?tab=channels');
    const table = await screen.findByRole('table', { name: 'Tracked channels' });
    const alpha = within(table).getByRole('row', { name: /Alpha/ });
    expect(within(alpha).getByText('1,234,567')).toBeTruthy();
    expect(within(alpha).getByText(/as of/)).toBeTruthy();
    expect(within(alpha).getByText("of the feed's latest 15")).toBeTruthy();
    expect(within(alpha).getByText('50,000')).toBeTruthy();
    const beta = within(table).getByRole('row', { name: /Beta/ });
    expect(within(beta).getByText('Feed check failed: HTTP 404')).toBeTruthy();
    expect(within(beta).getByText('No data: This channel hides its subscriber count')).toBeTruthy();
    await userEvent.click(within(beta).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(within(screen.getByRole('table', { name: 'Tracked channels' })).queryByRole('row', { name: /Beta/ })).toBeNull());
    expect(screen.getByText('1 of 25')).toBeTruthy();
  });

  test('uploads: newest first, sort by VPH and ×N; no_data reasons', async () => {
    api([comp('UCa', 'Alpha'), comp('UCb', 'Beta')]);
    renderAt('/competitors');
    const table = await screen.findByRole('table', { name: 'New uploads' });
    const titles = () => within(screen.getByRole('table', { name: 'New uploads' })).getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('https://www.youtube.com/watch')).map((a) => a.textContent);
    expect(titles()).toEqual(['Fresh one', 'Slow riser', 'Rocket']);
    await userEvent.click(screen.getByRole('button', { name: 'VPH' }));
    expect(titles()).toEqual(['Rocket', 'Slow riser', 'Fresh one']);
    await userEvent.click(screen.getByRole('button', { name: '×N' }));
    expect(titles()).toEqual(['Rocket', 'Slow riser', 'Fresh one']);
    expect(within(table).getByText('×6.2')).toBeTruthy();
    expect(within(table).getByText('No data: Published less than an hour ago')).toBeTruthy();
    expect(within(table).getByText('4,000').getAttribute('title')).toContain('between your two visits');
  });

  test('detail: videos table and views-over-time line with a table view', async () => {
    const detail = {
      ...comp('UCa', 'Alpha'),
      videos: [video('a1', 'Slow riser', 900, vph(10), v(0.4), { history: [{ views: 700, at: '2026-11-20T12:00:00Z' }, { views: 800, at: '2026-11-20T18:00:00Z' }, { views: 900, at: '2026-11-21T12:00:00Z' }] })],
    };
    api([comp('UCa', 'Alpha')], { UCa: detail });
    renderAt('/competitors/UCa');
    expect(await screen.findByRole('heading', { name: 'Alpha' })).toBeTruthy();
    await userEvent.click(within(screen.getByRole('table', { name: 'Videos' })).getByRole('button', { name: 'Views over time: Slow riser' }));
    expect(screen.getByRole('img', { name: /Views of Slow riser over time, 3 checks/ })).toBeTruthy();
    const t = screen.getByRole('table', { name: 'Views by check' });
    expect(within(t).getAllByRole('row')).toHaveLength(4);
    expect(within(t).getByText('800')).toBeTruthy();
  });

  test('detail of an untracked channel', async () => {
    api([]);
    renderAt('/competitors/UCzzz');
    expect(await screen.findByText('You are not tracking this channel.')).toBeTruthy();
  });
});
