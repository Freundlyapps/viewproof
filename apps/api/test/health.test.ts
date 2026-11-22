import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import { createApp } from '../src/app';
import { parseConfig } from '../src/env';
import { fakeGoogle } from './fake-google';
import { fakeYouTube } from './fake-youtube';
import { noProvider } from '@viewproof/providers';

describe('health', () => {
  test('GET /health', async () => {
    const app = createApp({ db: env.DB, config: parseConfig(env), google: fakeGoogle(), youtube: fakeYouTube(), keywords: noProvider('test'), fetchFeed: async () => ({ ok: false, reason: 'test' }), channelStats: { byIds: async () => ({ error: 'not configured in this test' }), byHandle: async () => ({ error: 'not configured in this test' }) }, now: () => Date.now() });
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('parseConfig', () => {
  test('names the missing variable', () => {
    expect(() => parseConfig({ ...env, TOKEN_KEY: '' })).toThrow('TOKEN_KEY is not set');
  });
  test('secure cookies only on https', () => {
    expect(parseConfig({ ...env, APP_URL: 'http://localhost:8787' }).secureCookies).toBe(false);
    expect(parseConfig({ ...env, APP_URL: 'https://viewproof.app' }).secureCookies).toBe(true);
  });
  test('self-hosted flag', () => {
    expect(parseConfig({ ...env, SELF_HOSTED: 'true' }).selfHosted).toBe(true);
    expect(parseConfig({ ...env, SELF_HOSTED: 'false' }).selfHosted).toBe(false);
  });
});
