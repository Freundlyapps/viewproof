import { readFileSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import { BASELINE_TTL_MS, getBaseline } from '../src/baseline';

const xml = readFileSync(new URL('../../../packages/core/test/fixtures/feed-long.xml', import.meta.url), 'utf8');
const okFetch = () => vi.fn(async () => new Response(xml, { status: 200 }));

describe('getBaseline', () => {
  test('fetches the public feed URL for the channel', async () => {
    const fetch = okFetch();
    const r = await getBaseline('UCabc', { fetch, now: () => 0, cache: new Map() });
    expect(fetch).toHaveBeenCalledWith('https://www.youtube.com/feeds/videos.xml?channel_id=UCabc', expect.objectContaining({ credentials: 'omit' }));
    expect(r.ok).toBe(true);
  });

  test('caches for an hour', async () => {
    const fetch = okFetch();
    const cache = new Map();
    let t = 0;
    const deps = { fetch, now: () => t, cache };
    await getBaseline('UCabc', deps);
    t = BASELINE_TTL_MS - 1;
    await getBaseline('UCabc', deps);
    expect(fetch).toHaveBeenCalledTimes(1);
    t = BASELINE_TTL_MS + 1;
    await getBaseline('UCabc', deps);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('HTTP error becomes ok:false', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 404 }));
    expect(await getBaseline('UCabc', { fetch, now: () => 0, cache: new Map() })).toEqual({ ok: false, reason: 'HTTP 404' });
  });

  test('network error becomes ok:false', async () => {
    const fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const r = await getBaseline('UCabc', { fetch, now: () => 0, cache: new Map() });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.reason).toContain('Failed to fetch');
  });

  test('errors are not cached', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 500 }));
    const deps = { fetch, now: () => 0, cache: new Map() };
    await getBaseline('UCabc', deps);
    await getBaseline('UCabc', deps);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
