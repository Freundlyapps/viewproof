import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, test } from 'vitest';
import { App } from '../src/App';
import { ME, channel, mockApi } from './fake-api';
import { fakeExtension } from './fake-extension';

const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
const browser = (id: string, over: Record<string, unknown> = {}) => ({ id, label: 'Chrome on Windows', createdAt: '2026-11-20T10:00:00Z', lastUsedAt: '2026-11-22T11:00:00Z', acceptedToday: 120, rejectedToday: 2, acceptedTotal: 900, status: 'active', ...over });
const TOKEN = 't'.repeat(43);
let ext: ReturnType<typeof fakeExtension> | null = null;
afterEach(() => { ext?.remove(); ext = null; });

function api(list: unknown[]) {
  const state = { list: [...list] };
  const calls: string[] = [];
  mockApi({
    '/api/me': ME, '/api/channels': [channel()],
    '/api/pool/tokens': (_u: URL, init?: RequestInit) => {
      calls.push(`${init?.method} tokens ${init?.body}`);
      const b = browser('new', { acceptedToday: 0, rejectedToday: 0, acceptedTotal: 0, lastUsedAt: null });
      state.list.push(b);
      return new Response(JSON.stringify({ token: TOKEN, browser: b }), { status: 201 });
    },
    '/api/pool/browsers': (u: URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') { calls.push(`DELETE ${u.pathname}`); state.list = state.list.filter((b) => !u.pathname.endsWith((b as { id: string }).id)); return new Response(null, { status: 204 }); }
      return state.list;
    },
  });
  return calls;
}

describe('extension & data', () => {
  test('settings card opens the page; lists linked browsers with counts', async () => {
    api([browser('b1'), browser('b2', { status: 'suspended', label: 'Edge' })]);
    renderAt('/settings');
    await userEvent.click(await screen.findByRole('link', { name: 'Extension & data' }));
    const table = await screen.findByRole('table', { name: 'Linked browsers' });
    const r1 = within(table).getByRole('row', { name: /Chrome on Windows/ });
    expect(within(r1).getByText('120')).toBeTruthy();
    expect(within(r1).getByText('900')).toBeTruthy();
    expect(within(table).getByText('Paused: too much data was rejected')).toBeTruthy();
    expect(screen.getByText(/video and channel ids, title, view count/)).toBeTruthy();
  });

  test('link this browser: token goes to the extension', async () => {
    const calls = api([]);
    ext = fakeExtension();
    renderAt('/settings/extension');
    await userEvent.click(await screen.findByRole('button', { name: 'Link this browser' }));
    expect(await screen.findByText(/Linked\. The extension opened its data-sharing page/)).toBeTruthy();
    expect(ext.links).toEqual([TOKEN]);
    expect(calls[0]).toMatch(/^POST tokens /);
    expect(await screen.findByRole('row', { name: /Chrome on Windows/ })).toBeTruthy();
  });

  test('no extension: no token is created', async () => {
    const calls = api([]);
    renderAt('/settings/extension');
    await userEvent.click(await screen.findByRole('button', { name: 'Link this browser' }));
    expect(await screen.findByText('Install the ViewProof extension in this browser first, then reload this page.', {}, { timeout: 4000 })).toBeTruthy();
    expect(calls).toEqual([]);
  });

  test('unlink', async () => {
    const calls = api([browser('b1')]);
    renderAt('/settings/extension');
    const table = await screen.findByRole('table', { name: 'Linked browsers' });
    await userEvent.click(within(table).getByRole('button', { name: 'Unlink' }));
    await waitFor(() => expect(screen.queryByRole('table', { name: 'Linked browsers' })).toBeNull());
    expect(calls).toContain('DELETE /api/pool/browsers/b1');
  });
});
