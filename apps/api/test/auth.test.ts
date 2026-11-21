import { env } from 'cloudflare:test';
import { describe, expect, test, vi } from 'vitest';
import { createApp } from '../src/app';
import { SCOPES, type GoogleClient, type MyChannel, type TokenSet } from '../src/google';
import { fakeGoogle } from './fake-google';
import { addUser, cookieFrom, makeDeps, mergeCookies, readText } from './helpers';

const ALL = [...SCOPES.signIn, ...SCOPES.channel];
const CHANNEL: MyChannel = { channelId: 'UCqhp', title: 'Quiet Hands Pottery', handle: '@quiethands', avatarUrl: 'https://yt3.ggpht.com/a.jpg', subscriberCount: 12345, videoCount: 41 };
const tokens = (over: Partial<TokenSet> = {}): TokenSet => ({ accessToken: 'at', refreshToken: 'rt', scopes: ALL, idClaims: { sub: 'g-new', email: 'new@example.com', name: 'New' }, ...over });

function setup(google: Partial<GoogleClient> = {}, now?: () => number) {
  const g = fakeGoogle({ exchangeCode: async () => tokens(), myChannels: async () => [CHANNEL], ...google });
  const deps = makeDeps({ google: g, ...(now ? { now } : {}) });
  return { app: createApp(deps), g };
}
let lastJar = '';
async function start(app: ReturnType<typeof createApp>, query = '', cookie?: string) {
  const res = await app.request(`/auth/google/start${query}`, { headers: cookie ? { cookie } : {} });
  lastJar = mergeCookies(cookie, res);
  return { res, state: new URL(res.headers.get('location')!).searchParams.get('state')!, jar: lastJar };
}
/** Callback from the same browser that started (carries the start cookies) unless a jar is given. */
const callback = (app: ReturnType<typeof createApp>, q: string, jar = lastJar) => app.request(`/auth/google/callback?${q}`, { headers: jar ? { cookie: jar } : {} });
const pendingCount = async (sub: string) =>
  (await env.DB.prepare('SELECT COUNT(*) AS n FROM pending_connections p JOIN users u ON u.id = p.user_id WHERE u.google_sub = ?').bind(sub).first<{ n: number }>())!.n;

