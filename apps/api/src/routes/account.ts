import { tokensOf } from '../mcp/tokens';
import type { ChannelRow, PendingConnectionRow, UserRow } from '@viewproof/db';
import type { Context, Hono } from 'hono';
import type { Deps } from '../app';
import { poolBrowsersOf } from '../pool/routes';
import { REVOKED_REASON, UNREADABLE_REASON } from '../channel-data';
import { releaseGrant, tryDecrypt } from '../grants';
import { SCOPES } from '../google';
import { limitOf, maxChannels } from '../plans';
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

  const stored = await tryDecrypt(deps, ch.refresh_token_enc);
  if (!stored) return void (await set('reconnect', UNREADABLE_REASON, true));
  const token = await deps.google.refresh(stored);
  if ('kind' in token) {
    return void (await (token.kind === 'revoked'
      ? set('reconnect', REVOKED_REASON, true)
      : set(ch.status, `Check failed: ${token.reason}`, false)));
  }
  const list = await deps.google.myChannels(token.accessToken);
  if ('kind' in list) {
    return void (await (list.kind === 'revoked'
      ? set('reconnect', REVOKED_REASON, true)
      : set(ch.status, `Check failed: ${list.reason}`, false)));
  }
  const now = list.find((x) => x.channelId === ch.channel_id);
  if (!now) return void (await set('gone', 'YouTube no longer returns this channel', true));
  await deps.db
    .prepare("UPDATE channels SET status = 'active', status_reason = NULL, title = ?, handle = ?, avatar_url = ?, last_verified_at = ? WHERE id = ?")
    .bind(now.title, now.handle, now.avatarUrl, new Date(deps.now()).toISOString(), ch.id)
    .run();
}

/** Delete a channel and revoke its access. Returns false when the stored token couldn't be read (revoke by hand). */
export async function revokeAndDelete(deps: Deps, ch: ChannelRow): Promise<boolean> {
  const token = await tryDecrypt(deps, ch.refresh_token_enc);
  await deps.db.batch([
    deps.db.prepare('DELETE FROM report_cache WHERE channel_id = ?').bind(ch.id),
    deps.db.prepare('DELETE FROM channels WHERE id = ?').bind(ch.id),
  ]);
  if (token) await deps.google.revoke(token);
  return token !== null;
}

