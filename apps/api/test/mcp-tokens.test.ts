import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { sha256Hex } from '../src/crypto';
import { MCP_DAILY_CALLS, MAX_MCP_TOKENS, countCall, userForToken } from '../src/mcp/tokens';
import { APP, addUser, makeDeps, sendJsonReq, sessionCookie } from './helpers';

const create = async (app: ReturnType<typeof createApp>, cookie: string, label?: string) =>
  sendJsonReq(app, 'POST', '/api/mcp/tokens', cookie, label === undefined ? {} : { label });

describe('MCP tokens', () => {
  it('creates a vpm_ token and stores only its hash', async () => {
    await addUser('mt1');
    const cookie = await sessionCookie('mt1');
    const app = createApp(makeDeps());
    const res = await create(app, cookie, '  Claude Code  ');
    expect(res.status).toBe(201);
    const body = (await res.json()) as { token: string; info: { id: string; label: string; lastUsedAt: string | null } };
    expect(body.token).toMatch(/^vpm_/);
    expect(body.info.label).toBe('Claude Code');
    const row = await env.DB.prepare('SELECT * FROM mcp_tokens WHERE user_id = ?').bind('mt1').first<Record<string, string>>();
    expect(row!.id_hash).toBe(await sha256Hex(body.token));
    expect(JSON.stringify(row)).not.toContain(body.token);
  });

  it('lists tokens with endpoint and usage, never the token', async () => {
    await addUser('mt2');
    const cookie = await sessionCookie('mt2');
    const app = createApp(makeDeps());
    const { token } = (await (await create(app, cookie)).json()) as { token: string };
    const res = await app.request('/api/mcp/tokens', { headers: { cookie } });
    const text = await res.text();
    expect(text).not.toContain(token);
    const body = JSON.parse(text) as { endpoint: string; tokens: { label: string; createdAt: string; lastUsedAt: string | null }[]; usage: { used: number; limit: number | null } };
    expect(body.endpoint).toBe(`${APP}/mcp`);
    expect(body.tokens).toHaveLength(1);
    expect(body.tokens[0]!.label).toBe('AI app');
    expect(body.tokens[0]!.lastUsedAt).toBeNull();
    expect(body.usage).toEqual({ used: 0, limit: MCP_DAILY_CALLS });
  });

  it('refuses a sixth token', async () => {
    await addUser('mt3');
    const cookie = await sessionCookie('mt3');
    const app = createApp(makeDeps());
    for (let i = 0; i < MAX_MCP_TOKENS; i++) expect((await create(app, cookie, `t${i}`)).status).toBe(201);
    const res = await create(app, cookie, 'one more');
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'limit', message: 'You can have up to 5 MCP tokens. Revoke one first.' });
  });

  it('is signed-out without a session', async () => {
    const app = createApp(makeDeps());
    const res = await app.request('/api/mcp/tokens');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'signed_out', message: 'Sign in first.' });
  });

  it('deletes only your own token', async () => {
    await addUser('mt4');
    await addUser('mt5');
    const app = createApp(makeDeps());
    const mine = await sessionCookie('mt4');
    const theirs = await sessionCookie('mt5');
    const t = (await (await create(app, theirs)).json()) as { token: string; info: { id: string } };
    expect((await sendJsonReq(app, 'DELETE', `/api/mcp/tokens/${t.info.id}`, mine)).status).toBe(204);
    expect(await userForToken(makeDeps(), `Bearer ${t.token}`)).toBe('mt5');
    expect((await sendJsonReq(app, 'DELETE', `/api/mcp/tokens/${t.info.id}`, theirs)).status).toBe(204);
    expect(await userForToken(makeDeps(), `Bearer ${t.token}`)).toBeNull();
  });

  it('userForToken needs the Bearer prefix and a known token, and records last use', async () => {
    await addUser('mt6');
    const app = createApp(makeDeps());
    const t = (await (await create(app, await sessionCookie('mt6'))).json()) as { token: string; info: { id: string } };
    const deps = makeDeps({ now: () => Date.parse('2026-11-23T10:00:00Z') });
    expect(await userForToken(deps, t.token)).toBeNull();
    expect(await userForToken(deps, undefined)).toBeNull();
    expect(await userForToken(deps, 'Bearer vpm_unknown')).toBeNull();
    expect(await userForToken(deps, `Bearer ${t.token}`)).toBe('mt6');
    const row = await env.DB.prepare('SELECT last_used_at FROM mcp_tokens WHERE id = ?').bind(t.info.id).first<{ last_used_at: string }>();
    expect(row!.last_used_at).toBe('2026-11-23T10:00:00.000Z');
  });

  it('countCall allows 500 calls a day on a hosted server, unlimited when self-hosted', async () => {
    await addUser('mt7');
    const deps = makeDeps();
    await env.DB.prepare('INSERT INTO mcp_calls (user_id, day, count) VALUES (?, ?, ?)').bind('mt7', new Date(deps.now()).toISOString().slice(0, 10), MCP_DAILY_CALLS - 1).run();
    expect(await countCall(deps, 'mt7')).toEqual({ ok: true });
    expect(await countCall(deps, 'mt7')).toEqual({ ok: false, limit: 500 });
    const self = makeDeps({}, { SELF_HOSTED: 'true' });
    expect(await countCall(self, 'mt7')).toEqual({ ok: true });
  });

  it('account export lists MCP tokens without hashes, and delete removes them', async () => {
    await addUser('mt8');
    const cookie = await sessionCookie('mt8');
    const app = createApp(makeDeps());
    await create(app, cookie, 'Cursor');
    await countCall(makeDeps(), 'mt8');
    const exp = (await (await app.request('/account/export', { headers: { cookie } })).json()) as { mcpTokens: Record<string, unknown>[]; mcpCalls: unknown[] };
    expect(exp.mcpTokens).toHaveLength(1);
    expect(Object.keys(exp.mcpTokens[0]!).sort()).toEqual(['createdAt', 'label', 'lastUsedAt']);
    expect(exp.mcpCalls).toHaveLength(1);
    const del = await app.request('/account/delete', { method: 'POST', headers: { origin: APP, cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'confirm=delete' });
    expect(del.status).toBe(200);
    expect(await env.DB.prepare('SELECT 1 FROM mcp_tokens WHERE user_id = ?').bind('mt8').first()).toBeNull();
    expect(await env.DB.prepare('SELECT 1 FROM mcp_calls WHERE user_id = ?').bind('mt8').first()).toBeNull();
  });
});
