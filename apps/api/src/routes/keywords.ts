import { COUNTRIES, DEFAULT_COUNTRY, type KeywordEstimate, normalizeKeyword } from '@viewproof/core';
import type { KeywordCacheRow } from '@viewproof/db';
import type { Context, Hono } from 'hono';
import type { Deps } from '../app';
import { readSession } from '../session';

const ESTIMATE_TTL_MS = 30 * 86_400_000;
export const MAX_KEYWORD = 100;
export const BAD_KEYWORD = { error: 'bad_request', message: `Type a keyword (up to ${MAX_KEYWORD} characters).` } as const;

/** The normalized keyword from ?q=, or null when empty or too long. */
export function keywordParam(c: Context): string | null {
  const q = normalizeKeyword(c.req.query('q') ?? '');
  return q && q.length <= MAX_KEYWORD ? q : null;
}

export function keywordRoutes(app: Hono, deps: Deps): void {
  /** Vendor estimate, cached 30 days and shared across users; "off"/"failed" are never stored. */
  app.get('/api/keywords/estimate', async (c) => {
    if (!(await readSession(c, deps))) return c.json({ error: 'signed_out', message: 'Sign in first.' }, 401);
    const q = keywordParam(c);
    if (!q) return c.json(BAD_KEYWORD, 400);
    const country = COUNTRIES.find((x) => x.code === (c.req.query('country') ?? '').toUpperCase()) ?? COUNTRIES.find((x) => x.code === DEFAULT_COUNTRY)!;
    const provider = deps.keywords;
    const row = await deps.db.prepare('SELECT * FROM keyword_cache WHERE keyword = ? AND country = ? AND provider = ?').bind(q, country.code, provider.name).first<KeywordCacheRow>();
    if (row && deps.now() - Date.parse(row.fetched_at) < ESTIMATE_TTL_MS) return c.json(JSON.parse(row.body) as KeywordEstimate);
    const est = await provider.estimate(q, country);
    if (est.status === 'ok') {
      await deps.db
        .prepare('INSERT INTO keyword_cache (keyword, country, provider, body, fetched_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(keyword, country, provider) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at')
        .bind(q, country.code, provider.name, JSON.stringify(est), new Date(deps.now()).toISOString())
        .run();
    }
    return c.json(est);
  });
}
