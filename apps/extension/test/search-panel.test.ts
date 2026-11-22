import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type FeedVideo, type ParseResult, type SearchPage, factsSummary, parseSearchPage, topResultsFacts } from '@viewproof/core';
import { describe, expect, test } from 'vitest';
import { MAX_SEARCH_FEEDS, searchCard, searchFeedOutliers } from '../src/search-panel';

const raw = JSON.parse(readFileSync(resolve(process.cwd(), '../../packages/core/test/fixtures/search-results-en.json'), 'utf8'));
const page = parseSearchPage(raw, 'pottery') as SearchPage;
const channels = [...new Set(page.results.map((r) => r.channelId).filter((c): c is string => !!c))];
const first = page.results.find((r) => r.channelId === channels[0] && r.views.kind === 'value')!;

/** A feed for `channelId`: five older uploads at 10,000 views, plus the result itself when `include`. */
function feedFor(channelId: string, include: boolean): FeedVideo[] {
  const old = Array.from({ length: 5 }, (_, i) => ({ platform: 'youtube' as const, videoId: `${channelId.slice(2, 12)}${i}`, title: '', publishedAt: `2020-01-0${i + 1}T00:00:00Z`, views: 10_000, format: 'long' as const }));
  return include ? [{ platform: 'youtube', videoId: first.videoId, title: first.title, publishedAt: '2021-01-01T00:00:00Z', views: 1, format: 'long' }, ...old] : old;
}

describe('searchFeedOutliers', () => {
  test('at most 8 channels, 2 at a time; ×N only for results found in their feed', async () => {
    expect(channels.length).toBeGreaterThan(MAX_SEARCH_FEEDS);
    let inFlight = 0;
    let peak = 0;
    const calls: string[] = [];
    const baseline = async (ch: string): Promise<ParseResult<FeedVideo[]>> => {
      calls.push(ch);
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { ok: true, value: feedFor(ch, ch === channels[0]) };
    };
    const r = await searchFeedOutliers(page, { baseline, isCurrent: () => true });
    expect(calls).toEqual(channels.slice(0, MAX_SEARCH_FEEDS));
    expect(peak).toBe(2);
    expect(r.channelsChecked).toBe(MAX_SEARCH_FEEDS);
    expect(r.stopped).toBeNull();
    const m = r.outliers.get(first.videoId)!;
    expect(m.kind).toBe('value');
    if (m.kind === 'value' && first.views.kind === 'value') expect(m.value).toBeCloseTo(Math.round((first.views.value / 10_000) * 10) / 10, 5);
    expect(r.outliers.size).toBe(1);
  });

  test('a 429 stops the remaining channels', async () => {
    const calls: string[] = [];
    const r = await searchFeedOutliers(page, { baseline: async (ch) => { calls.push(ch); return { ok: false, reason: 'HTTP 429' }; }, isCurrent: () => true });
    expect(calls.length).toBeLessThanOrEqual(2);
    expect(r.stopped).toContain('429');
    expect(r.outliers.size).toBe(0);
  });

  test('a new search stops further requests', async () => {
    let current = true;
    const calls: string[] = [];
    const r = await searchFeedOutliers(page, { baseline: async (ch) => { calls.push(ch); current = false; return { ok: true, value: feedFor(ch, true) }; }, isCurrent: () => current });
    expect(calls.length).toBeLessThanOrEqual(2);
    expect(r.outliers.size).toBe(0);
  });
});

test('searchCard: query, facts and coverage', () => {
  const facts = topResultsFacts(page);
  const m = searchCard(page, facts, factsSummary(facts), { withXn: 3, total: page.results.length, stopped: null, rows: [] });
  expect(m.title).toBe('What ranks for "pottery"');
  const t = JSON.stringify(m);
  expect(t).toContain('Median views');
  expect(t).toContain(`×N shown for 3 of ${page.results.length} results`);
  expect(t).toContain("older than their channel's latest 15 uploads");
  const stopped = searchCard(page, facts, [], { withXn: 0, total: 20, stopped: 'HTTP 429', rows: [] });
  expect(JSON.stringify(stopped)).toContain('YouTube asked to slow down');
});
