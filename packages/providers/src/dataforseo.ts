import { type KeywordEstimate, noData, value } from '@viewproof/core';
import { ESTIMATE_LABEL, type KeywordProvider } from './keyword-provider';

const BASE = 'https://api.dataforseo.com/v3/keywords_data';
const OK = 20000;
type Obj = Record<string, any>;
type Answer = { ok: true; result: Obj } | { ok: false; reason: string };

/**
 * DataForSEO: clickstream monthly volume (bulk_search_volume) + Google Trends with YouTube search (explore, type youtube).
 * Response paths follow the documented examples (test/fixtures). Absent fields are no_data, never a default.
 */
export function dataForSeoProvider(fetchFn: typeof fetch, creds: { login: string; password: string }): KeywordProvider {
  const auth = `Basic ${btoa(`${creds.login}:${creds.password}`)}`;
  async function post(path: string, body: unknown): Promise<Answer> {
    let res: Response;
    let json: Obj | null;
    try {
      res = await fetchFn(`${BASE}/${path}`, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      json = (await res.json().catch(() => null)) as Obj | null;
    } catch (e) {
      return { ok: false, reason: `DataForSEO: ${e instanceof Error ? e.message : 'network error'}` };
    }
    if (!res.ok || !json || json.status_code !== OK) return { ok: false, reason: `DataForSEO: ${json?.status_message ?? `HTTP ${res.status}`}` };
    const task = json.tasks?.[0];
    if (!task || task.status_code !== OK) return { ok: false, reason: `DataForSEO: ${task?.status_message ?? 'no task in the answer'}` };
    return { ok: true, result: task.result?.[0] ?? {} };
  }

  return {
    name: 'DataForSEO',
    async estimate(keyword, country): Promise<KeywordEstimate> {
      const [vol, tr] = await Promise.all([
        post('clickstream_data/bulk_search_volume/live', [{ keywords: [keyword], location_code: country.locationCode }]),
        post('google_trends/explore/live', [{ keywords: [keyword], location_code: country.locationCode, type: 'youtube', time_range: 'past_12_months' }]),
      ]);
      if (!vol.ok) return { status: 'failed', reason: vol.reason };
      const item = (vol.result.items as Obj[] | undefined)?.find((i) => i.keyword === keyword) ?? (vol.result.items as Obj[] | undefined)?.[0];
      const sv = item?.search_volume;
      const monthly = Array.isArray(item?.monthly_searches)
        ? (item.monthly_searches as Obj[]).filter((m) => typeof m.search_volume === 'number' && typeof m.year === 'number' && typeof m.month === 'number')
          .map((m) => ({ month: `${m.year}-${String(m.month).padStart(2, '0')}`, volume: m.search_volume as number }))
        : [];
      const graph = tr.ok ? (tr.result.items as Obj[] | undefined)?.find((i) => i.type === 'google_trends_graph') : undefined;
      const interest = Array.isArray(graph?.data)
        ? (graph.data as Obj[]).filter((d) => !d.missing_data && typeof d.values?.[0] === 'number' && typeof d.date_from === 'string')
          .map((d) => ({ date: d.date_from as string, value: d.values[0] as number }))
        : [];
      return {
        status: 'ok',
        provider: 'DataForSEO',
        label: ESTIMATE_LABEL,
        keyword,
        country: country.code,
        volume: typeof sv === 'number' ? value(sv, 'DataForSEO clickstream monthly average', { keyword, location_code: country.locationCode }) : noData('DataForSEO has no volume for this keyword'),
        monthly,
        interest,
        fetchedAt: new Date().toISOString(),
      };
    },
  };
}
