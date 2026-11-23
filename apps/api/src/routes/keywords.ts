import { COUNTRIES, DEFAULT_COUNTRY, type KeywordTrends, normalizeKeyword } from '@viewproof/core';
import type { KeywordCacheRow } from '@viewproof/db';
import type { Context, Hono } from 'hono';
import type { Deps } from '../app';
import { readSession } from '../session';

const TRENDS_TTL_MS = 30 * 86_400_000;
/** New (uncached) paid lookups per user per UTC day. */
export const DAILY_LOOKUPS = 50;
const LIMIT = { error: 'limit', message: `You reached ${DAILY_LOOKUPS} new keyword trend lookups today; keywords looked up before still work. More tomorrow.` } as const;
export const MAX_KEYWORD = 100;
export const BAD_KEYWORD = { error: 'bad_request', message: `Type a keyword (up to ${MAX_KEYWORD} characters).` } as const;

/** The normalized keyword from ?q=, or null when empty or too long. */
export function keywordParam(c: Context): string | null {
  const q = normalizeKeyword(c.req.query('q') ?? '');
  return q && q.length <= MAX_KEYWORD ? q : null;
}

export const KEYWORD_LIMIT_MESSAGE = LIMIT.message;

/** YouTube search interest for a keyword (vendor), cached 30 days and shared; new lookups count against the user's daily cap. */
export async function keywordTrends(deps: Deps, userId: string, q: string, countryCode: string): Promise<KeywordTrends | { limit: true }> {
  const country = COUNTRIES.find((x) => x.code === countryCode.toUpperCase()) ?? COUNTRIES.find((x) => x.code === DEFAULT_COUNTRY)!;
  const provider = deps.keywords;
  const row = await deps.db.prepare('SELECT * FROM keyword_cache WHERE keyword = ? AND country = ? AND provider = ?').bind(q, country.code, provider.name).first<KeywordCacheRow>();
  if (row && deps.now() - Date.parse(row.fetched_at) < TRENDS_TTL_MS) return JSON.parse(row.body) as KeywordTrends;
  if (provider.name !== 'none') {
    // Count the lookup first (atomically), so parallel requests can't pass the cap together.
    const day = new Date(deps.now()).toISOString().slice(0, 10);
    const counted = await deps.db
      .prepare('INSERT INTO keyword_lookups (user_id, day, count) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count')
      .bind(userId, day, DAILY_LOOKUPS)
      .first<{ count: number }>();
    if (!counted) return { limit: true };
  }
  const est = await provider.trends(q, country);
  if (est.status === 'ok') {
    await deps.db
      .prepare('INSERT INTO keyword_cache (keyword, country, provider, body, fetched_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(keyword, country, provider) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at')
      .bind(q, country.code, provider.name, JSON.stringify(est), new Date(deps.now()).toISOString())
      .run();
  }
  return est;
}

export function keywordRoutes(app: Hono, deps: Deps): void {
  /** Optional YouTube search interest (Google Trends via a vendor), cached 30 days and shared across users; "off"/"failed" are never stored. */
  app.get('/api/keywords/trends', async (c) => {
    const s = await readSession(c, deps);
    if (!s) return c.json({ error: 'signed_out', message: 'Sign in first.' }, 401);
    const q = keywordParam(c);
    if (!q) return c.json(BAD_KEYWORD, 400);
    const country = (c.req.query('country') ?? '');
    const r = await keywordTrends(deps, s.userId, q, country);
    return 'limit' in r ? c.json(LIMIT, 429) : c.json(r);
  });
}
