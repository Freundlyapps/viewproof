import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../src/App';
import { ME, channel, measured, mockApi, videos } from './fake-api';

const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const base = { '/api/me': ME, '/api/channels': [channel()], '/api/channels/row1/videos': videos([]) };
const row = (title: string, x = 3) => ({ videoId: `v${title.length}${x}`, title, publishedAt: '2026-11-01T00:00:00Z', format: 'long', views: measured.v(1000), vph: measured.nd('x'), outlier: measured.v(x), history: [], channelId: 'UCo', channelTitle: 'Other channel', channelMedian: measured.v(100) });
const outliers = (rows: unknown[]) => ({ rows, coverage: { videos: rows.length, channels: 1, channelsWaiting: 0, olderThanFeed: 0, days: 30 } });
const VIDEO = {
  video: { videoId: 'abcdefghijk', channelId: 'UCaaa', title: 'What OK means', description: 'The origin of OK.', tags: ['word history', 'etymology'], publishedAt: '2026-10-01T00:00:00Z', durationSec: 600 },
  terms: [{ term: 'okay meaning', views: 30 }, { term: 'word history', views: 5 }], termsNote: null, period: { start: '2026-08-21', end: '2026-11-19' }, fetchedAt: '2026-11-21T12:00:00Z',
};
const vrow = (videoId: string, title: string) => ({ videoId, title, publishedAt: '2026-10-01T00:00:00Z', durationSec: 600, thumbnailUrl: null, lifetimeViews: measured.v(1), views: measured.v(1), watchMinutes: measured.v(1), averageViewDuration: measured.v(1) });

afterEach(() => vi.useRealTimers());

describe('Check a title', () => {
  test('rules with their thresholds update as you type; preview is labelled approximate', async () => {
    mockApi({ ...base, '/api/outliers': outliers([]) });
    renderAt('/optimize');
    const title = await screen.findByLabelText('Title');
    await userEvent.type(title, 'Short');
    const checks = screen.getByRole('list', { name: 'Title checks' });
    expect(within(checks).getByText('Title between 20 and 70 characters')).toBeTruthy();
    expect(within(checks).getAllByText('5 characters').length).toBeGreaterThan(0);
    await userEvent.type(title, ' but now long enough');
    expect(within(checks).getAllByText('25 characters').length).toBeGreaterThan(0);
    expect(screen.getByText(/Approximate preview/)).toBeTruthy();
    expect(screen.getAllByText('Short but now long enough').length).toBeGreaterThanOrEqual(2);
  });

  test('outlier comparison: no data under 5 titles, facts from 5 up', async () => {
    let rows = [row('Etymology one'), row('Etymology two'), row('Etymology three')];
    const seen = mockApi({ ...base, '/api/outliers': () => outliers(rows) });
    renderAt('/optimize');
    await userEvent.type(await screen.findByLabelText('Keyword'), 'etymology');
    expect(await screen.findByText(/Only 3 outlier titles for this keyword; need 5 to compare/)).toBeTruthy();
    expect(seen.some((u) => u.startsWith('/api/outliers?') && u.includes('q=etymology') && u.includes('days=90') && u.includes('min=2'))).toBe(true);
    expect(screen.getByText('Etymology one')).toBeTruthy();
    rows = [...rows, row('Why etymology?'), row('Etymology in 5 words')];
    await userEvent.clear(screen.getByLabelText('Keyword'));
    await new Promise((r) => setTimeout(r, 700)); // let the debounce see the empty keyword
    await userEvent.type(screen.getByLabelText('Keyword'), 'etymology');
    expect(await screen.findByText(/5 titles · median length 14 · 1 with a number · 1 question · 5 with the keyword in the first 40 characters/, {}, { timeout: 2000 })).toBeTruthy();
  });

  test('AI suggestions post the title and keyword and are labelled AI', async () => {
    const posts: any[] = [];
    mockApi({ ...base, '/api/outliers': outliers([]), '/api/ai/quick': (_u: URL, init?: RequestInit) => {
      posts.push(JSON.parse(String(init?.body)));
      return { items: [{ text: 'Better title', why: 'w', sources: [] }], sources: [], missing: [], ai: { provider: 'anthropic', label: 'Anthropic (Claude)', model: 'm', via: 'own' }, usage: { month: '2026-11', quick: { used: 0, limit: 20 }, coach: { used: 0, limit: 0 } } };
    } });
    renderAt('/optimize');
    await userEvent.type(await screen.findByLabelText('Title'), 'My old title here ok');
    await userEvent.type(screen.getByLabelText('Keyword'), 'ok');
    await userEvent.click(screen.getByRole('button', { name: 'Suggest titles with AI' }));
    expect(await screen.findByText('Better title')).toBeTruthy();
    expect(posts[0]).toEqual({ action: 'titles', topic: 'ok', notes: 'Current title: My old title here ok' });
    expect(within(screen.getByRole('list', { name: 'AI suggestions' })).getByText('AI')).toBeTruthy();
  });
});

