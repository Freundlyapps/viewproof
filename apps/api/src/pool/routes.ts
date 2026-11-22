import { type ContributeResult, type PoolBrowser, type PoolObservation, parseBatch, plausible } from '@viewproof/core';
import type { Context, Hono } from 'hono';
import type { Deps } from '../app';
import { randomToken, sha256Hex } from '../crypto';
import { readSession } from '../session';

export const DAILY_OBSERVATIONS = 3000;
export const SUSPEND_AFTER_REJECTED = 200;
const NOT_LINKED = 'This browser is not linked. Link it again in ViewProof → Settings → Extension & data.';

type TokenRow = { id: string; user_id: string; label: string; created_at: string; last_used_at: string | null; status: string };
const err = (c: Context, status: number, error: string, message: string) => c.json({ error, message }, status as 400);
const today = (deps: Deps) => new Date(deps.now()).toISOString().slice(0, 10);

async function browsers(deps: Deps, userId: string): Promise<PoolBrowser[]> {
  const rows = (await deps.db.prepare(
    `SELECT t.*, COALESCE(d.accepted, 0) AS acc_today, COALESCE(d.rejected, 0) AS rej_today,
            (SELECT COALESCE(SUM(accepted), 0) FROM pool_token_days WHERE token_id = t.id) AS acc_total
     FROM pool_tokens t LEFT JOIN pool_token_days d ON d.token_id = t.id AND d.day = ? WHERE t.user_id = ? ORDER BY t.created_at`,
  ).bind(today(deps), userId).all<TokenRow & { acc_today: number; rej_today: number; acc_total: number }>()).results;
  return rows.map((r) => ({
    id: r.id, label: r.label, createdAt: r.created_at, lastUsedAt: r.last_used_at,
    acceptedToday: r.acc_today, rejectedToday: r.rej_today, acceptedTotal: r.acc_total, status: r.status === 'suspended' ? 'suspended' : 'active',
  }));
}
export { browsers as poolBrowsersOf };

/** Store accepted observations; returns per-item rejection reasons from the history check (D6). */
async function store(deps: Deps, items: PoolObservation[]): Promise<{ accepted: number; reasons: string[] }> {
  const iso = new Date(deps.now()).toISOString();
  const ids = [...new Set(items.map((i) => i.videoId))];
  const latest = new Map<string, { views: number; at: string }>();
  if (ids.length) {
    const rows = (await deps.db.prepare(
      `SELECT o.video_id, o.views, o.at FROM pool_observations o
       WHERE o.video_id IN (${ids.map(() => '?').join(',')}) AND o.at = (SELECT MAX(at) FROM pool_observations WHERE video_id = o.video_id)`,
    ).bind(...ids).all<{ video_id: string; views: number; at: string }>()).results;
    for (const r of rows) latest.set(r.video_id, { views: r.views, at: r.at });
  }
  const reasons: string[] = [];
  const stmts: D1PreparedStatement[] = [];
  let accepted = 0;
  for (const o of [...items].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt))) {
    const prev = latest.get(o.videoId) ?? null;
    // Compare against the observation just before this one in time; an equal re-send is a duplicate, not a drop.
    const why = prev && Date.parse(prev.at) <= Date.parse(o.observedAt) ? plausible(prev, { views: o.views, at: o.observedAt }) : null;
    if (why) { reasons.push(why); continue; }
    accepted++;
    if (!prev || Date.parse(o.observedAt) > Date.parse(prev.at)) latest.set(o.videoId, { views: o.views, at: o.observedAt });
    stmts.push(
      deps.db.prepare('INSERT INTO pool_channels (channel_id, first_seen_at, last_seen_at) VALUES (?, ?, ?) ON CONFLICT(channel_id) DO UPDATE SET last_seen_at = excluded.last_seen_at')
        .bind(o.channelId, iso, iso),
      deps.db.prepare(
        `INSERT INTO pool_videos (video_id, channel_id, title, published_at, format, duration_sec, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(video_id) DO UPDATE SET title = excluded.title, last_seen_at = excluded.last_seen_at,
           published_at = COALESCE(pool_videos.published_at, excluded.published_at),
           format = CASE WHEN excluded.format = 'unknown' THEN pool_videos.format ELSE excluded.format END,
           duration_sec = COALESCE(excluded.duration_sec, pool_videos.duration_sec)`,
      ).bind(o.videoId, o.channelId, o.title, o.publishedAt, o.format, o.durationSec, iso, iso),
      deps.db.prepare('INSERT OR IGNORE INTO pool_observations (video_id, at, views, source) VALUES (?, ?, ?, ?)').bind(o.videoId, o.observedAt, o.views, o.source),
    );
  }
  if (stmts.length) await deps.db.batch(stmts);
  return { accepted, reasons };
}

