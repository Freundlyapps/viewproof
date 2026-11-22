import { type ContributeResult, type PoolBrowser, type PoolObservation, parseBatch, plausible } from '@viewproof/core';
import type { Context, Hono } from 'hono';
import type { Deps } from '../app';
import { randomToken, sha256Hex } from '../crypto';
import { readSession } from '../session';
import { chunked } from '../sql';

export const DAILY_OBSERVATIONS = 3000;
/** Malformed items per browser per day before the whole account is paused for a week. */
export const SUSPEND_AFTER_INVALID = 200;
export const SUSPEND_DAYS = 7;
export const MAX_BROWSERS = 5;
/** Channels the pool hasn't seen before, per browser per day: bounds how much polling one browser can cause. */
export const DAILY_NEW_CHANNELS = 200;
const NOT_LINKED = 'This browser is not linked. Link it again in ViewProof → Settings → Extension & data.';
const PAUSED = `Contribution paused for ${SUSPEND_DAYS} days: too much data was rejected.`;
const DAY_MS = 86_400_000;

type TokenRow = { id: string; user_id: string; label: string; created_at: string; last_used_at: string | null; status: string };
const err = (c: Context, status: number, error: string, message: string) => c.json({ error, message }, status as 400);
const today = (deps: Deps) => new Date(deps.now()).toISOString().slice(0, 10);
/** Day precision for anything stored next to an account or a batch: no timestamp can pair a person with what they saw. */
const dayIso = (deps: Deps) => `${today(deps)}T00:00:00.000Z`;
const hourIso = (iso: string) => `${iso.slice(0, 13)}:00:00.000Z`;

async function pausedUntil(deps: Deps, userId: string): Promise<string | null> {
  const r = await deps.db.prepare('SELECT until FROM pool_suspensions WHERE user_id = ?').bind(userId).first<{ until: string }>();
  return r && Date.parse(r.until) > deps.now() ? r.until : null;
}

async function browsers(deps: Deps, userId: string): Promise<PoolBrowser[]> {
  const paused = await pausedUntil(deps, userId);
  const rows = (await deps.db.prepare(
    `SELECT t.*, COALESCE(d.accepted, 0) AS acc_today, COALESCE(d.rejected, 0) AS rej_today,
            (SELECT COALESCE(SUM(accepted), 0) FROM pool_token_days WHERE token_id = t.id) AS acc_total
     FROM pool_tokens t LEFT JOIN pool_token_days d ON d.token_id = t.id AND d.day = ? WHERE t.user_id = ? ORDER BY t.created_at`,
  ).bind(today(deps), userId).all<TokenRow & { acc_today: number; rej_today: number; acc_total: number }>()).results;
  return rows.map((r) => ({
    id: r.id, label: r.label, createdAt: r.created_at, lastUsedAt: r.last_used_at,
    acceptedToday: r.acc_today, rejectedToday: r.rej_today, acceptedTotal: r.acc_total, status: paused ? 'suspended' : 'active',
  }));
}
export { browsers as poolBrowsersOf };

/**
 * Store accepted observations. History check (D6) is against the channel feed's own counts (video_snapshots),
 * never against other contributions: a forged first value can't make honest ones fail.
 */
async function store(deps: Deps, items: PoolObservation[], newChannelRoom: number): Promise<{ accepted: number; reasons: string[]; newChannels: number }> {
  const day = dayIso(deps);
  const ids = [...new Set(items.map((i) => i.videoId))];
  const feedLatest = new Map<string, { views: number; at: string }>();
  for (const r of await chunked(ids, async (chunk, ph) => (await deps.db.prepare(
    `SELECT s.video_id, s.views, s.at FROM video_snapshots s
     WHERE s.video_id IN (${ph}) AND s.at = (SELECT MAX(at) FROM video_snapshots WHERE video_id = s.video_id)`,
  ).bind(...chunk).all<{ video_id: string; views: number; at: string }>()).results)) feedLatest.set(r.video_id, { views: r.views, at: r.at });
  const channelIds = [...new Set(items.map((i) => i.channelId))];
  const known = new Set((await chunked(channelIds, async (chunk, ph) => (await deps.db.prepare(`SELECT channel_id FROM pool_channels WHERE channel_id IN (${ph})`)
    .bind(...chunk).all<{ channel_id: string }>()).results)).map((r) => r.channel_id));

  const reasons: string[] = [];
  const stmts: D1PreparedStatement[] = [];
  let accepted = 0;
  let newChannels = 0;
  for (const o of items) {
    const at = hourIso(o.observedAt);
    const feed = feedLatest.get(o.videoId) ?? null;
    const why = feed ? (Date.parse(o.observedAt) >= Date.parse(feed.at) ? plausible(feed, { views: o.views, at: o.observedAt }) : plausible({ views: o.views, at: o.observedAt }, feed)) : null;
    if (why) { reasons.push(why); continue; }
    if (!known.has(o.channelId)) {
      if (newChannels >= newChannelRoom) { reasons.push('channelId: too many new channels from this browser today'); continue; }
      newChannels++;
      known.add(o.channelId);
    }
    accepted++;
    stmts.push(
      deps.db.prepare('INSERT INTO pool_channels (channel_id, first_seen_at, last_seen_at) VALUES (?, ?, ?) ON CONFLICT(channel_id) DO UPDATE SET last_seen_at = excluded.last_seen_at')
        .bind(o.channelId, day, day),
      // So the feed poller sees it; the title is replaced by the feed's on the first poll.
      deps.db.prepare('INSERT OR IGNORE INTO tracked_channels (channel_id, title, created_at) VALUES (?, ?, ?)').bind(o.channelId, o.channelId, day),
      deps.db.prepare(
        `INSERT INTO pool_videos (video_id, channel_id, title, published_at, format, duration_sec, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(video_id) DO UPDATE SET title = excluded.title, last_seen_at = excluded.last_seen_at,
           published_at = COALESCE(pool_videos.published_at, excluded.published_at),
           format = CASE WHEN excluded.format = 'unknown' THEN pool_videos.format ELSE excluded.format END,
           duration_sec = COALESCE(excluded.duration_sec, pool_videos.duration_sec)`,
      ).bind(o.videoId, o.channelId, o.title, o.publishedAt, o.format, o.durationSec, day, day),
      deps.db.prepare('INSERT OR IGNORE INTO pool_observations (video_id, at, views, source) VALUES (?, ?, ?, ?)').bind(o.videoId, at, o.views, o.source),
    );
  }
  if (stmts.length) await deps.db.batch(stmts);
  return { accepted, reasons, newChannels };
}

