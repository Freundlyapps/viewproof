import { describe, expect, test } from 'vitest';
import { createApp } from '../src/app';
import { channelFixture, makeDeps, signIn } from './helpers';

function fakeAssets(files: Record<string, string>) {
  const seen: string[] = [];
  return {
    seen,
    fetch: async (req: Request) => {
      const path = new URL(req.url).pathname;
      seen.push(path);
      return path in files ? new Response(files[path], { headers: { 'content-type': path.endsWith('.js') ? 'text/javascript' : 'text/html' } }) : new Response('not found', { status: 404 });
    },
  };
}

describe('web app at /app', () => {
  test('serves built files and falls back to index.html for app routes', async () => {
    const assets = fakeAssets({ '/app/index.html': '<div id="root"></div>', '/app/assets/main.js': 'js' });
    const app = createApp(makeDeps({ assets }));
    expect(await (await app.request('/app/assets/main.js')).text()).toBe('js');
    const deep = await app.request('/app/channel/videos');
    expect(deep.status).toBe(200);
    expect(await deep.text()).toContain('<div id="root">');
    expect(await (await app.request('/app')).text()).toContain('<div id="root">');
  });

  test('a missing asset file is a 404, not the app page', async () => {
    const app = createApp(makeDeps({ assets: fakeAssets({ '/app/index.html': 'x' }) }));
    expect((await app.request('/app/assets/missing.js')).status).toBe(404);
  });

  test('without a web build it says how to build it', async () => {
    const res = await createApp(makeDeps({ assets: fakeAssets({}) })).request('/app/');
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('pnpm --filter web build');
  });

  test('signed in, the home page opens the app', async () => {
    const s = await signIn({ sub: 'as-home', channel: channelFixture({ channelId: 'UCashome' }) });
    const res = await s.app.request('/', { headers: { cookie: s.cookie } });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/app');
  });
});
