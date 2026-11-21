import type { Context, Hono } from 'hono';
import type { Deps } from '../app';
import { encryptSecret, pkcePair, randomToken } from '../crypto';
import { SCOPES } from '../google';
import { clearSession, createSession, readSession } from '../session';
import { Message } from '../views/Message';

export const STATE_TTL_MS = 10 * 60_000;
const PENDING_TTL_MS = 60 * 60_000;
const START_AGAIN = { href: '/auth/google/start', label: 'Start again' };

const SCOPE_NAMES: Record<string, string> = {
  [SCOPES.channel[0]]: 'YouTube channel (view only)',
  [SCOPES.channel[1]]: 'YouTube analytics',
};

function problem(c: Context, title: string, text: string, status: 200 | 400 = 400, detail?: string) {
  c.status(status);
  return c.html(Message({ title, text, action: START_AGAIN, ...(detail ? { detail } : {}) }));
}

export function authRoutes(app: Hono, deps: Deps): void {
  app.get('/auth/google/start', async (c) => {
    const session = await readSession(c, deps);
    const state = randomToken();
    const { verifier, challenge } = await pkcePair();
    const wantRevenue = c.req.query('revenue') === '1';
    await deps.db
      .prepare('INSERT INTO oauth_states (state, code_verifier, user_id, want_revenue, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(state, verifier, session?.userId ?? null, wantRevenue ? 1 : 0, new Date(deps.now()).toISOString())
      .run();
    return c.redirect(deps.google.authUrl({ state, challenge, wantRevenue, chooseAccount: c.req.query('choose') === '1' }), 302);
  });

  app.get('/auth/google/callback', async (c) => {
    const state = c.req.query('state') ?? '';
    // Single use: the state row is removed whatever happens next.
    const row = await deps.db
      .prepare('DELETE FROM oauth_states WHERE state = ? RETURNING code_verifier, user_id, created_at')
      .bind(state)
      .first<{ code_verifier: string; user_id: string | null; created_at: string }>();
    if (!row || deps.now() - Date.parse(row.created_at) > STATE_TTL_MS) {
      return problem(c, 'Link expired', 'This link has expired. Please start again.');
    }

    const error = c.req.query('error');
    if (error === 'access_denied') return problem(c, 'Sign-in cancelled', 'You cancelled the Google sign-in. Nothing was connected.', 200);
    const code = c.req.query('code');
    if (error || !code) return problem(c, 'Sign-in failed', `Google sign-in failed: ${error ?? 'no code returned'}.`);

    const tokens = await deps.google.exchangeCode(code, row.code_verifier);
    if ('kind' in tokens) {
      return problem(c, 'Sign-in failed', `Google sign-in failed: ${tokens.kind === 'revoked' ? 'access was refused' : tokens.reason}.`);
    }
    const revokeAll = () => deps.google.revoke(tokens.refreshToken ?? tokens.accessToken);

    const missing = SCOPES.channel.filter((s) => !tokens.scopes.includes(s));
    if (missing.length > 0) {
      await revokeAll();
      return problem(
        c,
        'Permission missing',
        'ViewProof needs permission to view your YouTube channel and its analytics. Please start again and keep both boxes ticked.',
        400,
        `Missing: ${missing.map((s) => SCOPE_NAMES[s] ?? s).join(', ')}.`,
      );
    }
    if (!tokens.refreshToken) {
      await revokeAll();
      return problem(c, 'Sign-in incomplete', "Google didn't give us lasting access. Please start again.");
    }

    const channels = await deps.google.myChannels(tokens.accessToken);
    if ('kind' in channels) {
      await revokeAll();
      return problem(c, 'Sign-in failed', `Google sign-in failed: ${channels.kind === 'revoked' ? 'access was refused' : channels.reason}.`);
    }
    const channel = channels[0];
    if (!channel) {
      await revokeAll();
      return problem(c, 'No channel', 'This Google account has no YouTube channel. Pick the account that owns your channel.');
    }

    const nowIso = new Date(deps.now()).toISOString();
    let userId = row.user_id;
    if (!userId) {
      const { sub, email, name } = tokens.idClaims;
      const existing = await deps.db.prepare('SELECT id FROM users WHERE google_sub = ?').bind(sub).first<{ id: string }>();
      userId = existing?.id ?? randomToken(16);
      if (existing) {
        await deps.db.prepare('UPDATE users SET email = ?, name = ? WHERE id = ?').bind(email ?? null, name ?? null, userId).run();
      } else {
        await deps.db
          .prepare('INSERT INTO users (id, google_sub, email, name, created_at) VALUES (?, ?, ?, ?, ?)')
          .bind(userId, sub, email ?? null, name ?? null, nowIso)
          .run();
      }
      await createSession(c, deps, userId);
    }

    const pendingId = randomToken(16);
    await deps.db.batch([
      deps.db.prepare('DELETE FROM pending_connections WHERE created_at < ?').bind(new Date(deps.now() - PENDING_TTL_MS).toISOString()),
      deps.db
        .prepare(
          'INSERT INTO pending_connections (id, user_id, channel_id, title, handle, avatar_url, subscriber_count, video_count, scopes, refresh_token_enc, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          pendingId, userId, channel.channelId, channel.title, channel.handle, channel.avatarUrl, channel.subscriberCount, channel.videoCount,
          tokens.scopes.join(' '), await encryptSecret(tokens.refreshToken, deps.config.tokenKey), nowIso,
        ),
    ]);
    return c.redirect(`/connect/confirm?id=${pendingId}`, 302);
  });

  app.post('/auth/logout', async (c) => {
    await clearSession(c, deps);
    return c.redirect('/', 302);
  });
}
