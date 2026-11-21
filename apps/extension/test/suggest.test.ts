import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { MAX_PER_HOUR, suggester } from '../src/suggest';

const text = readFileSync(new URL('../../../packages/core/test/fixtures/suggest-en.txt', import.meta.url), 'utf8');
function fakeArea() {
  const data: Record<string, unknown> = {};
  return {
    async get(key: string) { return key in data ? { [key]: structuredClone(data[key]) } : {}; },
    async set(items: Record<string, unknown>) { Object.assign(data, structuredClone(items)); },
  } as unknown as chrome.storage.StorageArea;
}
const H = 3_600_000;

function setup(answer: (url: string) => Response = () => new Response(text)) {
  const urls: string[] = [];
  let t = Date.parse('2026-11-21T12:00:00Z');
  const s = suggester({ area: fakeArea(), fetch: (async (u: string) => (urls.push(u), answer(u))) as unknown as typeof fetch, now: () => t });
  return { s, urls, tick: (ms: number) => { t += ms; }, now: () => t };
}

describe('suggestions', () => {
  test('four requests, grouped, cached 7 days', async () => {
    const { s, urls, tick } = setup();
    const r = await s.suggest('Pottery Wheel');
    if (!r.ok) throw new Error(r.reason);
    expect(urls.map((u) => new URL(u).searchParams.get('q'))).toEqual(['pottery wheel', 'how pottery wheel', 'what pottery wheel', 'why pottery wheel']);
    expect(new URL(urls[0]!).origin + new URL(urls[0]!).pathname).toBe('https://suggestqueries-clients6.youtube.com/complete/search');
    expect(new URL(urls[0]!).searchParams.get('client')).toBe('youtube');
    expect(r.suggestions.related[0]).toBe('pottery wheel for beginners');
    await s.suggest('pottery wheel');
    expect(urls).toHaveLength(4);
    tick(8 * 24 * H);
    await s.suggest('pottery wheel');
    expect(urls).toHaveLength(8);
  });

  test('throttle stops at 60 per hour', async () => {
    const { s, urls } = setup();
    for (let i = 0; i < MAX_PER_HOUR / 4; i++) expect((await s.suggest(`k${i}`)).ok).toBe(true);
    const r = await s.suggest('one more');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^Suggestion limit reached \(60 per hour\); try again in \d+ minutes?\.$/);
    expect(urls).toHaveLength(MAX_PER_HOUR);
  });

  test('non-200 pauses 24 h and says until when', async () => {
    let status = 429;
    const { s, urls, tick } = setup(() => new Response('no', { status }));
    const r = await s.suggest('glaze');
    expect(r).toEqual({ ok: false, reason: 'YouTube refused suggestion requests; paused until 2026-11-22T12:00:00.000Z' });
    status = 200;
    expect((await s.suggest('kiln')).ok).toBe(false);
    expect(urls).toHaveLength(1);
    tick(24 * H + 1);
    expect((await s.suggest('kiln')).ok).toBe(false); // body 'no' is not JSONP → paused again
  });
});
