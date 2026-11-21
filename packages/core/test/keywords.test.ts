// Fixtures captured 2026-11-21 (one request each, signed out, hl=en gl=US):
// search-results-en.json = ytInitialData of youtube.com/results?search_query=pottery+wheel+for+beginners,
// trimmed of tracking/menu/thumbnail keys. suggest-en.txt = suggestqueries-clients6.youtube.com for "pottery wheel".
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { factsSummary, groupSuggestions, normalizeKeyword, parseAge, parseSearchPage, parseSuggestions, topResultsFacts, type SearchPage } from '../src/keywords';
import { median } from '../src/measured';

const raw = () => JSON.parse(readFileSync(new URL('./fixtures/search-results-en.json', import.meta.url), 'utf8'));
const suggestText = readFileSync(new URL('./fixtures/suggest-en.txt', import.meta.url), 'utf8');
const Q = 'pottery wheel for beginners';
const items = (r: any) => r.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents[0].itemSectionRenderer.contents as any[];
const page = (r = raw()) => {
  const p = parseSearchPage(r, Q);
  if ('error' in p) throw new Error(p.error);
  return p;
};
const val = (m: { kind: string; value?: number }) => (m.kind === 'value' ? m.value : undefined);

describe('parseSearchPage', () => {
  test('parses the English fixture', () => {
    const p = page();
    expect(p.results).toHaveLength(18);
    expect(p.results[0]).toMatchObject({ videoId: '-YCGK33c0xs', channelId: 'UCqZL_f4Jp8yHnv2KNvcsWeg', channelName: 'Florian Gadsby', durationSec: 1005, ageLabel: '4y ago', live: false });
    expect(val(p.results[0]!.views)).toBe(2061788);
    expect(val(p.results[0]!.ageDays)).toBe(1460);
    expect(p.shortsShelves).toBe(3);
    expect(p.estimatedResults).toBe(5160242);
    expect(p.query).toBe(Q);
  });

  test('German page', () => {
    const r = raw();
    const v = items(r).find((i) => i.videoRenderer).videoRenderer;
    v.viewCountText = { simpleText: '2.061.788 Aufrufe' };
    v.publishedTimeText = { simpleText: 'vor 4 Jahren' };
    expect(val(page(r).results[0]!.views)).toBe(2061788);
    expect(val(page(r).results[0]!.ageDays)).toBe(1460);
  });

  test('unknown language', () => {
    const r = raw();
    items(r).find((i) => i.videoRenderer).videoRenderer.publishedTimeText = { simpleText: 'il y a 4 ans' };
    expect(page(r).results[0]!.ageDays).toEqual({ kind: 'no_data', reason: 'Upload age label not understood: il y a 4 ans' });
  });

  test('live result', () => {
    const r = raw();
    const v = items(r).find((i) => i.videoRenderer).videoRenderer;
    v.viewCountText = { runs: [{ text: '123' }, { text: ' watching' }] };
    delete v.publishedTimeText;
    const res = page(r).results[0]!;
    expect(res.live).toBe(true);
    expect(res.views).toEqual({ kind: 'no_data', reason: 'Live now: viewers, not views' });
  });

  test('parser canary', () => {
    const r = raw();
    for (const it of items(r)) if (it.videoRenderer) { it.videoRendererX = it.videoRenderer; delete it.videoRenderer; }
    for (const it of items(r)) if (it.gridShelfViewModel) { it.gridShelfX = it.gridShelfViewModel; delete it.gridShelfViewModel; }
    expect(parseSearchPage(r, Q)).toEqual({ error: 'YouTube changed its search page; no results could be read' });
    const empty = raw();
    empty.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents[0].itemSectionRenderer.contents = [{ messageRenderer: { text: { simpleText: 'No results found' } } }];
    expect(page(empty).results).toEqual([]);
    expect(parseSearchPage({ foo: 1 }, Q)).toEqual({ error: 'YouTube changed its search page; no results could be read' });
  });

  test('parseAge', () => {
    expect(parseAge('9mo ago')).toBe(270);
    expect(parseAge('2w ago')).toBe(14);
    expect(parseAge('Streamed 2 years ago')).toBe(730);
    expect(parseAge('3 hours ago')).toBe(0);
    expect(parseAge('vor 1 Monat')).toBe(30);
    expect(parseAge('vor 3 Wochen')).toBe(21);
    expect(parseAge('soon')).toBeNull();
  });
});

describe('facts', () => {
  test('facts from the fixture', () => {
    const p = page();
    const f = topResultsFacts(p);
    const views = p.results.flatMap((r) => (r.views.kind === 'value' ? [r.views.value] : []));
    expect(val(f.medianViews)).toBe(median(views));
    expect(f.videos).toBe(18);
    expect(f.topChannel).toEqual({ name: 'Florian Gadsby', count: 5 });
    expect(val(f.recent)).toBe(0);
    expect(f.distinctChannels).toBe(13);
    expect(f.channelSizes).toEqual({ kind: 'no_data', reason: "YouTube's search page doesn't show channel sizes" });
  });

  test('summary sentences', () => {
    const s = factsSummary(topResultsFacts(page()));
    expect(s).toContain('Florian Gadsby has 5 of the top 18 results.');
    expect(s).toContain('None of the top 18 is from the last 3 months.');
    expect(s.some((x) => x.startsWith('Top videos are big: median '))).toBe(true);
  });

  test('no results: medians are no_data, no sentences', () => {
    const p: SearchPage = { query: 'x', results: [], shortsShelves: 0, estimatedResults: null };
    const f = topResultsFacts(p);
    expect(f.medianViews.kind).toBe('no_data');
    expect(factsSummary(f)).toEqual([]);
  });
});

describe('keywords and suggestions', () => {
  test('normalizeKeyword', () => {
    expect(normalizeKeyword('  Pottery  WHEEL ')).toBe('pottery wheel');
  });

  test('parseSuggestions', () => {
    const s = parseSuggestions(suggestText)!;
    expect(s).toHaveLength(14);
    expect(s[0]).toBe('pottery wheel for beginners');
    expect(parseSuggestions('<html>')).toBeNull();
  });

  test('groupSuggestions', () => {
    const plain = parseSuggestions(suggestText)!;
    const g = groupSuggestions('pottery wheel', [{ prefix: '', items: plain }, { prefix: 'how', items: ['how pottery wheel works', 'pottery wheel'] }]);
    expect(g.related).not.toContain('pottery wheel');
    expect(g.related[0]).toBe('pottery wheel for beginners');
    expect(g.matching).toContain('pottery wheel for beginners');
    expect(g.questions).toEqual(['how pottery wheel works']);
  });
});
