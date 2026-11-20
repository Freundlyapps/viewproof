import { describe, expect, test } from 'vitest';
import { MAX_VIDEOS, chromeStore, memoryStore } from '../src/store';

function fakeArea() {
  const data: Record<string, unknown> = {};
  return {
    data,
    async get(key: string) { return key in data ? { [key]: structuredClone(data[key]) } : {}; },
    async set(items: Record<string, unknown>) { Object.assign(data, structuredClone(items)); },
  } as unknown as chrome.storage.StorageArea & { data: Record<string, unknown> };
}

for (const [name, make] of [['memory', () => memoryStore()], ['chrome', () => chromeStore(fakeArea())]] as const) {
  describe(`${name} store`, () => {
    test('keeps only the latest observation per video', async () => {
      const s = make();
      expect(await s.getLatest('a')).toBeNull();
      await s.record('a', { views: 1, at: '2026-11-20T10:00:00Z' });
      await s.record('a', { views: 5, at: '2026-11-20T11:00:00Z' });
      expect(await s.getLatest('a')).toEqual({ views: 5, at: '2026-11-20T11:00:00Z' });
    });

    test('evicts beyond MAX_VIDEOS', async () => {
      const s = make();
      for (let i = 0; i <= MAX_VIDEOS; i++) await s.record(`v${i}`, { views: i, at: '2026-11-20T10:00:00Z' });
      expect(await s.getLatest('v0')).toBeNull();
      expect(await s.getLatest('v1')).not.toBeNull();
      expect(await s.getLatest(`v${MAX_VIDEOS}`)).not.toBeNull();
    }, 60_000); // the fake storage area deep-copies the table on every write
  });
}
