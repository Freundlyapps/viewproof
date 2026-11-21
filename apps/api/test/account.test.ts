import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import { createApp } from '../src/app';
import type { GoogleClient } from '../src/google';
import { fakeGoogle } from './fake-google';
import { channelFixture, makeDeps, post, readText, signIn } from './helpers';

async function connected(sub: string, channelId: string, google: Partial<GoogleClient> = {}) {
  const s = await signIn({ sub, channel: channelFixture({ channelId, title: `Title ${channelId}` }) });
  await post(s.app, '/connect/confirm', s.cookie, { id: s.pendingId });
  const row = await env.DB.prepare('SELECT id FROM channels WHERE channel_id = ?').bind(channelId).first<{ id: string }>();
  const g = fakeGoogle({ refresh: async () => ({ accessToken: 'fresh' }), myChannels: async () => [channelFixture({ channelId, title: `Title ${channelId}` })], ...google });
  return { app: createApp(makeDeps({ google: g })), cookie: s.cookie, rowId: row!.id, g };
}
const status = (channelId: string) => env.DB.prepare('SELECT status, status_reason FROM channels WHERE channel_id = ?').bind(channelId).first<{ status: string; status_reason: string | null }>();

describe('account page', () => {
  test('signed out redirects to sign-in', async () => {
    const res = await createApp(makeDeps()).request('/account');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/auth/google/start');
  });

  test('lists channels with their status and plan usage', async () => {
    const { app, cookie } = await connected('a-list', 'UClist');
    await env.DB.prepare("UPDATE channels SET status = 'gone', status_reason = 'YouTube no longer returns this channel' WHERE channel_id = 'UClist'").run();
    const html = await readText(await app.request('/account', { headers: { cookie } }));
    for (const s of ['Title UClist', 'No longer exists', 'YouTube no longer returns this channel', 'Remove', 'Free plan', '1 of 1 channel', 'Export my data', 'Delete account']) expect(html).toContain(s);
  });

  test('reconnect status offers Reconnect', async () => {
    const { app, cookie } = await connected('a-rec', 'UCrec');
    await env.DB.prepare("UPDATE channels SET status = 'reconnect' WHERE channel_id = 'UCrec'").run();
    const html = await readText(await app.request('/account', { headers: { cookie } }));
    expect(html).toContain('Reconnect needed');
    expect(html).toContain('href="/auth/google/start?choose=1"');
  });
});

describe('channel check', () => {
  test('still there: active, verified now', async () => {
    const { app, cookie, rowId } = await connected('a-ok', 'UCok');
    const res = await post(app, `/channels/${rowId}/check`, cookie);
    expect(res.headers.get('location')).toBe('/account');
    expect(await status('UCok')).toEqual({ status: 'active', status_reason: null });
  });

  test('invalid_grant marks reconnect', async () => {
    const { app, cookie, rowId } = await connected('a-revoked', 'UCrevoked', { refresh: async () => ({ kind: 'revoked' }) });
    await post(app, `/channels/${rowId}/check`, cookie);
    expect(await status('UCrevoked')).toEqual({ status: 'reconnect', status_reason: 'Google access was removed or expired' });
  });

  test('empty channel list marks gone', async () => {
    const { app, cookie, rowId } = await connected('a-gone', 'UCgone', { myChannels: async () => [] });
    await post(app, `/channels/${rowId}/check`, cookie);
    expect(await status('UCgone')).toEqual({ status: 'gone', status_reason: 'YouTube no longer returns this channel' });
  });

  test('transient failure keeps status and says why', async () => {
    const { app, cookie, rowId } = await connected('a-flaky', 'UCflaky', { myChannels: async () => ({ kind: 'failed', reason: 'HTTP 503' }) });
    await post(app, `/channels/${rowId}/check`, cookie);
    expect(await status('UCflaky')).toEqual({ status: 'active', status_reason: 'Check failed: HTTP 503' });
  });
});

describe('remove and ownership', () => {
  test('remove revokes and deletes', async () => {
    const { app, cookie, rowId, g } = await connected('a-rm', 'UCrm');
    const res = await post(app, `/channels/${rowId}/remove`, cookie);
    expect(res.headers.get('location')).toBe('/account');
    expect(await status('UCrm')).toBeNull();
    expect(g.calls).toContain('revoke');
  });

  test("cannot touch another user's channel", async () => {
    const a = await connected('a-own', 'UCown');
    const b = await connected('a-intruder', 'UCintruder');
    expect((await post(b.app, `/channels/${a.rowId}/remove`, b.cookie)).status).toBe(404);
    expect((await post(b.app, `/channels/${a.rowId}/check`, b.cookie)).status).toBe(404);
    expect(await status('UCown')).not.toBeNull();
  });
});

describe('json api', () => {
  test('signed out is 401', async () => {
    const app = createApp(makeDeps());
    expect((await app.request('/api/me')).status).toBe(401);
    expect((await app.request('/api/channels')).status).toBe(401);
  });

  test('me and channels; never includes tokens', async () => {
    const { app, cookie } = await connected('a-json', 'UCjson');
    const me = await (await app.request('/api/me', { headers: { cookie } })).json();
    expect(me).toMatchObject({ email: 'a-json@example.com', plan: 'free', maxChannels: 1 });
    const res = await app.request('/api/channels', { headers: { cookie } });
    const text = await res.text();
    expect(JSON.parse(text)).toEqual([expect.objectContaining({ channelId: 'UCjson', title: 'Title UCjson', status: 'active', statusReason: null, revenueAccess: false })]);
    const enc = (await env.DB.prepare('SELECT refresh_token_enc FROM channels WHERE channel_id = ?').bind('UCjson').first<{ refresh_token_enc: string }>())!.refresh_token_enc;
    expect(text).not.toContain(enc);
    expect(text).not.toContain('v1.');
    expect(text).not.toContain('refresh');
  });
});
