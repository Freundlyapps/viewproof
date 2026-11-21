import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import { createApp } from '../src/app';
import { ALL_SCOPES, APP, channelFixture, makeDeps, mergeCookies, post, readText, signIn } from './helpers';
import { fakeGoogle } from './fake-google';

const noRefresh = (sub: string) => async () => ({ accessToken: 'at', refreshToken: null, scopes: ALL_SCOPES, idClaims: { sub } });
const count = async (sql: string, ...a: unknown[]) => (await env.DB.prepare(sql).bind(...a).first<{ n: number }>())!.n;
async function connected(sub: string, channelId: string) {
  const s = await signIn({ sub, channel: channelFixture({ channelId }) });
  await post(s.app, '/connect/confirm', s.cookie, { id: s.pendingId });
  return s;
}
const consentOf = async (query: string, cookie?: string) => {
  const res = await createApp(makeDeps({ google: fakeGoogle() })).request(`/auth/google/start${query}`, { headers: cookie ? { cookie } : {} });
  return new URL(res.headers.get('location')!).searchParams.get('consent');
};

describe('which Google screens are asked for', () => {
  test('a plain signed-out sign-in only asks to choose the account', async () => {
    expect(await consentOf('')).toBe('0');
  });
  test('connecting, reconnecting, revenue and forced consent ask for permissions', async () => {
    expect(await consentOf('?choose=1')).toBe('1');
    expect(await consentOf('?revenue=1')).toBe('1');
    expect(await consentOf('?consent=1')).toBe('1');
    const s = await connected('r-signedin', 'UCrsignedin');
    expect(await consentOf('', s.cookie)).toBe('1');
  });
});

describe('returning sign-in without new lasting access', () => {
  test('owner of a connected channel is signed in with the stored access', async () => {
    await connected('r-owner', 'UCrowner');
    const before = await env.DB.prepare("SELECT refresh_token_enc AS t FROM channels WHERE channel_id = 'UCrowner'").first<{ t: string }>();
    const s = await signIn({ sub: 'r-owner', channel: channelFixture({ channelId: 'UCrowner' }), google: { exchangeCode: noRefresh('r-owner') } });
    expect(s.callback.headers.get('location')).toBe('/account');
    expect(await readText(await s.app.request('/account', { headers: { cookie: s.cookie } }))).toContain('UCrowner');
    expect(await count("SELECT COUNT(*) AS n FROM users WHERE google_sub = 'r-owner'")).toBe(1);
    expect(await env.DB.prepare("SELECT refresh_token_enc AS t FROM channels WHERE channel_id = 'UCrowner'").first()).toEqual(before);
    expect(s.google.calls).not.toContain('revoke');
  });

  test('an unconnected channel restarts the sign-in asking for permissions', async () => {
    const s = await signIn({ sub: 'r-new', channel: channelFixture({ channelId: 'UCrnew' }), google: { exchangeCode: noRefresh('r-new') } });
    expect(s.callback.headers.get('location')).toBe('/auth/google/start?consent=1');
    expect(await count("SELECT COUNT(*) AS n FROM users WHERE google_sub = 'r-new'")).toBe(0);
  });

  test('an existing user whose Google account has no channel still gets in', async () => {
    await connected('r-nochan', 'UCrnochan');
    const s = await signIn({ sub: 'r-nochan', google: { exchangeCode: noRefresh('r-nochan'), myChannels: async () => [] } });
    expect(s.callback.headers.get('location')).toBe('/account');
  });

  test("signed in as someone else, another account's channel is refused without revoking", async () => {
    await connected('r-a', 'UCra');
    const b = await connected('r-b', 'UCrb');
    const g = fakeGoogle({ exchangeCode: noRefresh('r-a'), myChannels: async () => [channelFixture({ channelId: 'UCra' })] });
    const app = createApp(makeDeps({ google: g }));
    const start = await app.request('/auth/google/start', { headers: { cookie: b.cookie } });
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const res = await app.request(`/auth/google/callback?state=${state}&code=c`, { headers: { cookie: mergeCookies(b.cookie, start) } });
    expect(await readText(res)).toContain('This channel is already connected to another ViewProof account.');
    expect(g.calls).not.toContain('revoke');
  });
});

describe('wording', () => {
  test('one subscriber, one video', async () => {
    const s = await signIn({ sub: 'r-one', channel: channelFixture({ channelId: 'UCrone', subscriberCount: 1, videoCount: 1 }) });
    const html = await readText(await s.app.request(`/connect/confirm?id=${s.pendingId}`, { headers: { cookie: s.cookie } }));
    expect(html).toContain('1 subscriber ·');
    expect(html).toContain('1 video');
    expect(html).not.toContain('1 videos');
  });

  test('a brand-account login shows the channel name, not its internal Google address', async () => {
    const s = await signIn({ sub: 'r-brand', channel: channelFixture({ channelId: 'UCrbrand' }), google: {
      exchangeCode: async () => ({ accessToken: 'at', refreshToken: 'rt', scopes: ALL_SCOPES, idClaims: { sub: 'r-brand', email: 'where-words-1@pages.plusgoogle.com', name: 'Where Words Come From' } }),
    } });
    await post(s.app, '/connect/confirm', s.cookie, { id: s.pendingId });
    const html = await readText(await s.app.request('/account', { headers: { cookie: s.cookie } }));
    expect(html).toContain('Signed in as Where Words Come From');
    expect(html).not.toContain('pages.plusgoogle.com');
  });

  test('a normal Google login still shows its email', async () => {
    const s = await connected('r-plain', 'UCrplain');
    expect(await readText(await s.app.request('/account', { headers: { cookie: s.cookie } }))).toContain('r-plain@example.com');
  });
});
void APP;