describe('sign-in', () => {
  test('start stores state and redirects to Google', async () => {
    const { app } = setup();
    const { res, state } = await start(app);
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('location')!).host).toBe('accounts.google.com');
    expect(await env.DB.prepare('SELECT state FROM oauth_states WHERE state = ?').bind(state).first()).not.toBeNull();
  });

  test('new user is created, session set, pending channel stored', async () => {
    const { app } = setup({ exchangeCode: async () => tokens({ idClaims: { sub: 'g-a1', email: 'a1@example.com', name: 'A1' } }) });
    const { state } = await start(app);
    const res = await callback(app, `state=${state}&code=c1`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toMatch(/^\/connect\/confirm\?id=/);
    expect(res.headers.get('set-cookie')).toContain('vp_session=');
    const u = await env.DB.prepare('SELECT email, plan FROM users WHERE google_sub = ?').bind('g-a1').first();
    expect(u).toEqual({ email: 'a1@example.com', plan: 'free' });
    const p = await env.DB.prepare('SELECT p.channel_id, p.refresh_token_enc FROM pending_connections p JOIN users u ON u.id = p.user_id WHERE u.google_sub = ?').bind('g-a1').first<{ channel_id: string; refresh_token_enc: string }>();
    expect(p!.channel_id).toBe('UCqhp');
    expect(p!.refresh_token_enc.startsWith('v1.')).toBe(true);
    expect(p!.refresh_token_enc).not.toContain('rt');
  });

  test('existing user is reused', async () => {
    await addUser('exist1');
    const { app } = setup({ exchangeCode: async () => tokens({ idClaims: { sub: 'sub-exist1' } }) });
    const { state } = await start(app);
    await callback(app, `state=${state}&code=c`);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE google_sub = ?').bind('sub-exist1').first<{ n: number }>();
    expect(n!.n).toBe(1);
    expect(await pendingCount('sub-exist1')).toBe(1);
  });

  test('a signed-in user connecting another channel keeps their account', async () => {
    await addUser('signed1');
    const { app: a0 } = setup({ exchangeCode: async () => tokens({ idClaims: { sub: 'sub-signed1' } }) });
    const first = await start(a0);
    const cookie = mergeCookies(first.jar, await callback(a0, `state=${first.state}&code=c`));
    const { app } = setup({ exchangeCode: async () => tokens({ idClaims: { sub: 'brand-account-sub' } }) });
    const { state, jar } = await start(app, '', cookie);
    await callback(app, `state=${state}&code=c2`, jar);
    expect(await env.DB.prepare('SELECT id FROM users WHERE google_sub = ?').bind('brand-account-sub').first()).toBeNull();
    expect(await pendingCount('sub-signed1')).toBe(2);
  });

  test('state is single use', async () => {
    const { app } = setup({ exchangeCode: async () => tokens({ idClaims: { sub: 'g-once' } }) });
    const { state } = await start(app);
    await callback(app, `state=${state}&code=c`);
    const again = await callback(app, `state=${state}&code=c`);
    expect(again.status).toBe(400);
    expect(await readText(again)).toContain('This link has expired. Please start again.');
  });

  test('expired state', async () => {
    let t = Date.now();
    const { app } = setup({}, () => t);
    const { state } = await start(app);
    t += 11 * 60_000;
    expect(await readText(await callback(app, `state=${state}&code=c`))).toContain('This link has expired. Please start again.');
  });

  test('unknown state', async () => {
    const { app } = setup();
    expect(await readText(await callback(app, 'state=forged&code=c'))).toContain('This link has expired. Please start again.');
  });

  test('denied consent', async () => {
    const { app, g } = setup();
    const { state } = await start(app);
    const res = await callback(app, `state=${state}&error=access_denied`);
    expect(await readText(res)).toContain('You cancelled the Google sign-in. Nothing was connected.');
    expect(g.calls).not.toContain('exchangeCode');
  });

  test('missing youtube scope: names it, stores nothing, revokes access', async () => {
    const { app, g } = setup({ exchangeCode: async () => tokens({ scopes: [...SCOPES.signIn, SCOPES.channel[0]], idClaims: { sub: 'g-noscope' } }) });
    const { state } = await start(app);
    const html = await readText(await callback(app, `state=${state}&code=c`));
    expect(html).toContain('ViewProof needs permission to view your YouTube channel and its analytics.');
    expect(html).toContain('Missing: YouTube analytics');
    expect(await pendingCount('g-noscope')).toBe(0);
    expect(g.calls).toContain('revoke');
  });

  test('no refresh token even after asking for consent', async () => {
    const { app, g } = setup({ exchangeCode: async () => tokens({ refreshToken: null, idClaims: { sub: 'g-nort' } }) });
    const { state } = await start(app, '?consent=1');
    expect(await readText(await callback(app, `state=${state}&code=c`))).toContain("Google didn't give us lasting access. Please start again.");
    expect(await pendingCount('g-nort')).toBe(0);
    expect(g.calls).toContain('revoke');
  });

  test('account without a channel', async () => {
    const { app } = setup({ myChannels: async () => [], exchangeCode: async () => tokens({ idClaims: { sub: 'g-nochan' } }) });
    const { state } = await start(app);
    expect(await readText(await callback(app, `state=${state}&code=c`))).toContain('This Google account has no YouTube channel. Pick the account that owns your channel.');
  });

  test('Google failure is shown with its reason', async () => {
    const { app } = setup({ exchangeCode: async () => ({ kind: 'failed', reason: 'HTTP 500' }) });
    const { state } = await start(app);
    expect(await readText(await callback(app, `state=${state}&code=c`))).toContain('Google sign-in failed: HTTP 500.');
  });

  test('revenue scope requested only when asked; chooser only when asked', async () => {
    const authUrl = vi.fn((a: Parameters<GoogleClient['authUrl']>[0]) => `https://accounts.google.com/x?state=${a.state}`);
    const { app } = setup({ authUrl });
    await start(app);
    await start(app, '?revenue=1&choose=1');
    expect(authUrl.mock.calls[0]![0]).toMatchObject({ wantRevenue: false, chooseAccount: false });
    expect(authUrl.mock.calls[1]![0]).toMatchObject({ wantRevenue: true, chooseAccount: true });
  });
});
