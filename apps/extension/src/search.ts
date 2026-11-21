import { type KeywordSnapshot, normalizeKeyword, parseSearchPage } from '@viewproof/core';

/** Message posted by the MAIN-world script with the search page data YouTube already loaded. */
export const SEARCH_MSG = 'viewproof:search' as const;
export interface SearchMessage { type: typeof SEARCH_MSG; url: string; response: unknown }

export function isSearchMessage(e: MessageEvent, self: Window, origin: string): e is MessageEvent<SearchMessage> {
  if (e.source !== self || e.origin !== origin) return false;
  const d = e.data as Partial<SearchMessage> | null;
  return !!d && d.type === SEARCH_MSG && typeof d.url === 'string' && 'response' in d;
}

export type Snapshot = KeywordSnapshot;

export const MAX_SNAPSHOTS = 50;
export const SNAPSHOT_DAYS = 30;
export const SEARCH_KEY = 'searches';
const DAY_MS = 86_400_000;
type Table = Record<string, Snapshot>; // insertion order = recency

/** Keyword of a plain YouTube search URL; null for other pages and for filtered searches (`sp=`), which aren't the normal top results. */
export function searchQueryOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.pathname !== '/results' || u.searchParams.has('sp')) return null;
    const q = normalizeKeyword(u.searchParams.get('search_query') ?? '');
    return q || null;
  } catch {
    return null;
  }
}

export function searchStore(area: chrome.storage.StorageArea) {
  const load = async (): Promise<Table> => ((await area.get(SEARCH_KEY))[SEARCH_KEY] as Table | undefined) ?? {};
  return {
    async save(url: string, response: unknown, now: number): Promise<'saved' | 'skipped' | { error: string }> {
      const q = searchQueryOf(url);
      if (!q) return 'skipped';
      const page = parseSearchPage(response, q);
      if ('error' in page) return page;
      const table: Table = {};
      for (const [k, v] of Object.entries(await load())) if (k !== q && now - Date.parse(v.capturedAt) < SNAPSHOT_DAYS * DAY_MS) table[k] = v;
      table[q] = { query: q, capturedAt: new Date(now).toISOString(), page };
      const keys = Object.keys(table);
      for (const k of keys.slice(0, Math.max(0, keys.length - MAX_SNAPSHOTS))) delete table[k];
      await area.set({ [SEARCH_KEY]: table });
      return 'saved';
    },
    async get(keyword: string, now: number): Promise<Snapshot | null> {
      const s = (await load())[normalizeKeyword(keyword)];
      return s && now - Date.parse(s.capturedAt) < SNAPSHOT_DAYS * DAY_MS ? s : null;
    },
  };
}

/** Keywords whose snapshot is new or was read again between two versions of the table. */
export function changedQueries(before: Record<string, { capturedAt: string }> | undefined, after: Record<string, { capturedAt: string }> | undefined): string[] {
  return Object.entries(after ?? {}).filter(([k, v]) => before?.[k]?.capturedAt !== v.capturedAt).map(([k]) => k);
}