export function accountRoutes(app: Hono, deps: Deps): void {
  app.get('/account', async (c) => {
    const s = await readSession(c, deps);
    const u = s && (await user(deps, s.userId));
    if (!u) return c.redirect('/auth/google/start', 302);
    const connected = c.req.query('connected');
    const byHand = c.req.query('note') === 'revoke-by-hand';
    return c.html(Account({ user: u, channels: await channelsOf(deps, u.id), max: maxChannels(u.plan, deps.config.selfHosted), selfHosted: deps.config.selfHosted, byHand, ...(connected ? { connected } : {}) }));
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
    return c.redirect((await revokeAndDelete(deps, ch)) ? '/account' : '/account?note=revoke-by-hand', 302);
  });

  app.get('/api/me', async (c) => {
    const s = await readSession(c, deps);
    const u = s && (await user(deps, s.userId));
    if (!u) return c.json({ error: 'signed_out' }, 401);
    const max = maxChannels(u.plan, deps.config.selfHosted);
    return c.json({ id: u.id, email: u.email, name: u.name, plan: u.plan, maxChannels: Number.isFinite(max) ? max : null, maxCompetitors: limitOf(u.plan, deps.config.selfHosted, 'competitors') });
  });

  app.get('/api/channels', async (c) => {
    const s = await readSession(c, deps);
    if (!s) return c.json({ error: 'signed_out' }, 401);
    return c.json(
      (await channelsOf(deps, s.userId)).map((ch) => ({
        id: ch.id, platform: ch.platform, channelId: ch.channel_id, title: ch.title, handle: ch.handle, avatarUrl: ch.avatar_url,
        status: ch.status, statusReason: ch.status_reason, connectedAt: ch.connected_at, lastVerifiedAt: ch.last_verified_at,
        revenueAccess: ch.scopes.split(' ').includes(SCOPES.revenue),
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
      pendingConnections: (await deps.db.prepare('SELECT * FROM pending_connections WHERE user_id = ?').bind(u.id).all<PendingConnectionRow>()).results.map((p) => ({
        channelId: p.channel_id, title: p.title, handle: p.handle, permissions: p.scopes.split(' '), createdAt: p.created_at,
      })),
      competitors: (await deps.db.prepare('SELECT t.channel_id, t.title, u.added_at FROM user_competitors u JOIN tracked_channels t USING (channel_id) WHERE u.user_id = ? ORDER BY u.added_at').bind(u.id).all<{ channel_id: string; title: string; added_at: string }>()).results.map((x) => ({
        channelId: x.channel_id, title: x.title, addedAt: x.added_at,
      })),
      linkedBrowsers: (await poolBrowsersOf(deps, u.id)).map((b) => ({ label: b.label, createdAt: b.createdAt, lastUsedAt: b.lastUsedAt, acceptedTotal: b.acceptedTotal, status: b.status })),
      keywordLookups: (await deps.db.prepare('SELECT day, count FROM keyword_lookups WHERE user_id = ? ORDER BY day').bind(u.id).all<{ day: string; count: number }>()).results,
      usageCounts: (await deps.db.prepare('SELECT kind, period, count FROM usage_counts WHERE user_id = ? ORDER BY period, kind').bind(u.id).all<{ kind: string; period: string; count: number }>()).results,
      outlierSearches: (await deps.db.prepare('SELECT day, query FROM outlier_searches WHERE user_id = ? ORDER BY day').bind(u.id).all<{ day: string; query: string }>()).results,
      ai: await (async () => {
        const k = await deps.db.prepare('SELECT provider, quick_model, coach_model, key_hint FROM ai_keys WHERE user_id = ?').bind(u.id).first<{ provider: string; quick_model: string; coach_model: string; key_hint: string }>();
        return k ? { provider: k.provider, quickModel: k.quick_model, coachModel: k.coach_model, keyHint: k.key_hint } : null;
      })(),
      aiUsage: (await deps.db.prepare('SELECT month, quick, coach FROM ai_usage WHERE user_id = ? ORDER BY month').bind(u.id).all<{ month: string; quick: number; coach: number }>()).results,
      mcpTokens: (await tokensOf(deps, u.id)).map((t) => ({ label: t.label, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt })),
      mcpCalls: (await deps.db.prepare('SELECT day, count FROM mcp_calls WHERE user_id = ? ORDER BY day').bind(u.id).all<{ day: string; count: number }>()).results,
      sessions: (await deps.db.prepare('SELECT created_at, expires_at FROM sessions WHERE user_id = ? ORDER BY created_at').bind(u.id).all<{ created_at: string; expires_at: string }>()).results.map((x) => ({
        createdAt: x.created_at, expiresAt: x.expires_at,
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
    // Read every stored token first, remove all rows in one transaction, then give back Google access.
    const channels = await channelsOf(deps, s.userId);
    const pending = (await deps.db.prepare('SELECT * FROM pending_connections WHERE user_id = ?').bind(s.userId).all<PendingConnectionRow>()).results;
    const channelTokens = await Promise.all(channels.map((ch) => tryDecrypt(deps, ch.refresh_token_enc)));
    const pendingTokens = await Promise.all(pending.map((p) => tryDecrypt(deps, p.refresh_token_enc)));
    await clearSession(c, deps);
    await deps.db.batch([
      deps.db.prepare('DELETE FROM report_cache WHERE channel_id IN (SELECT id FROM channels WHERE user_id = ?)').bind(s.userId),
      deps.db.prepare('DELETE FROM oauth_states WHERE user_id = ?').bind(s.userId),
      deps.db.prepare('DELETE FROM pending_connections WHERE user_id = ?').bind(s.userId),
      deps.db.prepare('DELETE FROM channels WHERE user_id = ?').bind(s.userId),
      deps.db.prepare('DELETE FROM user_competitors WHERE user_id = ?').bind(s.userId),
      deps.db.prepare('DELETE FROM keyword_lookups WHERE user_id = ?').bind(s.userId),
      deps.db.prepare('DELETE FROM competitor_lookups WHERE user_id = ?').bind(s.userId),
      deps.db.prepare('DELETE FROM pool_tokens WHERE user_id = ?').bind(s.userId),
      deps.db.prepare('DELETE FROM ai_keys WHERE user_id = ?').bind(s.userId),
      deps.db.prepare('DELETE FROM ai_usage WHERE user_id = ?').bind(s.userId),
      deps.db.prepare('DELETE FROM mcp_tokens WHERE user_id = ?').bind(s.userId),
      deps.db.prepare('DELETE FROM mcp_calls WHERE user_id = ?').bind(s.userId),
      deps.db.prepare('DELETE FROM usage_counts WHERE user_id = ?').bind(s.userId),
      deps.db.prepare('DELETE FROM outlier_searches WHERE user_id = ?').bind(s.userId),
      deps.db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(s.userId),
      deps.db.prepare('DELETE FROM users WHERE id = ?').bind(s.userId),
    ]);
    for (const t of channelTokens) if (t) await deps.google.revoke(t);
    for (const [i, t] of pendingTokens.entries()) if (t) await releaseGrant(deps, t, pending[i]!.channel_id);
    const unreadable = [...channelTokens, ...pendingTokens].some((t) => t === null);
    return c.html(Message({
      title: 'Account deleted', text: 'Your account and all its data were deleted.', action: { href: '/', label: 'Home' },
      ...(unreadable ? { detail: "Some stored Google access couldn't be read, so please remove ViewProof by hand at myaccount.google.com/connections." } : {}),
    }));
  });
}
