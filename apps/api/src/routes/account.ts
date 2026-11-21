import type { ChannelRow, PendingConnectionRow, UserRow } from '@viewproof/db';
import type { Context, Hono } from 'hono';
import type { Deps } from '../app';
import { decryptSecret } from '../crypto';
import { maxChannels } from '../plans';
import { clearSession, readSession } from '../session';
import { Account } from '../views/Account';
import { Message } from '../views/Message';

const notFound = (c: Context) => {
  c.status(404);
  return c.html(Message({ title: 'Not found', text: 'Not found.', action: { href: '/account', label: 'Go to your account' } }));
};

const user = (deps: Deps, id: string) => deps.db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
const channelsOf = async (deps: Deps, userId: string) =>
  (await deps.db.prepare('SELECT * FROM channels WHERE user_id = ? ORDER BY connected_at').bind(userId).all<ChannelRow>()).results;
const ownChannel = (deps: Deps, id: string, userId: string) =>
  deps.db.prepare('SELECT * FROM channels WHERE id = ? AND user_id = ?').bind(id, userId).first<ChannelRow>();

/** Ask Google whether the channel is still reachable with its stored access. */
async function checkChannel(deps: Deps, ch: ChannelRow): Promise<void> {
  const set = (status: ChannelRow['status'], reason: string | null, verified: boolean) =>
    deps.db
      .prepare(`UPDATE channels SET status = ?, status_reason = ?${verified ? ', last_verified_at = ?' : ''} WHERE id = ?`)
      .bind(...(verified ? [status, reason, new Date(deps.now()).toISOString(), ch.id] : [status, reason, ch.id]))
      .run();

  const token = await deps.google.refresh(await decryptSecret(ch.refresh_token_enc, deps.config.tokenKey));
  if ('kind' in token) {
    return void (await (token.kind === 'revoked'
      ? set('reconnect', 'Google access was removed or expired', true)
      : set(ch.status, `Check failed: ${token.reason}`, false)));
  }
  const list = await deps.google.myChannels(token.accessToken);
  if ('kind' in list) {
    return void (await (list.kind === 'revoked'
      ? set('reconnect', 'Google access was removed or expired', true)
      : set(ch.status, `Check failed: ${list.reason}`, false)));
  }
  const now = list.find((x) => x.channelId === ch.channel_id);
  if (!now) return void (await set('gone', 'YouTube no longer returns this channel', true));
  await deps.db
    .prepare("UPDATE channels SET status = 'active', status_reason = NULL, title = ?, handle = ?, avatar_url = ?, last_verified_at = ? WHERE id = ?")
    .bind(now.title, now.handle, now.avatarUrl, new Date(deps.now()).toISOString(), ch.id)
    .run();
}

export async function revokeAndDelete(deps: Deps, ch: ChannelRow): Promise<void> {
  try {
    await deps.google.revoke(await decryptSecret(ch.refresh_token_enc, deps.config.tokenKey));
  } finally {
    await deps.db.prepare('DELETE FROM channels WHERE id = ?').bind(ch.id).run();
  }
}

export function accountRoutes(app: Hono, deps: Deps): void {
  app.get('/account', async (c) => {
    const s = await readSession(c, deps);
    const u = s && (await user(deps, s.userId));
    if (!u) return c.redirect('/auth/google/start', 302);
    const connected = c.req.query('connected');
    return c.html(Account({ user: u, channels: await channelsOf(deps, u.id), max: maxChannels(u.plan, deps.config.selfHosted), selfHosted: deps.config.selfHosted, ...(connected ? { connected } : {}) }));
  });

  app.post('/channels/:id/check', async (c) => {
    const s = await readSession(c, deps);
    if (!s) return c.redirect('/auth/google/start', 302);
    const ch = await ownChannel(deps, c.req.param('id'), s.userId);
    if (!ch) return notFound(c);
    await checkChannel(deps, ch);
    return c.redirect('/account', 302);
  });

  app.post('/channels/:id/remove', async (c) => {
    const s = await readSession(c, deps);
    if (!s) return c.redirect('/auth/google/start', 302);
    const ch = await ownChannel(deps, c.req.param('id'), s.userId);
    if (!ch) return notFound(c);
    await revokeAndDelete(deps, ch);
    return c.redirect('/account', 302);
  });

  app.get('/api/me', async (c) => {
    const s = await readSession(c, deps);
    const u = s && (await user(deps, s.userId));
    if (!u) return c.json({ error: 'signed_out' }, 401);
    const max = maxChannels(u.plan, deps.config.selfHosted);
    return c.json({ id: u.id, email: u.email, name: u.name, plan: u.plan, maxChannels: Number.isFinite(max) ? max : null });
  });

  app.get('/api/channels', async (c) => {
    const s = await readSession(c, deps);
    if (!s) return c.json({ error: 'signed_out' }, 401);
    return c.json(
      (await channelsOf(deps, s.userId)).map((ch) => ({
        id: ch.id, platform: ch.platform, channelId: ch.channel_id, title: ch.title, handle: ch.handle, avatarUrl: ch.avatar_url,
        status: ch.status, statusReason: ch.status_reason, connectedAt: ch.connected_at, lastVerifiedAt: ch.last_verified_at,
      })),
    );
  });

  app.get('/account/export', async (c) => {
    const s = await readSession(c, deps);
    const u = s && (await user(deps, s.userId));
    if (!u) return c.redirect('/auth/google/start', 302);
    const body = {
      exportedAt: new Date(deps.now()).toISOString(),
      user: { email: u.email, name: u.name, plan: u.plan, createdAt: u.created_at },
      channels: (await channelsOf(deps, u.id)).map((ch) => ({
        platform: ch.platform, channelId: ch.channel_id, title: ch.title, handle: ch.handle, status: ch.status, statusReason: ch.status_reason,
        connectedAt: ch.connected_at, lastVerifiedAt: ch.last_verified_at, permissions: ch.scopes.split(' '),
      })),
    };
    c.header('content-disposition', 'attachment; filename="viewproof-export.json"');
    return c.json(body);
  });

  app.post('/account/delete', async (c) => {
    const s = await readSession(c, deps);
    if (!s) return c.redirect('/auth/google/start', 302);
    if (String((await c.req.parseBody()).confirm ?? '').trim().toLowerCase() !== 'delete') {
      c.status(400);
      return c.html(Message({ title: 'Not deleted', text: 'Type "delete" to confirm.', action: { href: '/account', label: 'Back to your account' } }));
    }
    // Give back Google access first, then remove everything; rows cascade from users.
    for (const ch of await channelsOf(deps, s.userId)) {
      await deps.google.revoke(await decryptSecret(ch.refresh_token_enc, deps.config.tokenKey));
    }
    const pending = (await deps.db.prepare('SELECT * FROM pending_connections WHERE user_id = ?').bind(s.userId).all<PendingConnectionRow>()).results;
    for (const p of pending) {
      try {
        await deps.google.revoke(await decryptSecret(p.refresh_token_enc, deps.config.tokenKey));
      } catch {
        // unreadable pending token: nothing to revoke
      }
    }
    await clearSession(c, deps);
    await deps.db.batch([
      deps.db.prepare('DELETE FROM pending_connections WHERE user_id = ?').bind(s.userId),
      deps.db.prepare('DELETE FROM channels WHERE user_id = ?').bind(s.userId),
      deps.db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(s.userId),
      deps.db.prepare('DELETE FROM users WHERE id = ?').bind(s.userId),
    ]);
    return c.html(Message({ title: 'Account deleted', text: 'Your account and all its data were deleted.', action: { href: '/', label: 'Home' } }));
  });
}
