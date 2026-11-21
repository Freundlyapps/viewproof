import { describe, expect, test, vi } from 'vitest';
import { SCOPES, httpGoogleClient } from '../src/google';

const CFG = { clientId: 'cid', clientSecret: 'csecret', redirectUri: 'http://localhost:8787/auth/google/callback' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const jwt = (claims: object) => `e30.${btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.sig`;
const client = (impl: (url: string, init?: RequestInit) => Promise<Response>) => {
  const f = vi.fn(impl);
  return { g: httpGoogleClient(f as unknown as typeof fetch, CFG), f };
};

describe('authUrl', () => {
  test('asks for sign-in and read-only channel scopes, offline access, PKCE', () => {
    const { g } = client(async () => json({}));
    const u = new URL(g.authUrl({ state: 'st', challenge: 'ch', wantRevenue: false, chooseAccount: false, consent: true }));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const scopes = u.searchParams.get('scope')!.split(' ');
    for (const s of [...SCOPES.signIn, ...SCOPES.channel]) expect(scopes).toContain(s);
    expect(scopes).not.toContain(SCOPES.revenue);
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toBe('consent');
    expect(u.searchParams.get('code_challenge')).toBe('ch');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('state')).toBe('st');
    expect(u.searchParams.get('client_id')).toBe('cid');
    expect(u.searchParams.get('redirect_uri')).toBe(CFG.redirectUri);
    expect(u.searchParams.get('response_type')).toBe('code');
  });
  test('revenue scope only when asked; chooser when asked', () => {
    const { g } = client(async () => json({}));
    const u = new URL(g.authUrl({ state: 's', challenge: 'c', wantRevenue: true, chooseAccount: true, consent: true }));
    expect(u.searchParams.get('scope')).toContain(SCOPES.revenue);
    expect(u.searchParams.get('prompt')).toBe('consent select_account');
  });
  test('a plain returning sign-in only asks to choose the account', () => {
    const { g } = client(async () => json({}));
    const u = new URL(g.authUrl({ state: 's', challenge: 'c', wantRevenue: false, chooseAccount: false, consent: false }));
    expect(u.searchParams.get('prompt')).toBe('select_account');
    expect(u.searchParams.get('access_type')).toBe('offline');
  });
});

describe('exchangeCode', () => {
  test('posts the code with PKCE verifier and parses tokens, scopes and identity', async () => {
    const { g, f } = client(async () =>
      json({ access_token: 'at', refresh_token: 'rt', scope: 'openid https://www.googleapis.com/auth/youtube.readonly', id_token: jwt({ sub: '123', email: 'a@b.c', name: 'A' }) }),
    );
    const r = await g.exchangeCode('the-code', 'the-verifier');
    expect(r).toEqual({ accessToken: 'at', refreshToken: 'rt', scopes: ['openid', 'https://www.googleapis.com/auth/youtube.readonly'], idClaims: { sub: '123', email: 'a@b.c', name: 'A' } });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://oauth2.googleapis.com/token');
    const body = new URLSearchParams(String(init!.body));
    expect(Object.fromEntries(body)).toMatchObject({ code: 'the-code', code_verifier: 'the-verifier', grant_type: 'authorization_code', redirect_uri: CFG.redirectUri, client_id: 'cid', client_secret: 'csecret' });
  });
  test('missing refresh token is null, not a default', async () => {
    const { g } = client(async () => json({ access_token: 'at', scope: 'openid', id_token: jwt({ sub: '1' }) }));
    expect(await g.exchangeCode('c', 'v')).toMatchObject({ refreshToken: null });
  });
  test('used or expired code', async () => {
    const { g } = client(async () => json({ error: 'invalid_grant' }, 400));
    expect(await g.exchangeCode('c', 'v')).toEqual({ kind: 'failed', reason: 'The sign-in code expired or was already used' });
  });
  test('missing id token is a failure', async () => {
    const { g } = client(async () => json({ access_token: 'at', scope: 'openid' }));
    expect(await g.exchangeCode('c', 'v')).toMatchObject({ kind: 'failed' });
  });
});

describe('refresh', () => {
  test('returns a new access token', async () => {
    const { g, f } = client(async () => json({ access_token: 'new' }));
    expect(await g.refresh('rt')).toEqual({ accessToken: 'new' });
    expect(new URLSearchParams(String(f.mock.calls[0]![1]!.body)).get('grant_type')).toBe('refresh_token');
  });
  test('invalid_grant means access was revoked or expired', async () => {
    const { g } = client(async () => json({ error: 'invalid_grant' }, 400));
    expect(await g.refresh('rt')).toEqual({ kind: 'revoked' });
  });
  test('server error', async () => {
    const { g } = client(async () => new Response('', { status: 500 }));
    expect(await g.refresh('rt')).toEqual({ kind: 'failed', reason: 'HTTP 500' });
  });
  test('network error', async () => {
    const { g } = client(async () => { throw new TypeError('fetch failed'); });
    expect(await g.refresh('rt')).toEqual({ kind: 'failed', reason: 'fetch failed' });
  });
});

describe('myChannels', () => {
  // Shape from https://developers.google.com/youtube/v3/docs/channels#resource
  const sample = {
    kind: 'youtube#channelListResponse',
    items: [
      { id: 'UCabc', snippet: { title: 'Quiet Hands Pottery', customUrl: '@quiethandspottery', thumbnails: { default: { url: 'https://yt3.ggpht.com/a.jpg' } } }, statistics: { subscriberCount: '12345', hiddenSubscriberCount: false, videoCount: '41' } },
      { id: 'UChid', snippet: { title: 'Hidden' }, statistics: { hiddenSubscriberCount: true, videoCount: '3' } },
    ],
  };
  test('maps channels; hidden or missing values are null', async () => {
    const { g, f } = client(async () => json(sample));
    expect(await g.myChannels('at')).toEqual([
      { channelId: 'UCabc', title: 'Quiet Hands Pottery', handle: '@quiethandspottery', avatarUrl: 'https://yt3.ggpht.com/a.jpg', subscriberCount: 12345, videoCount: 41 },
      { channelId: 'UChid', title: 'Hidden', handle: null, avatarUrl: null, subscriberCount: null, videoCount: 3 },
    ]);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://www.googleapis.com/youtube/v3/channels?part=snippet%2Cstatistics&mine=true');
    expect(new Headers(init!.headers).get('authorization')).toBe('Bearer at');
  });
  test('no items is an empty list', async () => {
    const { g } = client(async () => json({ kind: 'youtube#channelListResponse' }));
    expect(await g.myChannels('at')).toEqual([]);
  });
  test('401 means revoked', async () => {
    const { g } = client(async () => json({ error: { code: 401 } }, 401));
    expect(await g.myChannels('at')).toEqual({ kind: 'revoked' });
  });
});

describe('revoke', () => {
  test('posts the token and never throws', async () => {
    const { g, f } = client(async () => { throw new TypeError('offline'); });
    await expect(g.revoke('rt')).resolves.toBeUndefined();
    expect(f.mock.calls[0]![0]).toBe('https://oauth2.googleapis.com/revoke');
  });
});
