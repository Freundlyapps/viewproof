import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import { createApp } from '../src/app';
import { parseConfig } from '../src/env';
import { SCOPES } from '../src/google';
import { fakeGoogle } from './fake-google';
import { ALL_SCOPES, APP, channelFixture, makeDeps, mergeCookies, post, readText, signIn } from './helpers';

const OTHER_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
const count = async (sql: string, ...a: unknown[]) => (await env.DB.prepare(sql).bind(...a).first<{ n: number }>())!.n;
async function connectedUser(sub: string, channelId: string) {
  const s = await signIn({ sub, channel: channelFixture({ channelId }) });
  await post(s.app, '/connect/confirm', s.cookie, { id: s.pendingId });
  return s;
}

describe('C1: sign-in is bound to the browser that started it', () => {
  test('callback without the start cookie is refused and the state is not consumed', async () => {
    const app = createApp(makeDeps({ google: fakeGoogle() }));
    const start = await app.request('/auth/google/start');
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const res = await app.request(`/auth/google/callback?state=${state}&code=c`); // victim's browser: no cookie
    expect(await readText(res)).toContain('This link has expired. Please start again.');
    expect(await env.DB.prepare('SELECT state FROM oauth_states WHERE state = ?').bind(state).first()).not.toBeNull();
  });

  test("a victim's existing session is never replaced by an attacker's callback", async () => {
    const victim = await connectedUser('sec-victim', 'UCvictim');
    const attackerApp = createApp(makeDeps({ google: fakeGoogle() }));
    const start = await attackerApp.request('/auth/google/start');
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const res = await attackerApp.request(`/auth/google/callback?state=${state}&code=c`, { headers: { cookie: victim.cookie } });
    expect(res.headers.getSetCookie().some((c) => /vp_session=[^;]/.test(c))).toBe(false);
  });

  test('a state started by one user cannot finish in another user’s session', async () => {
    const a = await connectedUser('sec-a', 'UCseca');
    const b = await connectedUser('sec-b', 'UCsecb');
    const start = await a.app.request('/auth/google/start', { headers: { cookie: a.cookie } });
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const oauth = mergeCookies('', start);
    const res = await a.app.request(`/auth/google/callback?state=${state}&code=c`, { headers: { cookie: `${b.cookie}; ${oauth}` } });
    expect(await readText(res)).toContain('This link has expired. Please start again.');
  });
});

describe('I1: never revoke access that a connected channel still uses', () => {
  test('Pick another on an already-connected channel does not revoke', async () => {
    const owner = await connectedUser('sec-pick', 'UCpickown');
    // a stale pending row for the same channel (e.g. started in another tab before connecting)
    const uid = (await env.DB.prepare("SELECT id FROM users WHERE google_sub = 'sec-pick'").first<{ id: string }>())!.id;
    const enc = (await env.DB.prepare("SELECT refresh_token_enc FROM channels WHERE channel_id = 'UCpickown'").first<{ refresh_token_enc: string }>())!.refresh_token_enc;
    await env.DB.prepare("INSERT INTO pending_connections (id, user_id, channel_id, scopes, refresh_token_enc, created_at) VALUES ('pend-pick', ?, 'UCpickown', ?, ?, ?)").bind(uid, ALL_SCOPES.join(' '), enc, new Date().toISOString()).run();
    const g = fakeGoogle();
    const res = await post(createApp(makeDeps({ google: g })), '/connect/cancel', owner.cookie, { id: 'pend-pick' });
    expect(res.status).toBe(302);
    expect(g.calls).not.toContain('revoke');
  });

  test('a second person trying to connect a connected channel does not break it', async () => {
    await connectedUser('sec-mgrA', 'UCbrand');
    const b = await connectedUser('sec-mgrB-own', 'UCmgrB'); // B is signed in with their own channel
    const g = fakeGoogle({ exchangeCode: async () => ({ accessToken: 'at', refreshToken: 'rt-b', scopes: ALL_SCOPES, idClaims: { sub: 'sec-brand-identity' } }), myChannels: async () => [channelFixture({ channelId: 'UCbrand' })] });
    const app = createApp(makeDeps({ google: g }));
    const start = await app.request('/auth/google/start', { headers: { cookie: b.cookie } });
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const res = await app.request(`/auth/google/callback?state=${state}&code=c`, { headers: { cookie: mergeCookies(b.cookie, start) } });
    expect(await readText(res)).toContain('This channel is already connected to another ViewProof account.');
    expect(g.calls).not.toContain('revoke');
    expect(await count("SELECT COUNT(*) AS n FROM channels WHERE channel_id = 'UCbrand' AND status = 'active'")).toBe(1);
  });

  test('unticked permission on a connected channel does not revoke', async () => {
    const owner = await connectedUser('sec-untick', 'UCuntick');
    const g = fakeGoogle({ exchangeCode: async () => ({ accessToken: 'at', refreshToken: 'rt', scopes: [...SCOPES.signIn, SCOPES.channel[0]], idClaims: { sub: 'sec-untick' } }), myChannels: async () => [channelFixture({ channelId: 'UCuntick' })] });
    const app = createApp(makeDeps({ google: g }));
    const start = await app.request('/auth/google/start', { headers: { cookie: owner.cookie } });
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const res = await app.request(`/auth/google/callback?state=${state}&code=c`, { headers: { cookie: mergeCookies(owner.cookie, start) } });
    expect(await readText(res)).toContain('Missing: YouTube analytics');
    expect(g.calls).not.toContain('revoke');
  });
});

