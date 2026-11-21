import type { KeywordTrends } from '@viewproof/core';
import { type KeywordProvider, TRENDS_LABEL } from './keyword-provider';

const URL_TRENDS = 'https://api.dataforseo.com/v3/keywords_data/google_trends/explore/live';
const OK = 20000;
const TOO_LITTLE = 'Google Trends has too little YouTube search data for this keyword.';
type Obj = Record<string, any>;

/**
 * DataForSEO Google Trends explore with `type: youtube` (YouTube search), past 12 months — one call per keyword.
 * Response paths follow the documented example (test/fixtures/dfs-trends.json). DataForSEO sells no YouTube search volume.
 */
export function dataForSeoProvider(fetchFn: typeof fetch, creds: { login: string; password: string }, now: () => number = () => Date.now()): KeywordProvider {
  const auth = `Basic ${btoa(`${creds.login}:${creds.password}`)}`;
  return {
    name: 'DataForSEO',
    async trends(keyword, country): Promise<KeywordTrends> {
      let res: Response;
      let json: Obj | null;
      try {
        res = await fetchFn(URL_TRENDS, {
          method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' },
          body: JSON.stringify([{ keywords: [keyword], location_code: country.locationCode, type: 'youtube', time_range: 'past_12_months' }]),
        });
        json = (await res.json().catch(() => null)) as Obj | null;
      } catch (e) {
        return { status: 'failed', reason: `DataForSEO: ${e instanceof Error ? e.message : 'network error'}` };
      }
      if (!res.ok || !json || json.status_code !== OK) return { status: 'failed', reason: `DataForSEO: ${json?.status_message ?? `HTTP ${res.status}`}` };
      const task = json.tasks?.[0];
      if (!task || task.status_code !== OK) return { status: 'failed', reason: `DataForSEO: ${task?.status_message ?? 'no task in the answer'}` };
      const graph = (task.result?.[0]?.items as Obj[] | undefined)?.find((i) => i.type === 'google_trends_graph');
      const interest = Array.isArray(graph?.data)
        ? (graph.data as Obj[]).filter((d) => !d.missing_data && typeof d.values?.[0] === 'number' && typeof d.date_from === 'string')
          .map((d) => ({ date: d.date_from as string, value: d.values[0] as number }))
        : [];
      return {
        status: 'ok', provider: 'DataForSEO', label: TRENDS_LABEL, keyword, country: country.code,
        interest, note: interest.length ? null : TOO_LITTLE, fetchedAt: new Date(now()).toISOString(),
      };
    },
  };
}
