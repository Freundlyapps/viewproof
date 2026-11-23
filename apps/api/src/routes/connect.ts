import type { PendingConnectionRow } from '@viewproof/db';
import type { Context, Hono } from 'hono';
import type { Deps } from '../app';
import { randomToken } from '../crypto';
import { SCOPES } from '../google';
import { discardPending } from '../grants';
import { limitMessage, maxChannels } from '../plans';

export const channelLimitText = (limit: number, plan: string, billingOn: boolean) =>
  limitMessage(`Your plan allows ${limit} channel${limit === 1 ? '' : 's'}. Remove one first.`, plan, billingOn);
import { readSession } from '../session';
import { ConfirmChannel } from '../views/ConfirmChannel';
import { Message } from '../views/Message';

const TO_ACCOUNT = { href: '/account', label: 'Go to your account' };
const notFound = (c: Context) => {
  c.status(404);
  return c.html(Message({ title: 'Not found', text: 'Not found.', action: TO_ACCOUNT }));
};
/** Large stand-in for "no limit" (SQLite can't bind Infinity). */
const NO_LIMIT = 1_000_000;

async function pendingFor(deps: Deps, id: string, userId: string) {
  return deps.db.prepare('SELECT * FROM pending_connections WHERE id = ? AND user_id = ?').bind(id, userId).first<PendingConnectionRow>();
}
const ownerOf = (deps: Deps, channelId: string) =>
  deps.db.prepare('SELECT user_id FROM channels WHERE channel_id = ?').bind(channelId).first<{ user_id: string }>();

export function connectRoutes(app: Hono, deps: Deps): void {
  app.get('/connect/confirm', async (c) => {
    const s = await readSession(c, deps);
    if (!s) return c.redirect('/auth/google/start', 302);
    const p = await pendingFor(deps, c.req.query('id') ?? '', s.userId);
    if (!p) return notFound(c);
    return c.html(ConfirmChannel({ p, revenue: p.scopes.split(' ').includes(SCOPES.revenue) }));
  });

  app.post('/connect/confirm', async (c) => {
    const s = await readSession(c, deps);
    if (!s) return c.redirect('/auth/google/start', 302);
    const p = await pendingFor(deps, String((await c.req.parseBody()).id ?? ''), s.userId);
    if (!p) return c.redirect('/account', 302); // already confirmed (double submit) or expired
    const connected = `/account?connected=${encodeURIComponent(p.channel_id)}`;
    const nowIso = new Date(deps.now()).toISOString();

    const before = await ownerOf(deps, p.channel_id);
    if (before?.user_id === s.userId) {
      // Reconnect: fresh token and permissions for a channel this user already has.
      await deps.db.batch([
        deps.db
          .prepare("UPDATE channels SET title = ?, handle = ?, avatar_url = ?, scopes = ?, refresh_token_enc = ?, status = 'active', status_reason = NULL, last_verified_at = ? WHERE channel_id = ? AND user_id = ?")
          .bind(p.title, p.handle, p.avatar_url, p.scopes, p.refresh_token_enc, nowIso, p.channel_id, s.userId),
        deps.db.prepare('DELETE FROM pending_connections WHERE id = ?').bind(p.id),
      ]);
      return c.redirect(connected, 302);
    }

    const user = await deps.db.prepare('SELECT plan FROM users WHERE id = ?').bind(s.userId).first<{ plan: string }>();
    const limit = maxChannels(user?.plan ?? 'free', deps.config.selfHosted);
    // One transaction: insert only while under the limit and only if nobody has the channel.
    const [ins] = await deps.db.batch([
      deps.db
        .prepare(
          `INSERT INTO channels (id, user_id, platform, channel_id, title, handle, avatar_url, scopes, refresh_token_enc, status, connected_at, last_verified_at)
           SELECT ?, ?, 'youtube', ?, ?, ?, ?, ?, ?, 'active', ?, ?
           WHERE (SELECT COUNT(*) FROM channels WHERE user_id = ?) < ?
           ON CONFLICT(channel_id) DO NOTHING`,
        )
        .bind(randomToken(16), s.userId, p.channel_id, p.title, p.handle, p.avatar_url, p.scopes, p.refresh_token_enc, nowIso, nowIso, s.userId, Number.isFinite(limit) ? limit : NO_LIMIT),
      deps.db
        .prepare('DELETE FROM pending_connections WHERE id = ? AND EXISTS (SELECT 1 FROM channels WHERE channel_id = ? AND user_id = ?)')
        .bind(p.id, p.channel_id, s.userId),
    ]);
    if ((ins?.meta.changes ?? 0) > 0) return c.redirect(connected, 302);

    const after = await ownerOf(deps, p.channel_id);
    if (after?.user_id === s.userId) return c.redirect(connected, 302); // a parallel click won
    await discardPending(deps, p);
    if (after) {
      c.status(409);
      return c.html(Message({ title: 'Already connected', text: 'This channel is already connected to another ViewProof account.', action: TO_ACCOUNT }));
    }
    c.status(403);
    return c.html(Message({ title: 'Channel limit reached', text: channelLimitText(limit, user?.plan ?? 'free', !!deps.config.billing), action: TO_ACCOUNT }));
  });

  app.post('/connect/cancel', async (c) => {
    const s = await readSession(c, deps);
    if (!s) return c.redirect('/auth/google/start', 302);
    const p = await pendingFor(deps, String((await c.req.parseBody()).id ?? ''), s.userId);
    const revenue = p?.scopes.split(' ').includes(SCOPES.revenue) ?? false;
    if (p) await discardPending(deps, p);
    return c.redirect(`/auth/google/start?choose=1${revenue ? '&revenue=1' : ''}`, 302);
  });
}
