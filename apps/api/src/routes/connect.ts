import type { PendingConnectionRow } from '@viewproof/db';
import type { Context, Hono } from 'hono';
import type { Deps } from '../app';
import { decryptSecret, randomToken } from '../crypto';
import { SCOPES } from '../google';
import { maxChannels } from '../plans';
import { readSession } from '../session';
import { ConfirmChannel } from '../views/ConfirmChannel';
import { Message } from '../views/Message';

const notFound = (c: Context) => {
  c.status(404);
  return c.html(Message({ title: 'Not found', text: 'Not found.', action: { href: '/account', label: 'Go to your account' } }));
};

async function pendingFor(deps: Deps, id: string, userId: string) {
  return deps.db.prepare('SELECT * FROM pending_connections WHERE id = ? AND user_id = ?').bind(id, userId).first<PendingConnectionRow>();
}

/** Revoke Google access for a pending connection we won't keep, and drop it. */
async function discard(deps: Deps, p: PendingConnectionRow) {
  await deps.google.revoke(await decryptSecret(p.refresh_token_enc, deps.config.tokenKey));
  await deps.db.prepare('DELETE FROM pending_connections WHERE id = ?').bind(p.id).run();
}

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
    const id = String((await c.req.parseBody()).id ?? '');
    const p = await pendingFor(deps, id, s.userId);
    if (!p) return c.redirect('/account', 302); // already confirmed (double submit) or expired

    const existing = await deps.db.prepare('SELECT user_id FROM channels WHERE channel_id = ?').bind(p.channel_id).first<{ user_id: string }>();
    if (existing && existing.user_id !== s.userId) {
      await discard(deps, p);
      c.status(409);
      return c.html(Message({ title: 'Already connected', text: 'This channel is already connected to another ViewProof account.', action: { href: '/account', label: 'Go to your account' } }));
    }

    const nowIso = new Date(deps.now()).toISOString();
    if (existing) {
      // Reconnect: fresh token and permissions for a channel this user already has.
      await deps.db.batch([
        deps.db
          .prepare("UPDATE channels SET title = ?, handle = ?, avatar_url = ?, scopes = ?, refresh_token_enc = ?, status = 'active', status_reason = NULL, last_verified_at = ? WHERE channel_id = ?")
          .bind(p.title, p.handle, p.avatar_url, p.scopes, p.refresh_token_enc, nowIso, p.channel_id),
        deps.db.prepare('DELETE FROM pending_connections WHERE id = ?').bind(p.id),
      ]);
      return c.redirect(`/account?connected=${encodeURIComponent(p.channel_id)}`, 302);
    }

    const user = await deps.db.prepare('SELECT plan FROM users WHERE id = ?').bind(s.userId).first<{ plan: string }>();
    const limit = maxChannels(user?.plan ?? 'free', deps.config.selfHosted);
    const { n } = (await deps.db.prepare('SELECT COUNT(*) AS n FROM channels WHERE user_id = ?').bind(s.userId).first<{ n: number }>())!;
    if (n >= limit) {
      await discard(deps, p);
      c.status(403);
      return c.html(Message({ title: 'Channel limit reached', text: `Your plan allows ${limit} channel${limit === 1 ? '' : 's'}. Remove one first or upgrade.`, action: { href: '/account', label: 'Go to your account' } }));
    }

    await deps.db.batch([
      deps.db
        .prepare("INSERT INTO channels (id, user_id, platform, channel_id, title, handle, avatar_url, scopes, refresh_token_enc, status, connected_at, last_verified_at) VALUES (?, ?, 'youtube', ?, ?, ?, ?, ?, ?, 'active', ?, ?)")
        .bind(randomToken(16), s.userId, p.channel_id, p.title, p.handle, p.avatar_url, p.scopes, p.refresh_token_enc, nowIso, nowIso),
      deps.db.prepare('DELETE FROM pending_connections WHERE id = ?').bind(p.id),
    ]);
    return c.redirect(`/account?connected=${encodeURIComponent(p.channel_id)}`, 302);
  });

  app.post('/connect/cancel', async (c) => {
    const s = await readSession(c, deps);
    if (!s) return c.redirect('/auth/google/start', 302);
    const p = await pendingFor(deps, String((await c.req.parseBody()).id ?? ''), s.userId);
    const revenue = p?.scopes.split(' ').includes(SCOPES.revenue) ?? false;
    if (p) await discard(deps, p);
    return c.redirect(`/auth/google/start?choose=1${revenue ? '&revenue=1' : ''}`, 302);
  });
}
