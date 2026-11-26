import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, test } from 'vitest';
import { App } from '../src/App';
import { ME, channel, mockApi, overview, searchTerms, videos } from './fake-api';

const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const base = { '/api/me': ME, '/api/channels/row1/overview': overview(), '/api/channels/row1/search-terms': searchTerms(), '/api/channels/row1/videos': videos(), '/api/channels': [channel()] };

const SOURCES = [
  { id: 'S1', kind: 'terms', label: 'Your real search terms, last 90 days', detail: 'YouTube Analytics', provenance: 'real', lines: ['"glaze mistakes" — 640 views'] },
  { id: 'S2', kind: 'candidates', label: 'Your videos below your usual, last 28 days', detail: 'YouTube Analytics', provenance: 'real', lines: ['V1: "Studio tour" — 50 views in the last 28 days'] },
];
const metric = (before: number, after: number, changePct: number, usualSwingPct: number | null, verdict: string) => ({ before, after, changePct, usualSwingPct, swingCount: 7, verdict });
const change = (over: Record<string, unknown> = {}) => ({
  id: 'c1', videoId: 'vidCCCCCCCC', beforeTitle: 'Studio tour', proposedTitle: 'My Pottery Studio Tour', why: 'Search terms point here.', sources: ['S2'],
  status: 'proposed', createdAt: '2026-11-21T12:00:00Z', approvedAt: null, appliedOn: null, appliedTitle: null, check7: null, check28: null, ...over,
});
const state = (over: Record<string, unknown> = {}) => ({
  settings: { weekly: false, lastAttemptAt: null, lastError: null },
  brief: {
    id: 'b1', createdAt: '2026-11-21T12:00:00Z', trigger: 'manual', ai: { provider: 'anthropic', label: 'Anthropic (Claude)', model: 'claude-sonnet-5-5', via: 'included' },
    tokens: { input: 5200, output: 1800 }, ideas: [{ text: 'Five glaze mistakes', why: 'Your term got 640 views.', sources: ['S1'] }], sources: SOURCES, missing: [], dropped: 1,
  },
  changes: [change()], usage: { used: 1, limit: 6 }, ...over,
});

describe('Home → What to make next', () => {
  test('no brief yet: explains what it reads; Make one now shows the brief', async () => {
    const posts: string[] = [];
    mockApi({ ...base, '/api/agent/brief': (u: URL) => (posts.push(u.pathname), state()), '/api/agent': state({ brief: null, changes: [], usage: { used: 0, limit: 6 } }) });
    renderAt('/');
    const card = await screen.findByTestId('weekly-brief');
    expect(within(card).getByText(/Every number it gives is checked against that data/)).toBeTruthy();
    expect(within(card).getByText('6 of 6 left this month')).toBeTruthy();
    await userEvent.click(within(card).getByRole('button', { name: 'Make one now' }));
    expect(await within(card).findByText('Five glaze mistakes')).toBeTruthy();
    expect(posts).toEqual(['/api/agent/brief']);
    expect(within(card).getByText(/1 suggestion was removed because it gave numbers that aren't in your data/)).toBeTruthy();
    expect(within(card).getByText(/model claude-sonnet-5-5 · included AI · 7,000 tokens/)).toBeTruthy();
  });

  test('a refusal shows its message and the way to add a key', async () => {
    mockApi({ ...base, '/api/agent/brief': () => json({ error: 'limit', message: 'The weekly brief is included with Pro.' }, 402), '/api/agent': state({ brief: null, changes: [] }) });
    renderAt('/');
    const card = await screen.findByTestId('weekly-brief');
    await userEvent.click(within(card).getByRole('button', { name: 'Make one now' }));
    expect(await within(card).findByText('The weekly brief is included with Pro.')).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'Add your own key' })).toBeTruthy();
  });

  test('approve a title: Studio link and how it is measured', async () => {
    const bodies: unknown[] = [];
    mockApi({ ...base, '/api/agent/changes/c1': (_u: URL, init?: RequestInit) => (bodies.push(JSON.parse(String(init?.body))), state({ changes: [change({ status: 'approved', approvedAt: '2026-11-21T13:00:00Z' })] })), '/api/agent': state() });
    renderAt('/');
    const ch = await screen.findByTestId('change-c1');
    expect(within(ch).getByText(/Now: “Studio tour”/)).toBeTruthy();
    await userEvent.click(within(ch).getByRole('button', { name: "I'll use it" }));
    await waitFor(() => expect(bodies).toEqual([{ action: 'approve' }]));
    const after = await screen.findByTestId('change-c1');
    expect(within(after).getByRole('link', { name: 'Open in YouTube Studio' }).getAttribute('href')).toBe('https://studio.youtube.com/video/vidCCCCCCCC/edit');
    expect(within(after).getByText(/ViewProof checks once a day/)).toBeTruthy();
  });

  test('a measured change shows the numbers and never claims the title caused them', async () => {
    const check7 = { state: 'measured', days: 7, applied: '2026-11-22', afterEnd: '2026-11-28', views: metric(700, 770, 10, 25, 'within_swing'), searchViews: metric(280, 400, 42.9, 20, 'above_swing') };
    mockApi({ ...base, '/api/agent': state({ changes: [change({ status: 'applied', appliedOn: '2026-11-22', appliedTitle: 'My Pottery Studio Tour', check7 })] }) });
    renderAt('/');
    const ch = await screen.findByTestId('change-c1');
    expect(within(ch).getByText(/Views: 770 in the 7 days after, 700 in the 7 days before \(\+10%\)\. That's within its usual ups and downs/)).toBeTruthy();
    expect(within(ch).getByText(/Views from YouTube search: 400 .* Other things can cause this too/)).toBeTruthy();
    expect(within(ch).getByText(/28-day check: on 21 Dec, once YouTube has the data/)).toBeTruthy();
  });

  test('weekly switch sends the setting', async () => {
    const bodies: unknown[] = [];
    mockApi({ ...base, '/api/agent/settings': (_u: URL, init?: RequestInit) => (bodies.push(JSON.parse(String(init?.body))), state({ settings: { weekly: true, lastAttemptAt: null, lastError: null } })), '/api/agent': state() });
    renderAt('/');
    const card = await screen.findByTestId('weekly-brief');
    await userEvent.click(within(card).getByLabelText('Make a brief every week'));
    await waitFor(() => expect(bodies).toEqual([{ weekly: true }]));
    expect((within(card).getByLabelText('Make a brief every week') as HTMLInputElement).checked).toBe(true);
  });
});