describe('I2: returning users land in their own account', () => {
  test('signing in (signed out) with an already-connected channel opens that account; no second account', async () => {
    await connectedUser('sec-wrong-identity', 'UCright'); // account keyed to another sub owns UCright
    const again = await signIn({ sub: 'sec-right-identity', channel: channelFixture({ channelId: 'UCright' }) });
    expect(again.callback.headers.get('location')).toBe('/account?connected=UCright');
    expect(await count("SELECT COUNT(*) AS n FROM users WHERE google_sub = 'sec-right-identity'")).toBe(0);
    const html = await readText(await again.app.request('/account', { headers: { cookie: again.cookie } }));
    expect(html).toContain('UCright');
    expect(again.google.calls).not.toContain('revoke');
  });

  test('an existing user whose Google account has no channel can still sign in to export or delete', async () => {
    await connectedUser('sec-nochan-later', 'UCdeleted');
    const s = await signIn({ sub: 'sec-nochan-later', google: { myChannels: async () => [] } });
    expect(s.callback.headers.get('location')).toBe('/account');
    expect((await s.app.request('/account', { headers: { cookie: s.cookie } })).status).toBe(200);
  });

  test('a brand-new Google account without a channel creates no ViewProof account', async () => {
    const s = await signIn({ sub: 'sec-new-nochan', google: { myChannels: async () => [] } });
    expect(await readText(s.callback)).toContain('This Google account has no YouTube channel.');
    expect(await count("SELECT COUNT(*) AS n FROM users WHERE google_sub = 'sec-new-nochan'")).toBe(0);
  });
});

describe('I3: confirming is atomic', () => {
  test('two confirms at once on a Free plan connect only one channel', async () => {
    const a = await signIn({ sub: 'sec-race', channel: channelFixture({ channelId: 'UCrace1' }) });
    const b = await signIn({ sub: 'sec-race', channel: channelFixture({ channelId: 'UCrace2' }), cookie: a.cookie });
    await Promise.all([post(a.app, '/connect/confirm', a.cookie, { id: a.pendingId }), post(b.app, '/connect/confirm', a.cookie, { id: b.pendingId })]);
    expect(await count("SELECT COUNT(*) AS n FROM channels WHERE channel_id IN ('UCrace1','UCrace2')")).toBe(1);
  });

  test('a double click never shows an error page', async () => {
    const s = await signIn({ sub: 'sec-dbl', channel: channelFixture({ channelId: 'UCdbl' }) });
    const [r1, r2] = await Promise.all([post(s.app, '/connect/confirm', s.cookie, { id: s.pendingId }), post(s.app, '/connect/confirm', s.cookie, { id: s.pendingId })]);
    expect([r1.status, r2.status]).toEqual([302, 302]);
    expect(await count("SELECT COUNT(*) AS n FROM channels WHERE channel_id = 'UCdbl'")).toBe(1);
  });
});

describe('I4: a changed encryption key never traps the user', () => {
  test('a bad TOKEN_KEY fails at startup', () => {
    expect(() => parseConfig({ ...env, TOKEN_KEY: btoa('short') })).toThrow('TOKEN_KEY must be 32 bytes');
  });

  test('delete account still works after the key changed', async () => {
    const s = await connectedUser('sec-rekey-del', 'UCrekeydel');
    const app = createApp(makeDeps({ google: fakeGoogle() }, { TOKEN_KEY: OTHER_KEY }));
    const res = await post(app, '/account/delete', s.cookie, { confirm: 'delete' });
    const text = await readText(res);
    expect(text).toContain('Your account and all its data were deleted.');
    expect(text).toContain('myaccount.google.com');
    expect(await count("SELECT COUNT(*) AS n FROM users WHERE google_sub = 'sec-rekey-del'")).toBe(0);
  });

  test('check after the key changed asks to reconnect', async () => {
    const s = await connectedUser('sec-rekey-chk', 'UCrekeychk');
    const id = (await env.DB.prepare("SELECT id FROM channels WHERE channel_id = 'UCrekeychk'").first<{ id: string }>())!.id;
    const res = await post(createApp(makeDeps({ google: fakeGoogle() }, { TOKEN_KEY: OTHER_KEY })), `/channels/${id}/check`, s.cookie);
    expect(res.status).toBe(302);
    expect(await env.DB.prepare('SELECT status, status_reason FROM channels WHERE id = ?').bind(id).first()).toEqual({ status: 'reconnect', status_reason: "Stored access can't be read; reconnect" });
  });

  test('remove after the key changed still removes, and says how to revoke by hand', async () => {
    const s = await connectedUser('sec-rekey-rm', 'UCrekeyrm');
    const id = (await env.DB.prepare("SELECT id FROM channels WHERE channel_id = 'UCrekeyrm'").first<{ id: string }>())!.id;
    const app = createApp(makeDeps({ google: fakeGoogle() }, { TOKEN_KEY: OTHER_KEY }));
    const res = await post(app, `/channels/${id}/remove`, s.cookie);
    expect(res.headers.get('location')).toBe('/account?note=revoke-by-hand');
    expect(await count("SELECT COUNT(*) AS n FROM channels WHERE id = ?", id)).toBe(0);
    expect(await readText(await app.request('/account?note=revoke-by-hand', { headers: { cookie: s.cookie } }))).toContain('myaccount.google.com');
  });
});

