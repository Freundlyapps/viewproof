import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, test } from 'vitest';
import { App } from '../src/App';
import { ME, channel, mockApi } from './fake-api';

const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const SOURCES = [
  { id: 'S1', kind: 'terms', label: 'Your real search terms, last 90 days', detail: 'YouTube Analytics', provenance: 'real', lines: ['"okay meaning" — 300 views'] },
  { id: 'S2', kind: 'outliers', label: 'Outliers our network observed, last 30 days', detail: 'ViewProof data pool', provenance: 'pool', lines: ['"Big video" (Other) — ×4'] },
];
const MISSING = [{ kind: 'competitors', label: "Tracked competitors' latest uploads", reason: "You don't track any competitors yet" }];
const AI = { provider: 'anthropic', label: 'Anthropic (Claude)', model: 'claude-haiku-5-5', via: 'included' };
const USAGE = { month: '2026-11', quick: { used: 3, limit: 20 }, coach: { used: 0, limit: 0 } };
const STATUS = {
  included: { provider: 'anthropic', label: 'Anthropic (Claude)', quickModel: 'claude-haiku-5-5', coachModel: 'claude-sonnet-5-5' },
  own: null, usage: USAGE, customAllowed: false,
  presets: {
    anthropic: { label: 'Anthropic (Claude)', baseUrl: null, quickModel: 'claude-haiku-5-5', coachModel: 'claude-sonnet-5-5' },
    openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', quickModel: null, coachModel: null },
    deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', quickModel: null, coachModel: null, note: "DeepSeek's API is hosted in China; your channel data is sent there." },
    custom: { label: 'Custom (OpenAI-compatible)', baseUrl: null, quickModel: null, coachModel: null },
  },
};
const base = { '/api/me': ME, '/api/channels': [channel()], '/api/ai/status': STATUS };

