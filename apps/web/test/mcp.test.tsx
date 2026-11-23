import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, test } from 'vitest';
import { App } from '../src/App';
import { ME, channel, mockApi } from './fake-api';

const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
const STATUS = { included: null, own: null, usage: { month: '2026-11', quick: { used: 0, limit: 20 }, coach: { used: 0, limit: 0 } }, customAllowed: false, presets: { anthropic: { label: 'Anthropic (Claude)', baseUrl: null, quickModel: 'claude-haiku-5-5', coachModel: 'claude-sonnet-5-5' } } };
const ENDPOINT = 'https://viewproof.example/mcp';
const T1 = { id: 'tok1', label: 'Claude Code', createdAt: '2026-11-20T10:00:00Z', lastUsedAt: null };
const list = (tokens: unknown[], used = 3, limit: number | null = 500) => ({ endpoint: ENDPOINT, tokens, usage: { used, limit } });
const base = { '/api/me': ME, '/api/channels': [channel()], '/api/ai/status': STATUS };

describe('Settings → MCP server', () => {
  test('lists tokens with "Never" for unused ones, the address and today\'s usage', async () => {
    mockApi({ ...base, '/api/mcp/tokens': list([T1]) });
    renderAt('/settings/ai');
    const card = (await screen.findByRole('heading', { name: 'MCP server' })).closest('.card') as HTMLElement;
    expect(await within(card).findByText('Claude Code')).toBeTruthy();
    expect(within(card).getByText('Never')).toBeTruthy();
    expect(within(card).getByText(ENDPOINT)).toBeTruthy();
    expect(within(card).getByText('Tool calls today: 3 / 500')).toBeTruthy();
    expect(screen.queryByText(/Coming in the next update/)).toBeNull();
  });

  test('says when there is no limit, and when there are no tokens', async () => {
    mockApi({ ...base, '/api/mcp/tokens': list([], 7, null) });
    renderAt('/settings/ai');
    expect(await screen.findByText('Tool calls today: 7 (no limit)')).toBeTruthy();
    expect(screen.getByText('No tokens yet.')).toBeTruthy();
  });

  test('creating shows the token once with both snippets', async () => {
    const posted: unknown[] = [];
    let tokens: unknown[] = [];
    mockApi({ ...base, '/api/mcp/tokens': (_u: URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posted.push(JSON.parse(String(init.body)));
        tokens = [{ ...T1, label: 'Cursor' }];
        return new Response(JSON.stringify({ token: 'vpm_secret123', info: tokens[0] }), { status: 201, headers: { 'content-type': 'application/json' } });
      }
      return list(tokens);
    } });
    renderAt('/settings/ai');
    await userEvent.type(await screen.findByLabelText('Name (e.g. the app you use it in)'), 'Cursor');
    await userEvent.click(screen.getByRole('button', { name: 'Create token' }));
    expect(await screen.findByText("Copy this token now; it won't be shown again.")).toBeTruthy();
    expect(posted).toEqual([{ label: 'Cursor' }]);
    expect(screen.getByText('vpm_secret123')).toBeTruthy();
    expect(screen.getByText(`claude mcp add --transport http viewproof ${ENDPOINT} --header "Authorization: Bearer vpm_secret123"`)).toBeTruthy();
    const json = screen.getByTestId('mcp-json').textContent!;
    expect(JSON.parse(json)).toEqual({ mcpServers: { viewproof: { type: 'http', url: ENDPOINT, headers: { Authorization: 'Bearer vpm_secret123' } } } });
    expect(await screen.findByText('Cursor')).toBeTruthy();
  });

  test('revoke deletes the token and removes the row', async () => {
    const seen: string[] = [];
    let tokens: unknown[] = [T1];
    mockApi({ ...base, '/api/mcp/tokens': (u: URL, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        seen.push(u.pathname);
        tokens = [];
        return new Response(null, { status: 204 });
      }
      return list(tokens);
    } });
    renderAt('/settings/ai');
    await screen.findByText('Claude Code');
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText('No tokens yet.')).toBeTruthy();
    expect(seen).toEqual(['/api/mcp/tokens/tok1']);
  });

  test('shows the server message when creating fails', async () => {
    mockApi({ ...base, '/api/mcp/tokens': (_u: URL, init?: RequestInit) => init?.method === 'POST'
      ? new Response(JSON.stringify({ error: 'limit', message: 'You can have up to 5 MCP tokens. Revoke one first.' }), { status: 422 })
      : list([T1]) });
    renderAt('/settings/ai');
    await userEvent.click(await screen.findByRole('button', { name: 'Create token' }));
    expect(await screen.findByText('You can have up to 5 MCP tokens. Revoke one first.')).toBeTruthy();
  });
});
