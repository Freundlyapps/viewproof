import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { ESTIMATE_LABEL, dataForSeoProvider, noProvider } from '../src';

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const US = { code: 'US', locationCode: 2840 };
type Call = { url: string; init: RequestInit };

function fakeFetch(answers: { clickstream?: unknown; trends?: unknown; status?: number }) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const body = url.includes('clickstream') ? answers.clickstream : answers.trends;
    return new Response(JSON.stringify(body), { status: answers.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const clickstream = () => fx('dfs-clickstream.json');
const trends = () => fx('dfs-trends.json');
// The doc example answers for three keywords; ours asks for one, so keep the item for 'youtub'.
const oneKeyword = (kw: string) => { const c = clickstream(); c.tasks[0].result[0].items = c.tasks[0].result[0].items.filter((i: any) => i.keyword === kw); return c; };

describe('dataForSeoProvider', () => {
  test('volume and monthly from the documented response', async () => {
    const c = oneKeyword('youtub');
    const item = c.tasks[0].result[0].items[0];
    const { fn } = fakeFetch({ clickstream: c, trends: trends() });
    const r = await dataForSeoProvider(fn, { login: 'l', password: 'p' }).estimate('youtub', US);
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.volume).toMatchObject({ kind: 'value', value: item.search_volume });
    expect(r.monthly).toHaveLength(item.monthly_searches.length);
    expect(r.monthly[0]).toEqual({ month: `${item.monthly_searches[0].year}-${String(item.monthly_searches[0].month).padStart(2, '0')}`, volume: item.monthly_searches[0].search_volume });
    expect(r.label).toBe(ESTIMATE_LABEL);
    expect(r).toMatchObject({ provider: 'DataForSEO', keyword: 'youtub', country: 'US' });
  });

  test('trends interest series', async () => {
    const t = trends();
    const graph = t.tasks[0].result[0].items.find((i: any) => i.type === 'google_trends_graph');
    const { fn } = fakeFetch({ clickstream: oneKeyword('youtub'), trends: t });
    const r = await dataForSeoProvider(fn, { login: 'l', password: 'p' }).estimate('youtub', US);
    if (r.status !== 'ok') throw new Error(r.status);
    const expected = graph.data.filter((d: any) => !d.missing_data && typeof d.values[0] === 'number');
    expect(r.interest).toHaveLength(expected.length);
    expect(r.interest[0]).toEqual({ date: expected[0].date_from, value: expected[0].values[0] });
  });

  test('auth header and request bodies', async () => {
    const { fn, calls } = fakeFetch({ clickstream: oneKeyword('youtub'), trends: trends() });
    await dataForSeoProvider(fn, { login: 'me', password: 'pw' }).estimate('youtub', US);
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.dataforseo.com/v3/keywords_data/clickstream_data/bulk_search_volume/live',
      'https://api.dataforseo.com/v3/keywords_data/google_trends/explore/live',
    ]);
    for (const c of calls) expect((c.init.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa('me:pw')}`);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual([{ keywords: ['youtub'], location_code: 2840 }]);
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual([{ keywords: ['youtub'], location_code: 2840, type: 'youtube', time_range: 'past_12_months' }]);
  });

  test('no volume → no_data reason', async () => {
    const c = oneKeyword('youtub');
    c.tasks[0].result[0].items = [];
    const { fn } = fakeFetch({ clickstream: c, trends: trends() });
    const r = await dataForSeoProvider(fn, { login: 'l', password: 'p' }).estimate('youtub', US);
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.volume).toEqual({ kind: 'no_data', reason: 'DataForSEO has no volume for this keyword' });
    expect(r.monthly).toEqual([]);
  });

  test("task error → failed with DataForSEO's message", async () => {
    const c = oneKeyword('youtub');
    c.tasks[0].status_code = 40501;
    c.tasks[0].status_message = 'Invalid Field: location_code.';
    const { fn } = fakeFetch({ clickstream: c, trends: trends() });
    expect(await dataForSeoProvider(fn, { login: 'l', password: 'p' }).estimate('youtub', US)).toEqual({ status: 'failed', reason: 'DataForSEO: Invalid Field: location_code.' });
    const http = fakeFetch({ clickstream: { status_code: 40100, status_message: 'You are not authorized.' }, status: 401 });
    expect(await dataForSeoProvider(http.fn, { login: 'l', password: 'p' }).estimate('youtub', US)).toEqual({ status: 'failed', reason: 'DataForSEO: You are not authorized.' });
  });

  test('trends failure keeps volume', async () => {
    const t = trends();
    t.tasks[0].status_code = 50000;
    const { fn } = fakeFetch({ clickstream: oneKeyword('youtub'), trends: t });
    const r = await dataForSeoProvider(fn, { login: 'l', password: 'p' }).estimate('youtub', US);
    if (r.status !== 'ok') throw new Error(r.status);
    expect(r.volume.kind).toBe('value');
    expect(r.interest).toEqual([]);
  });
});

test('noProvider says off', async () => {
  expect(await noProvider('none configured').estimate('x', US)).toEqual({ status: 'off', reason: 'none configured' });
});
