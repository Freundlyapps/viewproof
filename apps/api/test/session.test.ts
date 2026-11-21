import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import type { Deps } from '../src/app';
import { createApp } from '../src/app';
import { SESSION_COOKIE, clearSession, createSession, readSession } from '../src/session';
import { APP, addUser, cookieFrom, makeDeps } from './helpers';

function probe(deps: Deps) {
  const app = new Hono();
  app.get('/login/:id', async (c) => { await createSession(c, deps, c.req.param('id')); return c.text('ok'); });
  app.get('/me', async (c) => c.json(await readSession(c, deps)));
  app.get('/logout', async (c) => { await clearSession(c, deps); return c.text('bye'); });
  return app;
}

describe('sessions', () => {
  test('cookie flags on localhost (no Secure)', async () => {
    await addUser('s1');
    const res = await probe(makeDeps()).request('/login/s1');
    const sc = res.headers.get('set-cookie')!;
    expect(sc).toContain(`${SESSION_COOKIE}=`);
    expect(sc).toContain('HttpOnly');
    expect(sc).toContain('SameSite=Lax');
    expect(sc).toContain('Path=/');
    expect(sc).not.toContain('Secure');
  });

  test('Secure on https', async () => {
    await addUser('s2');
    const res = await probe(makeDeps({}, { APP_URL: 'https://viewproof.app' })).request('/login/s2');
    expect(res.headers.get('set-cookie')).toContain('Secure');
  });

  test('only a hash of the session id is stored', async () => {
    await addUser('s3');
    const deps = makeDeps();
    const cookie = cookieFrom(await probe(deps).request('/login/s3'));
    const raw = cookie.split('=')[1]!;
    const { results } = await env.DB.prepare('SELECT id_hash FROM sessions WHERE user_id = ?').bind('s3').all<{ id_hash: string }>();
    expect(results).toHaveLength(1);
    expect(results[0]!.id_hash).not.toBe(raw);
    expect(results[0]!.id_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await (await probe(deps).request('/me', { headers: { cookie } })).json()).toEqual({ userId: 's3' });
  });

  test('expired session is null and removed', async () => {
    await addUser('s4');
    let t = Date.now();
    const deps = makeDeps({ now: () => t });
    const cookie = cookieFrom(await probe(deps).request('/login/s4'));
    t += 31 * 86_400_000;
    expect(await (await probe(deps).request('/me', { headers: { cookie } })).json()).toBeNull();
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').bind('s4').first<{ n: number }>();
    expect(n!.n).toBe(0);
  });

  test('no cookie or unknown cookie is null', async () => {
    const app = probe(makeDeps());
    expect(await (await app.request('/me')).json()).toBeNull();
    expect(await (await app.request('/me', { headers: { cookie: `${SESSION_COOKIE}=nope` } })).json()).toBeNull();
  });

  test('clearSession deletes the row and the cookie', async () => {
    await addUser('s5');
    const deps = makeDeps();
    const cookie = cookieFrom(await probe(deps).request('/login/s5'));
    const res = await probe(deps).request('/logout', { headers: { cookie } });
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/);
    expect(await (await probe(deps).request('/me', { headers: { cookie } })).json()).toBeNull();
  });
});

describe('origin check', () => {
  test('POST without Origin is blocked', async () => {
    const res = await createApp(makeDeps()).request('/anything', { method: 'POST' });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('Request blocked (wrong origin)');
  });
  test('POST from another site is blocked', async () => {
    const res = await createApp(makeDeps()).request('/anything', { method: 'POST', headers: { origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
  });
  test('POST from our own origin passes the check', async () => {
    const res = await createApp(makeDeps()).request('/anything', { method: 'POST', headers: { origin: APP } });
    expect(res.status).toBe(404);
  });
});