describe('Ask AI', () => {
  test('quick titles: items with AI badges, citation chips and the data used', async () => {
    const seen: unknown[] = [];
    mockApi({ ...base, '/api/ai/quick': (_u: URL, init?: RequestInit) => {
      seen.push(JSON.parse(String(init?.body)));
      return { items: [{ text: 'What OK really means', why: 'Your top search term.', sources: ['S1'] }, { text: 'Second title', why: '', sources: [] }], sources: SOURCES, missing: MISSING, ai: AI, usage: { ...USAGE, quick: { used: 4, limit: 20 } } };
    } });
    renderAt('/ai');
    await userEvent.click(await screen.findByRole('button', { name: 'Titles' }));
    await userEvent.type(screen.getByLabelText('Topic or keyword'), 'okay origin');
    await userEvent.click(screen.getByRole('button', { name: 'Write' }));
    expect(await screen.findByText('What OK really means')).toBeTruthy();
    expect(seen[0]).toMatchObject({ action: 'titles', topic: 'okay origin' });
    const results = screen.getByRole('list', { name: 'Results' });
    expect(within(results).getAllByText('AI')).toHaveLength(2);
    await userEvent.click(within(results).getByRole('button', { name: 'S1' }));
    const src = screen.getByTestId('source-S1');
    expect(src.className).toContain('hl');
    expect(within(src).getByText('"okay meaning" — 300 views')).toBeTruthy();
    expect(screen.getByText(/You don't track any competitors yet/)).toBeTruthy();
    expect(screen.getByText(/Sent to Anthropic \(Claude\) \(claude-haiku-5-5\) · included AI · 4 of 20 this month/)).toBeTruthy();
  });

  test('ask: unknown citation stays plain text with a warning; answer is never HTML', async () => {
    mockApi({ ...base, '/api/ai/ask': { answer: 'Views rose [S1]. Odd [S7]. <img src=x onerror=alert(1)>', cited: ['S1'], unknownCitations: ['S7'], sources: SOURCES, missing: [], ai: { ...AI, via: 'own', model: 'claude-sonnet-5-5' }, usage: USAGE } });
    const { container } = renderAt('/ai');
    await userEvent.type(await screen.findByLabelText('Ask about your channel'), 'How am I doing?');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('How am I doing?')).toBeTruthy();
    const odd = await screen.findByText('[S7]');
    expect(odd.getAttribute('title')).toBe('Not one of the sources sent');
    expect(screen.getAllByRole('button', { name: 'S1' }).length).toBeGreaterThan(0);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeTruthy();
    expect(screen.getByText(/Sent to Anthropic \(Claude\) \(claude-sonnet-5-5\) · your key$/)).toBeTruthy();
  });

  test('limit refusal offers adding a key', async () => {
    mockApi({ ...base, '/api/ai/ask': json({ error: 'limit', message: 'Ask AI uses the deeper model, included with Pro. Add your own key to use it now.', used: 0, limit: 0 }, 402) });
    renderAt('/ai');
    await userEvent.type(await screen.findByLabelText('Ask about your channel'), 'hi');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/included with Pro/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add your own key' }).getAttribute('href')).toBe('/settings/ai');
  });

  test('a failed question keeps the text so it can be sent again', async () => {
    mockApi({ ...base, '/api/ai/ask': json({ error: 'unavailable', message: "Anthropic (Claude) isn't answering right now. Try again in a moment." }, 502) });
    renderAt('/ai');
    const box = await screen.findByLabelText('Ask about your channel');
    await userEvent.type(box, 'hello');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/isn't answering/)).toBeTruthy();
    expect((box as HTMLTextAreaElement).value).toBe('hello');
  });
});

describe('Settings → AI & apps', () => {
  test('shows the included AI and usage; custom hidden when not allowed', async () => {
    mockApi(base);
    renderAt('/settings/ai');
    expect(await screen.findByText(/claude-haiku-5-5/)).toBeTruthy();
    expect(screen.getByText('Quick actions: 3 of 20 this month')).toBeTruthy();
    const select = screen.getByLabelText('Provider') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['anthropic', 'openai', 'deepseek']);
  });

  test('save and test posts the form; models required for providers without defaults; errors shown', async () => {
    const posts: unknown[] = [];
    mockApi({ ...base, '/api/ai/key': (_u: URL, init?: RequestInit) => {
      posts.push(JSON.parse(String(init?.body)));
      return json({ error: 'auth', message: 'Your OpenAI key was refused. Update it in Settings → AI & apps.' }, 400);
    } });
    renderAt('/settings/ai');
    await userEvent.selectOptions(await screen.findByLabelText('Provider'), 'deepseek');
    expect(screen.getByText(/hosted in China/)).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText('Provider'), 'openai');
    expect((screen.getByLabelText('Model for quick actions') as HTMLInputElement).required).toBe(true);
    await userEvent.type(screen.getByLabelText('API key'), 'sk-openai-1234');
    await userEvent.type(screen.getByLabelText('Model for quick actions'), 'mini-1');
    await userEvent.type(screen.getByLabelText('Model for Ask AI'), 'big-1');
    await userEvent.click(screen.getByRole('button', { name: 'Save and test' }));
    expect(await screen.findByText(/key was refused/)).toBeTruthy();
    expect(posts[0]).toEqual({ provider: 'openai', apiKey: 'sk-openai-1234', quickModel: 'mini-1', coachModel: 'big-1' });
  });

  test('a saved key shows its hint and can be removed', async () => {
    let own: unknown = { provider: 'anthropic', label: 'Anthropic (Claude)', quickModel: 'claude-haiku-5-5', coachModel: 'claude-sonnet-5-5', baseUrl: null, keyHint: '…9876' };
    mockApi({ ...base, '/api/ai/status': () => ({ ...STATUS, own }), '/api/ai/key': () => ((own = null), { ok: true }) });
    renderAt('/settings/ai');
    expect(await screen.findByText(/…9876/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Remove key' }));
    await waitFor(() => expect(screen.queryByText(/…9876/)).toBeNull());
  });
});

test('nav: Ask AI is built; the settings card links to AI & apps', async () => {
  mockApi(base);
  renderAt('/settings');
  const nav = await screen.findByRole('navigation', { name: 'Main' });
  const ask = within(nav).getAllByRole('link').find((a) => a.getAttribute('data-label') === 'Ask AI')!;
  expect(within(ask).queryByText('soon')).toBeNull();
  expect(screen.getByRole('link', { name: 'AI & apps' }).getAttribute('href')).toBe('/settings/ai');
});
