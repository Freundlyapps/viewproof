import { env } from 'cloudflare:test';
import type { Deps } from '../src/app';
import { parseConfig } from '../src/env';
import { fakeGoogle } from './fake-google';
import { fakeYouTube } from './fake-youtube';
import { noProvider } from '@viewproof/providers';

export const APP = 'http://localhost:8787';
export function makeDeps(over: Partial<Deps> = {}, envOver: Partial<typeof env> = {}): Deps {
  return { db: env.DB, config: parseConfig({ ...env, ...envOver }), google: fakeGoogle(), youtube: fakeYouTube(), keywords: noProvider('not configured in this test'), now: () => Date.now(), ...over };
}
export async function addUser(id: string, plan = 'free') {
  await env.DB.prepare("INSERT INTO users (id, google_sub, email, name, plan, created_at) VALUES (?, ?, ?, ?, ?, '2026-11-21T00:00:00Z')")
    .bind(id, `sub-${id}`, `${id}@example.com`, `User ${id}`, plan).run();
}
/** The session cookie ("name=value") set by a response, or '' when none. */
export function cookieFrom(res: Response): string {
  const sc = res.headers.getSetCookie().find((c) => /^(__Host-)?vp_session=[^;]/.test(c));
  return sc ? sc.split(';')[0]! : '';
}

/** Browser-like cookie jar: apply a response's Set-Cookie headers to a Cookie header value. */
export function mergeCookies(existing: string | undefined, res: Response): string {
  const jar = new Map<string, string>();
  for (const kv of (existing ?? '').split('; ').filter(Boolean)) jar.set(kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1));
  for (const sc of res.headers.getSetCookie()) {
    const kv = sc.split(';')[0]!;
    const k = kv.slice(0, kv.indexOf('='));
    const v = kv.slice(kv.indexOf('=') + 1);
    if (v === '' || /max-age=0/i.test(sc)) jar.delete(k);
    else jar.set(k, v);
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}

/** Page text with HTML entities decoded, so assertions match what a person reads. */
export async function readText(res: Response): Promise<string> {
  return (await res.text()).replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

import { createApp } from '../src/app';
import { SCOPES, type GoogleClient, type MyChannel, type TokenSet } from '../src/google';

export const ALL_SCOPES = [...SCOPES.signIn, ...SCOPES.channel];
export function channelFixture(over: Partial<MyChannel> = {}): MyChannel {
  return { channelId: 'UCqhp', title: 'Quiet Hands Pottery', handle: '@quiethands', avatarUrl: 'https://yt3.ggpht.com/a.jpg', subscriberCount: 12345, videoCount: 41, ...over };
}

/**
 * Runs the real start → callback flow with a fake Google and returns the session cookie,
 * the pending connection id and the app. Pass `cookie` to connect as an already signed-in user.
 */
export async function signIn(opts: { sub: string; channel?: MyChannel; scopes?: string[]; cookie?: string; query?: string; google?: Partial<GoogleClient>; envOver?: Partial<typeof env> }) {
  const tokens: TokenSet = { accessToken: 'at', refreshToken: `rt-${opts.sub}`, scopes: opts.scopes ?? ALL_SCOPES, idClaims: { sub: opts.sub, email: `${opts.sub}@example.com` } };
  const google = fakeGoogle({ exchangeCode: async () => tokens, myChannels: async () => [opts.channel ?? channelFixture()], ...opts.google });
  const app = createApp(makeDeps({ google }, opts.envOver));
  const start = await app.request(`/auth/google/start${opts.query ?? ''}`, { headers: opts.cookie ? { cookie: opts.cookie } : {} });
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
  const jar = mergeCookies(opts.cookie, start);
  const cb = await app.request(`/auth/google/callback?state=${state}&code=c`, { headers: { cookie: jar } });
  const location = cb.headers.get('location');
  const pendingId = location ? new URL(location, APP).searchParams.get('id') ?? '' : '';
  return { app, google, cookie: mergeCookies(jar, cb), pendingId, callback: cb };
}

export function post(app: ReturnType<typeof createApp>, path: string, cookie: string, form: Record<string, string> = {}) {
  return app.request(path, { method: 'POST', headers: { origin: APP, cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
}
