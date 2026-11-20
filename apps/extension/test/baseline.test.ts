import { readFileSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import { BACKOFF_TTL_MS, BASELINE_TTL_MS, FAILURE_TTL_MS, getBaseline } from '../src/baseline';

const xml = readFileSync(new URL('../../../packages/core/test/fixtures/feed-long.xml', import.meta.url), 'utf8');
const okFetch = () => vi.fn(async () => new Response(xml, { status: 200 }));

describe('getBaseline', () => {
  test('fetches the public feed URL for the channel', async () => {
    const fetch = okFetch();
    const r = await getBaseline('UCabc', { fetch, now: () => 0, cache: new Map() });
    expect(fetch).toHaveBeenCalledWith('https://www.youtube.com/feeds/videos.xml?channel_id=UCabc', expect.objectContaining({ credentials: 'omit', redirect: 'error' }));
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

  test('network errors are not cached', async () => {
    const fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const deps = { fetch, now: () => 0, cache: new Map() };
    await getBaseline('UCabc', deps);
    await getBaseline('UCabc', deps);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('HTTP errors are cached briefly; 429/403 back off for an hour', async () => {
    let t = 0;
    const f500 = vi.fn(async () => new Response('', { status: 500 }));
    const d500 = { fetch: f500, now: () => t, cache: new Map() };
    await getBaseline('UCabc', d500);
    t = FAILURE_TTL_MS - 1;
    await getBaseline('UCabc', d500);
    expect(f500).toHaveBeenCalledTimes(1);
    t = FAILURE_TTL_MS + 1;
    await getBaseline('UCabc', d500);
    expect(f500).toHaveBeenCalledTimes(2);

    t = 0;
    const f429 = vi.fn(async () => new Response('', { status: 429 }));
    const d429 = { fetch: f429, now: () => t, cache: new Map() };
    await getBaseline('UCabc', d429);
    t = BACKOFF_TTL_MS - 1;
    await getBaseline('UCabc', d429);
    expect(f429).toHaveBeenCalledTimes(1);
  });

  test('a hung request times out with a reason', async () => {
    const fetch = vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((_, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new DOMException('The operation timed out.', 'TimeoutError')));
    }));
    const r = await getBaseline('UCabc', { fetch: fetch as unknown as typeof globalThis.fetch, now: () => 0, cache: new Map(), timeoutMs: 50 });
    expect(r).toEqual({ ok: false, reason: 'Timed out loading the channel feed' });
  });

  test('a redirect away from the feed is an error, not followed', async () => {
    const fetch = vi.fn(async (_u: string, _i?: RequestInit) => { throw new TypeError('Failed to fetch'); });
    await getBaseline('UCabc', { fetch: fetch as unknown as typeof globalThis.fetch, now: () => 0, cache: new Map() });
    expect(fetch.mock.calls[0]![1]).toMatchObject({ redirect: 'error' });
  });
});
