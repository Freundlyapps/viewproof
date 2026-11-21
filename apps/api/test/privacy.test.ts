import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import { createApp } from '../src/app';
import { fakeGoogle } from './fake-google';
import { channelFixture, makeDeps, post, readText, signIn } from './helpers';

async function userWithChannel(sub: string, channelId: string) {
  const s = await signIn({ sub, channel: channelFixture({ channelId }) });
  await post(s.app, '/connect/confirm', s.cookie, { id: s.pendingId });
  const g = fakeGoogle();
  return { app: createApp(makeDeps({ google: g })), cookie: s.cookie, g };
}
const count = async (sql: string, ...args: string[]) => (await env.DB.prepare(sql).bind(...args).first<{ n: number }>())!.n;

describe('export', () => {
  test('downloads JSON with the user and channels, without any secret', async () => {
    const { app, cookie } = await userWithChannel('p-exp', 'UCexp');
    const res = await app.request('/account/export', { headers: { cookie } });
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="viewproof-export.json"');
    const text = await res.text();
    const data = JSON.parse(text);
    expect(data.user).toMatchObject({ email: 'p-exp@example.com', plan: 'free' });
    expect(data.channels).toEqual([expect.objectContaining({ channelId: 'UCexp', status: 'active' })]);
    expect(typeof data.exportedAt).toBe('string');
    const enc = (await env.DB.prepare('SELECT refresh_token_enc FROM channels WHERE channel_id = ?').bind('UCexp').first<{ refresh_token_enc: string }>())!.refresh_token_enc;
    const hashes = (await env.DB.prepare('SELECT s.id_hash FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.google_sub = ?').bind('p-exp').all<{ id_hash: string }>()).results;
    expect(text).not.toContain(enc);
    expect(text).not.toContain('v1.');
    expect(text).not.toMatch(/refresh/i);
    for (const h of hashes) expect(text).not.toContain(h.id_hash);
  });

  test('signed out redirects', async () => {
    expect((await createApp(makeDeps()).request('/account/export')).status).toBe(302);
  });
});

describe('delete account', () => {
  test('without typing "delete" nothing happens', async () => {
    const { app, cookie, g } = await userWithChannel('p-keep', 'UCkeep');
    const res = await post(app, '/account/delete', cookie, { confirm: 'yes' });
    expect(res.status).toBe(400);
    expect(await readText(res)).toContain('Type "delete" to confirm.');
    expect(await count("SELECT COUNT(*) AS n FROM users WHERE google_sub = ?", 'p-keep')).toBe(1);
    expect(g.calls).not.toContain('revoke');
  });

  test('revokes every token and removes all the user’s rows, nobody else’s', async () => {
    const other = await userWithChannel('p-other', 'UCother2');
    const { app, cookie, g } = await userWithChannel('p-del', 'UCdel');
    const uid = (await env.DB.prepare('SELECT id FROM users WHERE google_sub = ?').bind('p-del').first<{ id: string }>())!.id;
    await env.DB.prepare("INSERT INTO pending_connections (id, user_id, channel_id, scopes, refresh_token_enc, created_at) VALUES ('pend-del', ?, 'UCx', 's', 'v1.a.b', '2026-11-21T00:00:00Z')").bind(uid).run();

    const res = await post(app, '/account/delete', cookie, { confirm: 'delete' });
    expect(await readText(res)).toContain('Your account and all its data were deleted.');
    expect(res.headers.get('set-cookie')).toMatch(/vp_session=;.*Max-Age=0/);
    expect(g.calls.filter((c) => c === 'revoke')).toHaveLength(1);
    for (const t of ['sessions', 'channels', 'pending_connections']) expect(await count(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`, uid)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM users WHERE id = ?', uid)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM channels WHERE channel_id = 'UCother2'")).toBe(1);
    expect((await other.app.request('/account', { headers: { cookie: other.cookie } })).status).toBe(200);
  });
});
