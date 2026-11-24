import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseSearchPage } from '../src/keywords';
import { parsePlayerResponse } from '../src/player';
import { MAX_BATCH, POOL_FIELD_LABELS, fromSearch, fromWatch, parseBatch, plausible } from '../src/pool';

const NOW = '2026-11-22T12:00:00.000Z';
const good = (over: Record<string, unknown> = {}) => ({
  videoId: 'dQw4w9WgXcQ', channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw', title: 'A title', views: 1234, publishedAt: '2026-11-01T00:00:00.000Z',
  ageDays: null, durationSec: 212, format: 'long', source: 'watch', observedAt: '2026-11-22T11:00:00.000Z', ...over,
});

describe('privacy labels', () => {
  test('describe exactly the fields an accepted upload keeps', () => {
    const r = parseBatch({ v: 1, observations: [good({ extra: 'dropped' })] }, NOW);
    if (!r.ok) throw new Error(r.reason);
    expect(Object.keys(r.items[0]!).sort()).toEqual(Object.keys(POOL_FIELD_LABELS).sort());
  });
});

describe('validate', () => {
  test('a good batch', () => {
    const r = parseBatch({ v: 1, observations: [good(), good({ source: 'search', publishedAt: null, ageDays: 21, format: 'unknown', durationSec: null })] }, NOW);
    expect(r).toMatchObject({ ok: true, rejected: [] });
    if (r.ok) expect(r.items).toHaveLength(2);
  });
  test('each bad field is named', () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ videoId: 'short' }, 'videoId'], [{ channelId: 'UCbad' }, 'channelId'], [{ title: '' }, 'title'], [{ title: 'x'.repeat(201) }, 'title'],
      [{ views: -1 }, 'views'], [{ views: 1e12 }, 'views'], [{ views: 1.5 }, 'views'], [{ views: '5' }, 'views'],
      [{ publishedAt: '2026-12-30T00:00:00Z' }, 'publishedAt'], [{ publishedAt: 'yesterday' }, 'publishedAt'],
      [{ ageDays: -2 }, 'ageDays'], [{ durationSec: -1 }, 'durationSec'], [{ format: 'tall' }, 'format'], [{ source: 'studio' }, 'source'],
      [{ observedAt: '2026-11-01T00:00:00Z' }, 'observedAt'], [{ observedAt: '2026-11-22T13:00:00Z' }, 'observedAt'],
    ];
    for (const [over, field] of cases) {
      const r = parseBatch({ v: 1, observations: [good(over)] }, NOW);
      expect(r.ok && r.items.length === 0 && r.rejected[0]!.reason.startsWith(`${field}:`), `${field} ${JSON.stringify(over)}`).toBe(true);
    }
  });
  test('unreadable batches', () => {
    expect(parseBatch(null, NOW)).toEqual({ ok: false, reason: 'Expected { v: 1, observations: [...] }' });
    expect(parseBatch({ v: 2, observations: [] }, NOW)).toEqual({ ok: false, reason: 'Expected { v: 1, observations: [...] }' });
    expect(parseBatch({ v: 1, observations: Array.from({ length: MAX_BATCH + 1 }, () => good()) }, NOW)).toEqual({ ok: false, reason: `At most ${MAX_BATCH} observations per batch` });
  });
});

describe('plausibility', () => {
  const at = (h: number) => new Date(Date.parse(NOW) + h * 3_600_000).toISOString();
  test('no previous → ok', () => expect(plausible(null, { views: 5, at: NOW })).toBeNull());
  test('small drop allowed, bigger rejected', () => {
    expect(plausible({ views: 10000, at: NOW }, { views: 9901, at: at(1) })).toBeNull();
    expect(plausible({ views: 10000, at: NOW }, { views: 9800, at: at(1) })).toBe('views fell from 10000 to 9800');
  });
  test('growth cap', () => {
    expect(plausible({ views: 100, at: NOW }, { views: 900_000, at: at(1) })).toBeNull();
    expect(plausible({ views: 100, at: NOW }, { views: 5_000_000, at: at(2) })).toBe('views grew implausibly fast (2499950 per hour)');
  });
});

describe('from pages', () => {
  test('fromWatch', () => {
    const p = parsePlayerResponse(JSON.parse(readFileSync(new URL('./fixtures/player-watch.json', import.meta.url), 'utf8')));
    if (!p.ok) throw new Error(p.reason);
    const o = fromWatch(p.value, NOW)!;
    expect(o).toMatchObject({ videoId: p.value.videoId, channelId: p.value.channelId, views: p.value.views, publishedAt: p.value.publishedAt, source: 'watch', observedAt: NOW, ageDays: null });
    expect(parseBatch({ v: 1, observations: [o] }, NOW)).toMatchObject({ ok: true, rejected: [] });
    expect(fromWatch({ ...p.value, isLive: true }, NOW)).toBeNull();
    expect(fromWatch({ ...p.value, views: null }, NOW)).toBeNull();
  });
  test('fromSearch', () => {
    const page = parseSearchPage(JSON.parse(readFileSync(new URL('./fixtures/search-results-en.json', import.meta.url), 'utf8')), 'pottery wheel for beginners');
    if ('error' in page) throw new Error(page.error);
    const obs = page.results.map((r) => fromSearch(r, NOW)).filter((x) => x !== null);
    expect(obs.length).toBeGreaterThan(5);
    expect(obs.length).toBeLessThanOrEqual(page.results.filter((r) => r.views.kind === 'value' && r.channelId && !r.live).length);
    for (const o of obs) expect(o).toMatchObject({ source: 'search', publishedAt: null, format: 'unknown' });
    expect(parseBatch({ v: 1, observations: obs }, NOW)).toMatchObject({ ok: true, rejected: [] });
  });
});