describe('cleanup, reflection, origin, cookie name, export', () => {
  test('old sign-in states are cleaned up when a new sign-in starts', async () => {
    await env.DB.prepare("INSERT INTO oauth_states (state, code_verifier, want_revenue, created_at) VALUES ('stale-state', 'v', 0, '2026-01-01T00:00:00Z')").run();
    await createApp(makeDeps()).request('/auth/google/start');
    expect(await env.DB.prepare("SELECT state FROM oauth_states WHERE state = 'stale-state'").first()).toBeNull();
  });

  test('expired pending connections are revoked unless the channel is connected', async () => {
    await connectedUser('sec-pend-owner', 'UCpendconn');
    const uid = (await env.DB.prepare("SELECT id FROM users WHERE google_sub = 'sec-pend-owner'").first<{ id: string }>())!.id;
    const enc = (await env.DB.prepare("SELECT refresh_token_enc FROM channels WHERE channel_id = 'UCpendconn'").first<{ refresh_token_enc: string }>())!.refresh_token_enc;
    for (const [id, ch] of [['pend-old-free', 'UCpendfree'], ['pend-old-conn', 'UCpendconn']]) {
      await env.DB.prepare("INSERT INTO pending_connections (id, user_id, channel_id, scopes, refresh_token_enc, created_at) VALUES (?, ?, ?, 's', ?, '2026-01-01T00:00:00Z')").bind(id, uid, ch, enc).run();
    }
    const g = fakeGoogle();
    await createApp(makeDeps({ google: g })).request('/auth/google/start');
    expect(g.calls.filter((c) => c === 'revoke')).toHaveLength(1);
    expect(await count("SELECT COUNT(*) AS n FROM pending_connections WHERE id IN ('pend-old-free','pend-old-conn')")).toBe(0);
  });

  test('error text from the link is not shown as-is', async () => {
    const app = createApp(makeDeps());
    const start = await app.request('/auth/google/start');
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const res = await app.request(`/auth/google/callback?state=${state}&error=${encodeURIComponent('Your account is suspended, call +1 555')}`, { headers: { cookie: mergeCookies('', start) } });
    const text = await readText(res);
    expect(text).not.toContain('suspended');
    expect(text).toContain('Google sign-in failed: unknown error.');
  });

  test('origin check compares normalised origins', async () => {
    const app = createApp(makeDeps({}, { APP_URL: 'http://LOCALHOST:8787/' }));
    expect((await app.request('/nope', { method: 'POST', headers: { origin: APP } })).status).toBe(404);
  });

  test('on https the session cookie uses the __Host- prefix', async () => {
    const s = await signIn({ sub: 'sec-host', channel: channelFixture({ channelId: 'UChost' }), envOver: { APP_URL: 'https://viewproof.app' } });
    expect(s.callback.headers.getSetCookie().some((c) => c.startsWith('__Host-vp_session=') && c.includes('Secure') && c.includes('Path=/'))).toBe(true);
  });

  test('export includes pending connections and sessions (dates only)', async () => {
    const s = await signIn({ sub: 'sec-export', channel: channelFixture({ channelId: 'UCexport' }) });
    const data = await (await s.app.request('/account/export', { headers: { cookie: s.cookie } })).json<{ pendingConnections: unknown[]; sessions: unknown[] }>();
    expect(data.pendingConnections).toEqual([expect.objectContaining({ channelId: 'UCexport' })]);
    expect(data.sessions).toEqual([expect.objectContaining({ createdAt: expect.any(String), expiresAt: expect.any(String) })]);
    expect(JSON.stringify(data)).not.toContain('v1.');
  });
});
