import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { TRENDS_LABEL, dataForSeoProvider, noProvider } from '../src';

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const US = { code: 'US', locationCode: 2840 };
const trends = () => fx('dfs-trends.json');
const NOW = () => Date.parse('2026-11-21T00:00:00Z');

function fakeFetch(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => (calls.push({ url, init }), new Response(JSON.stringify(body), { status }))) as unknown as typeof fetch;
  return { fn, calls };
}
const provider = (body: unknown, status = 200) => { const f = fakeFetch(body, status); return { p: dataForSeoProvider(f.fn, { login: 'me', password: 'pw' }, NOW), calls: f.calls }; };

describe('dataForSeoProvider (Google Trends, YouTube search)', () => {
  test('interest series from the documented response', async () => {
    const t = trends();
    const graph = t.tasks[0].result[0].items.find((i: any) => i.type === 'google_trends_graph');
    const expected = graph.data.filter((d: any) => !d.missing_data && typeof d.values[0] === 'number');
    const r = await provider(t).p.trends('seo api', US);
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.interest).toHaveLength(expected.length);
    expect(r.interest[0]).toEqual({ date: expected[0].date_from, value: expected[0].values[0] });
    expect(r).toMatchObject({ provider: 'DataForSEO', label: TRENDS_LABEL, keyword: 'seo api', country: 'US', note: null, fetchedAt: '2026-11-21T00:00:00.000Z' });
  });

  test('one call: auth header and request body (YouTube search, 12 months)', async () => {
    const { p, calls } = provider(trends());
    await p.trends('seo api', US);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.dataforseo.com/v3/keywords_data/google_trends/explore/live');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa('me:pw')}`);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual([{ keywords: ['seo api'], location_code: 2840, type: 'youtube', time_range: 'past_12_months' }]);
  });

  test('no graph data → empty series with a reason, never zeros', async () => {
    const t = trends();
    t.tasks[0].result[0].items = t.tasks[0].result[0].items.filter((i: any) => i.type !== 'google_trends_graph');
    const r = await provider(t).p.trends('rare words', US);
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.interest).toEqual([]);
    expect(r.note).toBe('Google Trends has too little YouTube search data for this keyword.');
  });

  test("task or HTTP error → failed with DataForSEO's message", async () => {
    const t = trends();
    t.tasks[0].status_code = 40501;
    t.tasks[0].status_message = 'Invalid Field: location_code.';
    expect(await provider(t).p.trends('x', US)).toEqual({ status: 'failed', reason: 'DataForSEO: Invalid Field: location_code.' });
    expect(await provider({ status_code: 40100, status_message: 'You are not authorized.' }, 401).p.trends('x', US)).toEqual({ status: 'failed', reason: 'DataForSEO: You are not authorized.' });
  });
});

test('noProvider says off', async () => {
  expect(await noProvider('none configured').trends('x', US)).toEqual({ status: 'off', reason: 'none configured' });
});
