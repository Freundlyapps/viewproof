import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, test } from 'vitest';
import { App } from '../src/App';
import { ME, channel, cov, mockApi } from './fake-api';
import { fakeExtension, fixtureSnapshot } from './fake-extension';

const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
const KW = 'pottery wheel for beginners';
const at = (q = KW) => `/research/keywords?q=${encodeURIComponent(q)}`;
const off = { status: 'off', reason: 'YouTube search interest is optional and not configured on this server.' };
const yourTerms = (terms: unknown[] = [], note: string | null = null) => ({ keyword: KW, coverage: cov(90, 90), terms, note, fetchedAt: '2026-11-21T12:00:00Z' });
const api = (over: Record<string, unknown> = {}) => mockApi({ '/api/me': ME, '/api/channels/row1/keyword-terms': yourTerms(), '/api/keywords/trends': off, '/api/channels': [channel()], ...over });

let ext: ReturnType<typeof fakeExtension> | null = null;
afterEach(() => { ext?.remove(); ext = null; });

describe('research', () => {
  test('Research nav opens Keywords; Outliers tab opens the finder', async () => {
    api();
    renderAt('/research');
    expect(await screen.findByRole('heading', { name: 'Research' })).toBeTruthy();
    expect(screen.getByLabelText('Keyword')).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const research = within(nav).getAllByRole('link').find((a) => a.getAttribute('data-label') === 'Research')!;
    expect(research.className).toContain('on');
    expect(within(research).queryByText('soon')).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: /Outliers/ }));
    expect(await screen.findByLabelText('Keyword in title')).toBeTruthy();
  });

  test('no extension', async () => {
    api();
    renderAt(at());
    expect(await screen.findByText("Install the ViewProof extension to read YouTube's top results in your browser.", {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Top results' })).toBeNull();
  });

  test('no snapshot yet', async () => {
    api();
    ext = fakeExtension();
    renderAt(at());
    const link = await screen.findByRole('link', { name: 'Search on YouTube' });
    expect(link.getAttribute('href')).toBe(`https://www.youtube.com/results?search_query=${encodeURIComponent(KW)}`);
    expect(link.getAttribute('target')).toBe('_blank');
  });

  test('facts and summary from a snapshot', async () => {
    api();
    ext = fakeExtension({ snapshots: { [KW]: fixtureSnapshot() } });
    renderAt(at('Pottery Wheel for Beginners'));
    expect(await screen.findByText('Florian Gadsby has 5 of the top 18 results.')).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Top results' });
    expect(within(table).getAllByRole('row')).toHaveLength(19);
    expect(within(table).getByRole('link', { name: 'How to Center Clay — A Beginner\'s Guide' }).getAttribute('href')).toBe('https://www.youtube.com/watch?v=-YCGK33c0xs');
    expect(screen.getByText(/Channel sizes:/)).toBeTruthy();
  });

  test('refreshes on kw-updated', async () => {
    api();
    const snapshots: Record<string, ReturnType<typeof fixtureSnapshot>> = {};
    ext = fakeExtension({ snapshots });
    renderAt(at());
    await screen.findByRole('link', { name: 'Search on YouTube' });
    snapshots[KW] = fixtureSnapshot();
    ext.updated(KW);
    expect(await screen.findByText('Florian Gadsby has 5 of the top 18 results.')).toBeTruthy();
  });

  test('suggestion lists link to their reports', async () => {
    api();
    ext = fakeExtension({ suggestions: { related: ['pottery wheel for kids'], questions: ['how to use a pottery wheel'], matching: ['pottery wheel for beginners uk'] } });
    renderAt(at());
    const link = await screen.findByRole('link', { name: 'how to use a pottery wheel' });
    expect(link.getAttribute('href')).toBe(`/research/keywords?q=${encodeURIComponent('how to use a pottery wheel')}&country=US`);
    expect(screen.getByRole('link', { name: 'pottery wheel for kids' })).toBeTruthy();
  });

  test('suggestion error shows the reason', async () => {
    api();
    ext = fakeExtension({ suggestionsError: 'YouTube refused suggestion requests; paused until 2026-11-22T12:00:00.000Z' });
    renderAt(at());
    expect(await screen.findByText(/paused until 2026-11-22/)).toBeTruthy();
  });

  test('your terms table', async () => {
    api({ '/api/channels/row1/keyword-terms': yourTerms([{ term: 'pottery wheel for beginners', views: 60, watchMinutes: 240, previousViews: { kind: 'value', value: 44, formula: 'f', inputs: {} }, topVideo: null }]) });
    renderAt(at());
    const table = await screen.findByRole('table', { name: 'Your search terms' });
    expect(within(table).getByText('60')).toBeTruthy();
  });

  test('report without a channel', async () => {
    api({ '/api/channels': [] });
    renderAt(at());
    expect(await screen.findByText('Connect a channel to see which of your real search terms match.')).toBeTruthy();
  });

  test('trends off shows reason; ok shows the label, peak and a table', async () => {
    api();
    const first = renderAt(at());
    expect(await screen.findByText(off.reason)).toBeTruthy();
    first.unmount();
    api({ '/api/keywords/trends': { status: 'ok', provider: 'DataForSEO', label: 'Relative YouTube search interest from Google Trends (via DataForSEO), 100 = peak week. Not a number of searches; not YouTube API data.', keyword: KW, country: 'US', interest: [{ date: '2026-01-04', value: 40 }, { date: '2026-01-11', value: 100 }, { date: '2026-01-18', value: 70 }], note: null, fetchedAt: '2026-11-21T12:00:00Z' } });
    renderAt(at());
    expect(await screen.findByText(/Not a number of searches/)).toBeTruthy();
    expect(screen.getByText('Peak: week of 2026-01-11 (100)')).toBeTruthy();
    expect(within(screen.getByRole('table', { name: 'YouTube search interest by week' })).getAllByRole('row')).toHaveLength(4);
    expect(screen.queryByText(/monthly searches/i)).toBeNull();
  });

  test('no data anywhere line', async () => {
    api();
    ext = fakeExtension();
    renderAt(at());
    expect(await screen.findByText('No data for this keyword from any source yet.')).toBeTruthy();
  });

  test('recent keywords remembered; country passed to the estimate', async () => {
    const seen = api();
    renderAt('/research/keywords');
    await userEvent.type(await screen.findByLabelText('Keyword'), 'kiln');
    await userEvent.selectOptions(screen.getByLabelText('Country'), 'DE');
    await userEvent.click(screen.getByRole('button', { name: 'Get report' }));
    await waitFor(() => expect(seen).toContain('/api/keywords/trends?q=kiln&country=DE'));
    expect(JSON.parse(localStorage.getItem('vp-keywords') ?? '[]')).toEqual(['kiln']);
  });
});

describe('review fixes', () => {
  test('a slow answer (suggestions being fetched) still counts as installed', async () => {
    api();
    ext = fakeExtension({ snapshots: { [KW]: fixtureSnapshot() }, delayMs: 2500 });
    renderAt(at());
    expect(await screen.findByText('Florian Gadsby has 5 of the top 18 results.', {}, { timeout: 6000 })).toBeTruthy();
    expect(screen.queryByText(/Install the ViewProof extension/)).toBeNull();
  }, 15_000);
});

test('too little Trends data says so', async () => {
  api({ '/api/keywords/trends': { status: 'ok', provider: 'DataForSEO', label: 'L', keyword: KW, country: 'US', interest: [], note: 'Google Trends has too little YouTube search data for this keyword.', fetchedAt: '2026-11-21T12:00:00Z' } });
  renderAt(at());
  expect(await screen.findByText('Google Trends has too little YouTube search data for this keyword.')).toBeTruthy();
});
