import { takeReturn } from '../mcp/oauth';
import { tokensOf } from '../mcp/tokens';
import { agentState } from '../agent/routes';
import type { ChannelRow, PendingConnectionRow, UserRow } from '@viewproof/db';
import type { Context, Hono } from 'hono';
import type { Deps } from '../app';
import { poolBrowsersOf } from '../pool/routes';
import { REVOKED_REASON, UNREADABLE_REASON } from '../channel-data';
import { releaseGrant, tryDecrypt } from '../grants';
import { SCOPES } from '../google';
import { limitOf, maxChannels } from '../plans';
import { LIVE_STATUSES, billingOf } from '../billing/routes';
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
    deps.db.prepare('DELETE FROM agent_changes WHERE channel_row_id = ?').bind(ch.id),
    deps.db.prepare('DELETE FROM agent_briefs WHERE channel_row_id = ?').bind(ch.id),
    deps.db.prepare('DELETE FROM channels WHERE id = ?').bind(ch.id),
  ]);
  if (token) await deps.google.revoke(token);
  return token !== null;
}

/** Cancels the stored subscription and any other live one Stripe has for this user. Null when done, else the reason. */
async function cancelAllSubscriptions(deps: Deps, userId: string): Promise<string | null> {
  const bill = await billingOf(deps, userId);
  const ids = new Set<string>();
  if (bill?.subscription_id && LIVE_STATUSES.has(bill.status ?? '')) ids.add(bill.subscription_id);
  if (deps.stripe && (bill || deps.config.billing)) {
    const found = await deps.stripe.subscriptionsOf(userId);
    if ('error' in found) return found.error;
    for (const x of found) if (LIVE_STATUSES.has(x.status)) ids.add(x.id);
  }
  if (ids.size && !deps.stripe) return 'Billing is not set up on this server, so your subscription could not be cancelled.';
  for (const id of ids) {
    const r = await deps.stripe!.cancelNow(id);
    if ('error' in r) return r.error;
  }
  return null;
}

export function accountRoutes(app: Hono, deps: Deps): void {
  app.get('/account', async (c) => {
    const s = await readSession(c, deps);
    const u = s && (await user(deps, s.userId));
    if (!u) return c.redirect('/auth/google/start', 302);
    // Signed in from an AI app's "Connect" (MCP sign-in): go back to its consent page.
    const back = takeReturn(c, deps);
    if (back) return c.redirect(back, 302);
    const connected = c.req.query('connected');
    const byHand = c.req.query('note') === 'revoke-by-hand';
    const bill = await billingOf(deps, u.id);
    const paidUntil = bill?.subscription_id && LIVE_STATUSES.has(bill.status ?? '') ? bill.cancel_at ?? bill.period_end : null;
    return c.html(Account({ user: u, channels: await channelsOf(deps, u.id), max: maxChannels(u.plan, deps.config.selfHosted), selfHosted: deps.config.selfHosted, byHand, paidUntil, ...(connected ? { connected } : {}) }));
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
      competitorLookups: (await deps.db.prepare('SELECT day, count FROM competitor_lookups WHERE user_id = ? ORDER BY day').bind(u.id).all<{ day: string; count: number }>()).results,
      poolSuspension: await deps.db.prepare('SELECT until FROM pool_suspensions WHERE user_id = ?').bind(u.id).first<{ until: string }>(),
      keywordLookups: (await deps.db.prepare('SELECT day, count FROM keyword_lookups WHERE user_id = ? ORDER BY day').bind(u.id).all<{ day: string; count: number }>()).results,
      billing: await (async () => {
        const b = await billingOf(deps, u.id);
        return b ? { status: b.status, periodEnd: b.period_end, cancelAt: b.cancel_at } : null;
      })(),
      usageCounts: (await deps.db.prepare('SELECT kind, period, count FROM usage_counts WHERE user_id = ? ORDER BY period, kind').bind(u.id).all<{ kind: string; period: string; count: number }>()).results,
      outlierSearches: (await deps.db.prepare('SELECT day, query FROM outlier_searches WHERE user_id = ? ORDER BY day').bind(u.id).all<{ day: string; query: string }>()).results,
      ai: await (async () => {
        const k = await deps.db.prepare('SELECT provider, quick_model, coach_model, key_hint FROM ai_keys WHERE user_id = ?').bind(u.id).first<{ provider: string; quick_model: string; coach_model: string; key_hint: string }>();
        return k ? { provider: k.provider, quickModel: k.quick_model, coachModel: k.coach_model, keyHint: k.key_hint } : null;
      })(),
      aiUsage: (await deps.db.prepare('SELECT month, quick, coach, brief FROM ai_usage WHERE user_id = ? ORDER BY month').bind(u.id).all<{ month: string; quick: number; coach: number; brief: number }>()).results,
      agent: await (async () => {
        const st = await agentState(deps, u.id);
        const briefs = (await deps.db.prepare('SELECT created_at, trigger, provider, model, via, input_tokens, output_tokens, ideas, dropped FROM agent_briefs WHERE user_id = ? ORDER BY created_at').bind(u.id)
          .all<{ created_at: string; trigger: string; provider: string; model: string; via: string; input_tokens: number; output_tokens: number; ideas: string; dropped: number }>()).results;
        return {
          weekly: st.settings.weekly,
          briefs: briefs.map((b) => ({ createdAt: b.created_at, trigger: b.trigger, provider: b.provider, model: b.model, via: b.via, inputTokens: b.input_tokens, outputTokens: b.output_tokens, ideas: JSON.parse(b.ideas), dropped: b.dropped })),
          // Every change, not just the 20 the page shows.
          changes: (await deps.db.prepare('SELECT video_id, before_title, proposed_title, why, status, created_at, approved_at, applied_on, applied_title, check7, check28 FROM agent_changes WHERE user_id = ? ORDER BY created_at').bind(u.id)
            .all<Record<string, string | null>>()).results.map((r) => ({ ...r, check7: r.check7 ? JSON.parse(r.check7) : null, check28: r.check28 ? JSON.parse(r.check28) : null })),
        };
      })(),
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
    // Nobody keeps paying for a deleted account: cancel every live subscription at Stripe first, or refuse.
    const refused = await cancelAllSubscriptions(deps, s.userId);
    if (refused) {
      c.status(502);
      return c.html(Message({ title: 'Not deleted', text: `We couldn't cancel your Pro subscription at Stripe (${refused}). Your account was not deleted. Try again in a few minutes.`, action: { href: '/account', label: 'Back to your account' } }));
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
      deps.db.prepare('DELETE FROM agent_changes WHERE user_id = ?').bind(s.userId),
      deps.db.prepare('DELETE FROM agent_briefs WHERE user_id = ?').bind(s.userId),
      deps.db.prepare('DELETE FROM agent_settings WHERE user_id = ?').bind(s.userId),
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
      deps.db.prepare('DELETE FROM billing WHERE user_id = ?').bind(s.userId),
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