export function poolRoutes(app: Hono, deps: Deps): void {
  const uidOf = async (c: Context) => (await readSession(c, deps))?.userId ?? null;

  app.post('/api/pool/tokens', async (c) => {
    const uid = await uidOf(c);
    if (!uid) return err(c, 401, 'signed_out', 'Sign in first.');
    const body = (await c.req.json().catch(() => null)) as { label?: unknown } | null;
    const label = typeof body?.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 40) : 'Browser';
    const token = randomToken(32);
    const id = randomToken(12);
    await deps.db.prepare('INSERT INTO pool_tokens (id, id_hash, user_id, label, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, await sha256Hex(token), uid, label, new Date(deps.now()).toISOString()).run();
    const browser = (await browsers(deps, uid)).find((b) => b.id === id)!;
    return c.json({ token, browser }, 201);
  });

  app.get('/api/pool/browsers', async (c) => {
    const uid = await uidOf(c);
    if (!uid) return err(c, 401, 'signed_out', 'Sign in first.');
    return c.json(await browsers(deps, uid));
  });

  app.delete('/api/pool/browsers/:id', async (c) => {
    const uid = await uidOf(c);
    if (!uid) return err(c, 401, 'signed_out', 'Sign in first.');
    await deps.db.prepare('DELETE FROM pool_tokens WHERE id = ? AND user_id = ?').bind(c.req.param('id'), uid).run();
    return c.body(null, 204);
  });

  /** Bearer token only (no cookie): the extension's background script sends batches here. */
  app.post('/api/pool/contribute', async (c) => {
    const auth = c.req.header('authorization') ?? '';
    const token = /^Bearer ([\w-]{20,100})$/.exec(auth)?.[1];
    const row = token ? await deps.db.prepare('SELECT * FROM pool_tokens WHERE id_hash = ?').bind(await sha256Hex(token)).first<TokenRow>() : null;
    if (!row) return err(c, 401, 'signed_out', NOT_LINKED);
    if (row.status === 'suspended') return err(c, 403, 'limit', 'Contribution paused: too much data was rejected.');
    const day = today(deps);
    const used = await deps.db.prepare('SELECT accepted, rejected FROM pool_token_days WHERE token_id = ? AND day = ?').bind(row.id, day).first<{ accepted: number; rejected: number }>();
    if ((used?.accepted ?? 0) >= DAILY_OBSERVATIONS) return err(c, 429, 'limit', `This browser shared ${DAILY_OBSERVATIONS} observations today. More tomorrow.`);

    const parsed = parseBatch(await c.req.json().catch(() => null), new Date(deps.now()).toISOString());
    if (!parsed.ok) return err(c, 400, 'bad_request', parsed.reason);
    const room = DAILY_OBSERVATIONS - (used?.accepted ?? 0);
    const kept = parsed.items.slice(0, room);
    const { accepted, reasons } = await store(deps, kept);
    const rejected = parsed.rejected.length + reasons.length;
    const allReasons = [...reasons, ...parsed.rejected.map((r) => r.reason)];
    const rejectedToday = (used?.rejected ?? 0) + rejected;
    const iso = new Date(deps.now()).toISOString();
    await deps.db.batch([
      deps.db.prepare(
        `INSERT INTO pool_token_days (token_id, day, accepted, rejected) VALUES (?, ?, ?, ?)
         ON CONFLICT(token_id, day) DO UPDATE SET accepted = accepted + excluded.accepted, rejected = rejected + excluded.rejected`,
      ).bind(row.id, day, accepted, rejected),
      deps.db.prepare(`UPDATE pool_tokens SET last_used_at = ?${rejectedToday > SUSPEND_AFTER_REJECTED ? ", status = 'suspended'" : ''} WHERE id = ?`).bind(iso, row.id),
    ]);
    const body: ContributeResult = { accepted, rejected, reasons: [...new Set(allReasons)].slice(0, 5) };
    return c.json(body);
  });
}