export function poolRoutes(app: Hono, deps: Deps): void {
  const uidOf = async (c: Context) => (await readSession(c, deps))?.userId ?? null;

  app.post('/api/pool/tokens', async (c) => {
    const uid = await uidOf(c);
    if (!uid) return err(c, 401, 'signed_out', 'Sign in first.');
    if (await pausedUntil(deps, uid)) return err(c, 403, 'limit', PAUSED);
    const n = (await deps.db.prepare('SELECT COUNT(*) AS n FROM pool_tokens WHERE user_id = ?').bind(uid).first<{ n: number }>())!.n;
    if (n >= MAX_BROWSERS) return err(c, 422, 'limit', `You can link up to ${MAX_BROWSERS} browsers. Unlink one first.`);
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
    if (await pausedUntil(deps, row.user_id)) return err(c, 403, 'limit', PAUSED);
    const day = today(deps);
    const used = await deps.db.prepare('SELECT accepted, rejected, invalid, new_channels FROM pool_token_days WHERE token_id = ? AND day = ?')
      .bind(row.id, day).first<{ accepted: number; rejected: number; invalid: number; new_channels: number }>();
    if ((used?.accepted ?? 0) >= DAILY_OBSERVATIONS) return err(c, 429, 'limit', `This browser shared ${DAILY_OBSERVATIONS} observations today. More tomorrow.`);

    const parsed = parseBatch(await c.req.json().catch(() => null), new Date(deps.now()).toISOString());
    if (!parsed.ok) return err(c, 400, 'bad_request', parsed.reason);
    const room = DAILY_OBSERVATIONS - (used?.accepted ?? 0);
    const kept = parsed.items.slice(0, room);
    const overCap = parsed.items.length - kept.length;
    const { accepted, reasons, newChannels } = await store(deps, kept, DAILY_NEW_CHANNELS - (used?.new_channels ?? 0));
    const invalid = parsed.rejected.length;
    const rejected = invalid + reasons.length + overCap;
    const allReasons = [...reasons, ...parsed.rejected.map((r) => r.reason), ...(overCap ? [`over the daily limit of ${DAILY_OBSERVATIONS}`] : [])];
    const stmts = [
      deps.db.prepare(
        `INSERT INTO pool_token_days (token_id, day, accepted, rejected, invalid, new_channels) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(token_id, day) DO UPDATE SET accepted = accepted + excluded.accepted, rejected = rejected + excluded.rejected,
           invalid = invalid + excluded.invalid, new_channels = new_channels + excluded.new_channels`,
      ).bind(row.id, day, accepted, rejected, invalid, newChannels),
      deps.db.prepare('UPDATE pool_tokens SET last_used_at = ? WHERE id = ?').bind(dayIso(deps), row.id),
    ];
    // Only malformed items count toward a pause; a count that disagrees with the feed can be honest timing.
    if ((used?.invalid ?? 0) + invalid > SUSPEND_AFTER_INVALID) {
      stmts.push(deps.db.prepare('INSERT INTO pool_suspensions (user_id, until) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET until = excluded.until')
        .bind(row.user_id, new Date(deps.now() + SUSPEND_DAYS * DAY_MS).toISOString()));
    }
    await deps.db.batch(stmts);
    const body: ContributeResult = { accepted, rejected, reasons: [...new Set(allReasons)].slice(0, 5) };
    return c.json(body);
  });
}
