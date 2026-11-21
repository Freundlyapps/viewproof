import { type KeywordSuggestions, QUESTION_PREFIXES, groupSuggestions, normalizeKeyword, parseSuggestions } from '@viewproof/core';

export const MAX_PER_HOUR = 60;
const HOUR = 3_600_000;
const PAUSE_MS = 24 * HOUR;
const CACHE_MS = 7 * 24 * HOUR;
const ENDPOINT = 'https://suggestqueries-clients6.youtube.com/complete/search';
const CACHE_KEY = 'suggest-cache';
const THROTTLE_KEY = 'suggest-throttle';

type Cache = Record<string, { at: number; suggestions: KeywordSuggestions }>;
type Throttle = { times: number[]; pausedUntil: number | null };
export type SuggestResult = { ok: true; suggestions: KeywordSuggestions } | { ok: false; reason: string };

/**
 * YouTube's own autocomplete for a keyword, the same request YouTube's search box makes.
 * Asked only when the user opens a report; ≤ 60 requests an hour; any refusal pauses for 24 h.
 */
export function suggester(deps: { area: chrome.storage.StorageArea; fetch: typeof fetch; now: () => number }) {
  const get = async <T>(key: string, empty: T): Promise<T> => ((await deps.area.get(key))[key] as T | undefined) ?? empty;
  return {
    async suggest(keyword: string): Promise<SuggestResult> {
      const kw = normalizeKeyword(keyword);
      const now = deps.now();
      const cache = await get<Cache>(CACHE_KEY, {});
      const hit = cache[kw];
      if (hit && now - hit.at < CACHE_MS) return { ok: true, suggestions: hit.suggestions };
      const th = await get<Throttle>(THROTTLE_KEY, { times: [], pausedUntil: null });
      if (th.pausedUntil && now < th.pausedUntil) return { ok: false, reason: `YouTube refused suggestion requests; paused until ${new Date(th.pausedUntil).toISOString()}` };
      const prefixes = ['', ...QUESTION_PREFIXES];
      const recent = th.times.filter((t) => now - t < HOUR);
      if (recent.length + prefixes.length > MAX_PER_HOUR) {
        const mins = Math.max(1, Math.ceil((recent[0]! + HOUR - now) / 60_000));
        return { ok: false, reason: `Suggestion limit reached (${MAX_PER_HOUR} per hour); try again in ${mins} minute${mins === 1 ? '' : 's'}.` };
      }
      const lists: { prefix: string; items: string[] }[] = [];
      for (const prefix of prefixes) {
        const q = prefix ? `${prefix} ${kw}` : kw;
        recent.push(deps.now());
        let items: string[] | null = null;
        try {
          const res = await deps.fetch(`${ENDPOINT}?client=youtube&ds=yt&q=${encodeURIComponent(q)}`, { credentials: 'omit' });
          items = res.ok ? parseSuggestions(await res.text()) : null;
        } catch {
          items = null;
        }
        if (!items) {
          const until = now + PAUSE_MS;
          await deps.area.set({ [THROTTLE_KEY]: { times: recent, pausedUntil: until } satisfies Throttle });
          return { ok: false, reason: `YouTube refused suggestion requests; paused until ${new Date(until).toISOString()}` };
        }
        lists.push({ prefix, items });
      }
      await deps.area.set({ [THROTTLE_KEY]: { times: recent, pausedUntil: null } satisfies Throttle });
      const suggestions = groupSuggestions(kw, lists);
      const next: Cache = {};
      for (const [k, v] of Object.entries(cache)) if (now - v.at < CACHE_MS) next[k] = v;
      next[kw] = { at: now, suggestions };
      await deps.area.set({ [CACHE_KEY]: next });
      return { ok: true, suggestions };
    },
  };
}
