import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import { createApp } from '../src/app';
import { aiUsage, chooseAi, llmFailure } from '../src/ai/router';
import { decryptForUser, encryptForUser } from '../src/crypto';
import { addUser, fakeLlm, makeDeps, sendJsonReq, sessionCookie } from './helpers';

const KEY_ENV = { AI_API_KEY: 'sk-included' };
const NOW = () => Date.parse('2026-11-22T12:00:00Z');
const uid = () => `u${Math.random().toString(36).slice(2, 10)}`;
const deps = (envOver: Record<string, string> = KEY_ENV, f = fakeLlm()) => makeDeps({ llm: f.llm, now: NOW }, envOver as never);

async function saveOwnKey(userId: string, provider = 'anthropic', key = 'sk-own-123456') {
  await env.DB.prepare('INSERT INTO ai_keys (user_id, provider, base_url, quick_model, coach_model, key_box, key_hint, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)')
    .bind(userId, provider, 'claude-haiku-5-5', 'claude-sonnet-5-5', await encryptForUser(key, userId, env.TOKEN_KEY), '…3456', '2026-11-22T00:00:00Z').run();
}

describe('chooseAi', () => {
  test('included AI counts and stops at the limit', async () => {
    const id = uid(); await addUser(id);
    const d = deps();
    for (let i = 0; i < 20; i++) expect('client' in (await chooseAi(d, id, 'quick'))).toBe(true);
    const r = await chooseAi(d, id, 'quick');
    expect(r).toMatchObject({ error: 'limit', used: 20, limit: 20 });
    expect((await aiUsage(d, id)).quick).toEqual({ used: 20, limit: 20 });
  });

  test('concurrent last use: exactly one wins', async () => {
    const id = uid(); await addUser(id);
    await env.DB.prepare("INSERT INTO ai_usage (user_id, month, quick, coach) VALUES (?, '2026-11', 19, 0)").bind(id).run();
    const rs = await Promise.all([chooseAi(deps(), id, 'quick'), chooseAi(deps(), id, 'quick')]);
    expect(rs.filter((r) => 'client' in r)).toHaveLength(1);
    expect(rs.filter((r) => 'error' in r && r.error === 'limit')).toHaveLength(1);
  });

  test('release refunds a reserved use', async () => {
    const id = uid(); await addUser(id, 'pro');
    const d = deps();
    const r = await chooseAi(d, id, 'coach');
    if (!('client' in r)) throw new Error('expected a client');
    expect((await aiUsage(d, id)).coach.used).toBe(1);
    await r.release();
    expect((await aiUsage(d, id)).coach).toEqual({ used: 0, limit: 150 });
  });

  test('included uses the default models and the server key', async () => {
    const id = uid(); await addUser(id, 'pro');
    const f = fakeLlm();
    const r = await chooseAi(deps(KEY_ENV, f), id, 'coach');
    expect('client' in r && r.via).toBe('included');
    expect(f.built[0]).toMatchObject({ provider: 'anthropic', apiKey: 'sk-included', model: 'claude-sonnet-5-5' });
  });

  test('own key wins and is never counted', async () => {
    const id = uid(); await addUser(id); await saveOwnKey(id);
    const f = fakeLlm();
    const d = deps(KEY_ENV, f);
    const r = await chooseAi(d, id, 'coach');
    expect('client' in r && r.via).toBe('own');
    expect(f.built[0]).toMatchObject({ apiKey: 'sk-own-123456', model: 'claude-sonnet-5-5' });
    expect((await aiUsage(d, id)).coach.used).toBe(0);
  });

  test('no AI anywhere → no_ai', async () => {
    const id = uid(); await addUser(id);
    expect(await chooseAi(deps({}), id, 'quick')).toMatchObject({ error: 'no_ai', message: expect.stringContaining('Settings → AI & apps') });
  });

  test('free plan has no Ask AI on the included model', async () => {
    const id = uid(); await addUser(id);
    expect(await chooseAi(deps(), id, 'coach')).toMatchObject({ error: 'limit', limit: 0, message: expect.stringContaining('Pro') });
  });

  test('self-hosted is unlimited', async () => {
    const id = uid(); await addUser(id);
    const d = deps({ ...KEY_ENV, SELF_HOSTED: 'true' });
    expect('client' in (await chooseAi(d, id, 'coach'))).toBe(true);
    expect((await aiUsage(d, id)).coach.limit).toBeNull();
  });

  test('unreadable own key → key_unreadable, no fallback', async () => {
    const id = uid(); await addUser(id); await saveOwnKey(id);
    await env.DB.prepare("UPDATE ai_keys SET key_box = 'u1.AAAA.BBBB' WHERE user_id = ?").bind(id).run();
    const f = fakeLlm();
    expect(await chooseAi(deps(KEY_ENV, f), id, 'quick')).toMatchObject({ error: 'key_unreadable', message: expect.stringContaining('Save it again') });
    expect(f.built).toHaveLength(0);
  });
});

