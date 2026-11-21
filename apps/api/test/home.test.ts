import { describe, expect, test } from 'vitest';
import { createApp } from '../src/app';
import { makeDeps, readText, signIn } from './helpers';

describe('home', () => {
  test('signed out: explains and offers Google sign-in', async () => {
    const html = await readText(await createApp(makeDeps()).request('/'));
    expect(html).toContain('Sign in with Google');
    expect(html).toContain('href="/auth/google/start"');
    expect(html).toContain('view only');
  });
  test('signed in: links to the account', async () => {
    const { app, cookie } = await signIn({ sub: 'h-in' });
    const html = await readText(await app.request('/', { headers: { cookie } }));
    expect(html).toContain('href="/account"');
    expect(html).not.toContain('Sign in with Google');
  });
});
