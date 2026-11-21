import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { MAX_SNAPSHOTS, changedQueries, isSearchMessage, searchStore } from '../src/search';

const fixture = () => JSON.parse(readFileSync(new URL('../../../packages/core/test/fixtures/search-results-en.json', import.meta.url), 'utf8'));
function fakeArea() {
  const data: Record<string, unknown> = {};
  return {
    data,
    async get(key: string) { return key in data ? { [key]: structuredClone(data[key]) } : {}; },
    async set(items: Record<string, unknown>) { Object.assign(data, structuredClone(items)); },
  } as unknown as chrome.storage.StorageArea & { data: Record<string, unknown> };
}
const URL_Q = 'https://www.youtube.com/results?search_query=Pottery+Wheel+for+Beginners';
const NOW = Date.parse('2026-11-21T12:00:00Z');
const DAY = 86_400_000;

describe('search snapshots', () => {
  test('stores by normalized keyword', async () => {
    const s = searchStore(fakeArea());
    expect(await s.save(URL_Q, fixture(), NOW)).toBe('saved');
    const snap = await s.get('  pottery wheel FOR beginners', NOW);
    expect(snap?.page.results).toHaveLength(18);
    expect(snap).toMatchObject({ query: 'pottery wheel for beginners', capturedAt: '2026-11-21T12:00:00.000Z' });
  });

  test('filtered searches are not stored', async () => {
    const s = searchStore(fakeArea());
    expect(await s.save(`${URL_Q}&sp=EgIIAw%3D%3D`, fixture(), NOW)).toBe('skipped');
    expect(await s.save('https://www.youtube.com/watch?v=abc', fixture(), NOW)).toBe('skipped');
    expect(await s.get('pottery wheel for beginners', NOW)).toBeNull();
  });

  test('a canary error is reported, not stored', async () => {
    const s = searchStore(fakeArea());
    expect(await s.save(URL_Q, { contents: {} }, NOW)).toEqual({ error: 'YouTube changed its search page; no results could be read' });
    expect(await s.get('pottery wheel for beginners', NOW)).toBeNull();
  });

  test('keeps the 50 newest, drops older than 30 days', async () => {
    const s = searchStore(fakeArea());
    await s.save('https://www.youtube.com/results?search_query=old', fixture(), NOW - 31 * DAY);
    expect(await s.get('old', NOW)).toBeNull();
    for (let i = 0; i <= MAX_SNAPSHOTS; i++) await s.save(`https://www.youtube.com/results?search_query=k${i}`, fixture(), NOW + i);
    expect(await s.get('k0', NOW + 100)).toBeNull();
    expect(await s.get('k1', NOW + 100)).not.toBeNull();
    expect(await s.get(`k${MAX_SNAPSHOTS}`, NOW + 100)).not.toBeNull();
  }, 60_000);

  test('changedQueries lists new or re-read keywords', () => {
    const a = { x: { capturedAt: '1' }, y: { capturedAt: '1' } };
    const b = { x: { capturedAt: '1' }, y: { capturedAt: '2' }, z: { capturedAt: '1' } };
    expect(changedQueries(a, b)).toEqual(['y', 'z']);
    expect(changedQueries(undefined, { x: { capturedAt: '1' } })).toEqual(['x']);
  });

  test('isSearchMessage: same window and origin, right shape only', () => {
    const self = {} as Window;
    const ok = { source: self, origin: 'https://www.youtube.com', data: { type: 'viewproof:search', url: URL_Q, response: {} } } as unknown as MessageEvent;
    expect(isSearchMessage(ok, self, 'https://www.youtube.com')).toBe(true);
    expect(isSearchMessage({ ...ok, origin: 'https://evil.example' } as MessageEvent, self, 'https://www.youtube.com')).toBe(false);
    expect(isSearchMessage({ ...ok, source: {} } as MessageEvent, self, 'https://www.youtube.com')).toBe(false);
    expect(isSearchMessage({ ...ok, data: { type: 'viewproof:search' } } as MessageEvent, self, 'https://www.youtube.com')).toBe(false);
  });
});