test('llmFailure: own key refused says to update it', () => {
  expect(llmFailure({ error: 'auth', message: 'x' }, 'own', 'anthropic')).toEqual({ error: 'auth', status: 400, message: 'Your Anthropic (Claude) key was refused. Update it in Settings → AI & apps.' });
  expect(llmFailure({ error: 'rate_limited', message: 'x' }, 'own', 'openai').status).toBe(429);
  expect(llmFailure({ error: 'unavailable', message: 'x' }, 'included', 'anthropic').status).toBe(502);
});

test('a key box only opens for its own user', async () => {
  const box = await encryptForUser('secret', 'userA', env.TOKEN_KEY);
  expect(box.startsWith('u1.')).toBe(true);
  expect(await decryptForUser(box, 'userA', env.TOKEN_KEY)).toBe('secret');
  await expect(decryptForUser(box, 'userB', env.TOKEN_KEY)).rejects.toThrow();
});

describe('key routes', () => {
  test('save stores only after a successful test call; status never shows the key', async () => {
    const id = uid(); await addUser(id); const cookie = await sessionCookie(id);
    const f = fakeLlm();
    const app = createApp(deps(KEY_ENV, f));
    const res = await sendJsonReq(app, 'POST', '/api/ai/key', cookie, { provider: 'anthropic', apiKey: 'sk-ant-secret-9876' });
    expect(res.status).toBe(200);
    expect(f.requests[0]!.model).toBe('claude-haiku-5-5');
    const status = await (await app.request('/api/ai/status', { headers: { cookie } })).text();
    expect(status).not.toContain('sk-ant-secret-9876');
    expect(JSON.parse(status).own).toMatchObject({ provider: 'anthropic', keyHint: '…9876', quickModel: 'claude-haiku-5-5' });
    expect(JSON.parse(status).included).toMatchObject({ provider: 'anthropic', quickModel: 'claude-haiku-5-5' });
  });

  test('a refused key is not saved', async () => {
    const id = uid(); await addUser(id); const cookie = await sessionCookie(id);
    const app = createApp(deps(KEY_ENV, fakeLlm(() => ({ error: 'auth', message: 'invalid x-api-key' }))));
    const res = await sendJsonReq(app, 'POST', '/api/ai/key', cookie, { provider: 'anthropic', apiKey: 'sk-bad-key-0000' });
    expect(res.status).toBe(400);
    expect((await res.json() as { message: string }).message).toContain('was refused');
    expect(await env.DB.prepare('SELECT 1 FROM ai_keys WHERE user_id = ?').bind(id).first()).toBeNull();
  });

  test('a truncated test answer still counts as a working key', async () => {
    const id = uid(); await addUser(id); const cookie = await sessionCookie(id);
    const app = createApp(deps(KEY_ENV, fakeLlm(() => ({ error: 'truncated', message: 'cut' }))));
    expect((await sendJsonReq(app, 'POST', '/api/ai/key', cookie, { provider: 'anthropic', apiKey: 'sk-ok-key-1111' })).status).toBe(200);
  });

  test('providers without default models need model names', async () => {
    const id = uid(); await addUser(id); const cookie = await sessionCookie(id);
    const app = createApp(deps(KEY_ENV));
    expect((await sendJsonReq(app, 'POST', '/api/ai/key', cookie, { provider: 'openai', apiKey: 'sk-openai-1234' })).status).toBe(400);
    expect((await sendJsonReq(app, 'POST', '/api/ai/key', cookie, { provider: 'openai', apiKey: 'sk-openai-1234', quickModel: 'mini-1', coachModel: 'big-1' })).status).toBe(200);
  });

  test('custom servers only when self-hosted', async () => {
    const id = uid(); await addUser(id); const cookie = await sessionCookie(id);
    const body = { provider: 'custom', apiKey: 'none-needed', quickModel: 'llama3', coachModel: 'llama3', baseUrl: 'http://localhost:11434/v1' };
    const hosted = await sendJsonReq(createApp(deps(KEY_ENV)), 'POST', '/api/ai/key', cookie, body);
    expect(hosted.status).toBe(400);
    expect((await hosted.json() as { message: string }).message).toBe('Custom servers are only available when you host ViewProof yourself.');
    const f = fakeLlm();
    expect((await sendJsonReq(createApp(deps({ ...KEY_ENV, SELF_HOSTED: 'true' }, f)), 'POST', '/api/ai/key', cookie, body)).status).toBe(200);
    expect(f.built[0]).toMatchObject({ provider: 'custom', baseUrl: 'http://localhost:11434/v1' });
  });

  test('invalid input is refused', async () => {
    const id = uid(); await addUser(id); const cookie = await sessionCookie(id);
    const app = createApp(deps(KEY_ENV));
    for (const body of [{ provider: 'nope', apiKey: 'sk-12345678' }, { provider: 'anthropic', apiKey: 'short' }, { provider: 'anthropic', apiKey: 'sk-12345678', quickModel: 'bad model!' }]) {
      expect((await sendJsonReq(app, 'POST', '/api/ai/key', cookie, body)).status).toBe(400);
    }
  });

  test('delete removes the key; signed out gets 401', async () => {
    const id = uid(); await addUser(id); await saveOwnKey(id); const cookie = await sessionCookie(id);
    const app = createApp(deps(KEY_ENV));
    expect((await sendJsonReq(app, 'DELETE', '/api/ai/key', cookie)).status).toBe(200);
    expect(await env.DB.prepare('SELECT 1 FROM ai_keys WHERE user_id = ?').bind(id).first()).toBeNull();
    expect((await app.request('/api/ai/status')).status).toBe(401);
  });
});

describe('account', () => {
  test('export shows the key hint, never the key; delete removes AI rows', async () => {
    const id = uid(); await addUser(id); await saveOwnKey(id, 'anthropic', 'sk-own-ZZZZ9999'); const cookie = await sessionCookie(id);
    await env.DB.prepare("INSERT INTO ai_usage (user_id, month, quick, coach) VALUES (?, '2026-11', 3, 1)").bind(id).run();
    const app = createApp(deps(KEY_ENV));
    const text = await (await app.request('/account/export', { headers: { cookie } })).text();
    expect(text).not.toContain('sk-own-ZZZZ9999');
    expect(JSON.parse(text)).toMatchObject({ ai: { provider: 'anthropic', keyHint: '…3456' }, aiUsage: [{ month: '2026-11', quick: 3, coach: 1 }] });
    await app.request('/account/delete', { method: 'POST', headers: { origin: 'http://localhost:8787', cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'confirm=delete' });
    expect(await env.DB.prepare('SELECT 1 FROM ai_keys WHERE user_id = ?').bind(id).first()).toBeNull();
    expect(await env.DB.prepare('SELECT 1 FROM ai_usage WHERE user_id = ?').bind(id).first()).toBeNull();
  });
});