describe('Your videos', () => {
  test('loads a video, checks it against its real search terms, copies all, links to Studio', async () => {
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    const seen = mockApi({ ...base, '/api/outliers': outliers([]), '/api/channels/row1/videos': videos([vrow('abcdefghijk', 'What OK means')]), '/api/channels/row1/optimize/abcdefghijk': VIDEO });
    renderAt('/optimize');
    await userEvent.selectOptions(await screen.findByLabelText('Video'), 'abcdefghijk');
    const table = await screen.findByRole('table', { name: 'Search terms for this video' });
    const tagOnly = within(table).getByText('word history').closest('tr')!;
    expect(within(tagOnly).getAllByText('—')).toHaveLength(2);
    expect(within(tagOnly).getByText('✓')).toBeTruthy();
    expect(seen).toContain('/api/channels/row1/videos?range=90d');
    expect((screen.getByLabelText('Keyword for this video') as HTMLInputElement).value).toBe('okay meaning');
    expect(screen.getByRole('link', { name: 'Open in YouTube Studio' }).getAttribute('href')).toBe('https://studio.youtube.com/video/abcdefghijk/edit');
    await userEvent.click(screen.getByRole('button', { name: 'Copy all' }));
    expect(write).toHaveBeenCalledWith('What OK means\n\nThe origin of OK.\n\nTags: word history, etymology');
  });

  test("a video that isn't on the channel shows the server's message", async () => {
    mockApi({ ...base, '/api/outliers': outliers([]), '/api/channels/row1/videos': videos([vrow('abcdefghijk', 'Gone')]), '/api/channels/row1/optimize/': json({ error: 'not_found', message: 'Video not found on this channel.' }, 404) });
    renderAt('/optimize');
    await userEvent.selectOptions(await screen.findByLabelText('Video'), 'abcdefghijk');
    expect(await screen.findByText('Video not found on this channel.')).toBeTruthy();
  });

  test('withheld search terms show YouTube\'s note', async () => {
    mockApi({ ...base, '/api/outliers': outliers([]), '/api/channels/row1/videos': videos([vrow('abcdefghijk', 'What OK means')]), '/api/channels/row1/optimize/abcdefghijk': { ...VIDEO, terms: [], termsNote: 'YouTube lists search terms only once enough people searched.' } });
    renderAt('/optimize');
    await userEvent.selectOptions(await screen.findByLabelText('Video'), 'abcdefghijk');
    expect(await screen.findByText('YouTube lists search terms only once enough people searched.')).toBeTruthy();
    await waitFor(() => expect((screen.getByLabelText('Keyword for this video') as HTMLInputElement).value).toBe(''));
  });
});

test('nav: Optimize video is built', async () => {
  mockApi({ ...base, '/api/outliers': outliers([]) });
  renderAt('/optimize');
  const nav = await screen.findByRole('navigation', { name: 'Main' });
  const item = within(nav).getAllByRole('link').find((a) => a.getAttribute('data-label') === 'Optimize video')!;
  expect(within(item).queryByText('soon')).toBeNull();
});
