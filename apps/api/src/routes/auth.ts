import type { Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Deps } from '../app';
import { encryptSecret, pkcePair, randomToken } from '../crypto';
import { SCOPES } from '../google';
import { cleanup, releaseGrant } from '../grants';
import { clearSession, createSession, readSession } from '../session';
import { Message } from '../views/Message';

export const STATE_TTL_MS = 10 * 60_000;
const START_AGAIN = { href: '/auth/google/start', label: 'Start again' };
const BY_HAND = 'If you like, remove ViewProof at myaccount.google.com/connections.';

const SCOPE_NAMES: Record<string, string> = {
  [SCOPES.channel[0]]: 'YouTube channel (view only)',
  [SCOPES.channel[1]]: 'YouTube analytics',
};

/** Browser binding for the sign-in: the callback must come from the browser that started it. */
export const stateCookie = (deps: Pick<Deps, 'config'>) => (deps.config.secureCookies ? '__Host-vp_oauth' : 'vp_oauth');

function problem(c: Context, title: string, text: string, status: 200 | 400 | 409 = 400, detail?: string) {
  c.status(status);
  return c.html(Message({ title, text, action: START_AGAIN, ...(detail ? { detail } : {}) }));
}
const expired = (c: Context) => problem(c, 'Link expired', 'This link has expired. Please start again.');

/** Only short Google error codes are echoed; anything else could be text an attacker put in the link. */
const errorText = (e: string) => (/^[a-z_]{1,40}$/.test(e) ? e : 'unknown error');

export function authRoutes(app: Hono, deps: Deps): void {
  app.get('/auth/google/start', async (c) => {
    await cleanup(deps);
    const session = await readSession(c, deps);
    const state = randomToken();
    const { verifier, challenge } = await pkcePair();
    const wantRevenue = c.req.query('revenue') === '1';
    const chooseAccount = c.req.query('choose') === '1';
    // Only a plain signed-out sign-in skips the permission screen; connecting always needs lasting access.
    const consent = session !== null || chooseAccount || wantRevenue || c.req.query('consent') === '1';
    await deps.db
      .prepare('INSERT INTO oauth_states (state, code_verifier, user_id, want_revenue, prompt_consent, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(state, verifier, session?.userId ?? null, wantRevenue ? 1 : 0, consent ? 1 : 0, new Date(deps.now()).toISOString())
      .run();
    setCookie(c, stateCookie(deps), state, { httpOnly: true, secure: deps.config.secureCookies, sameSite: 'Lax', path: '/', maxAge: STATE_TTL_MS / 1000 });
    return c.redirect(deps.google.authUrl({ state, challenge, wantRevenue, chooseAccount, consent }), 302);
  });

  app.get('/auth/google/callback', async (c) => {
    const state = c.req.query('state') ?? '';
    const bound = getCookie(c, stateCookie(deps));
    deleteCookie(c, stateCookie(deps), { path: '/', secure: deps.config.secureCookies });
    if (!state || bound !== state) return expired(c); // not this browser's sign-in: don't consume it

    const row = await deps.db
      .prepare('DELETE FROM oauth_states WHERE state = ? RETURNING code_verifier, user_id, want_revenue, prompt_consent, created_at')
      .bind(state)
      .first<{ code_verifier: string; user_id: string | null; want_revenue: number; prompt_consent: number; created_at: string }>();
    if (!row || deps.now() - Date.parse(row.created_at) > STATE_TTL_MS) return expired(c);
    const session = await readSession(c, deps);
    if (row.user_id && session?.userId !== row.user_id) return expired(c);

    const error = c.req.query('error');
    if (error === 'access_denied') return problem(c, 'Sign-in cancelled', 'You cancelled the Google sign-in. Nothing was connected.', 200);
    const code = c.req.query('code');
    if (error || !code) return problem(c, 'Sign-in failed', `Google sign-in failed: ${error ? errorText(error) : 'no code returned'}.`);

    const tokens = await deps.google.exchangeCode(code, row.code_verifier);
    if ('kind' in tokens) {
      return problem(c, 'Sign-in failed', `Google sign-in failed: ${tokens.kind === 'revoked' ? 'access was refused' : tokens.reason}.`);
    }

    // Learn which channel this grant is for, when we may; it decides whether revoking is safe.
    const listed = tokens.scopes.includes(SCOPES.channel[0]) ? await deps.google.myChannels(tokens.accessToken) : null;
    const channels = listed && !('kind' in listed) ? listed : null;
    const channel = channels?.[0] ?? null;
    const release = () => releaseGrant(deps, tokens.refreshToken ?? tokens.accessToken, channel?.channelId ?? null, tokens.idClaims.sub);

    const missing = SCOPES.channel.filter((s) => !tokens.scopes.includes(s));
    if (missing.length > 0) {
      const revoked = await release();
      return problem(c, 'Permission missing',
        'ViewProof needs permission to view your YouTube channel and its analytics. Please start again and keep both boxes ticked.', 400,
        `Missing: ${missing.map((s) => SCOPE_NAMES[s] ?? s).join(', ')}.${revoked || channel ? '' : ` ${BY_HAND}`}`);
    }
    if (listed && 'kind' in listed) {
      return problem(c, 'Sign-in failed', `Google sign-in failed: ${listed.kind === 'revoked' ? 'access was refused' : listed.reason}.`);
    }
    const owner = channel
      ? await deps.db.prepare('SELECT user_id FROM channels WHERE channel_id = ?').bind(channel.channelId).first<{ user_id: string }>()
      : null;

    if (!tokens.refreshToken) {
      // Google gives lasting access only with the permission screen. A returning sign-in skips it;
      // that's fine when we already hold access for this channel, or the identity has an account.
      const known = owner?.user_id ?? (!channel && !session
        ? (await deps.db.prepare('SELECT id FROM users WHERE google_sub = ?').bind(tokens.idClaims.sub).first<{ id: string }>())?.id
        : undefined);
      if (known) {
        if (session && session.userId !== known) {
          return problem(c, 'Already connected', 'This channel is already connected to another ViewProof account.', 409);
        }
        if (!session) await createSession(c, deps, known);
        return c.redirect('/account', 302);
      }
      if (!row.prompt_consent) return c.redirect(`/auth/google/start?consent=1${row.want_revenue ? '&revenue=1' : ''}`, 302);
      await release();
      return problem(c, 'Sign-in incomplete', "Google didn't give us lasting access. Please start again.");
    }
    const enc = await encryptSecret(tokens.refreshToken, deps.config.tokenKey);
    const nowIso = new Date(deps.now()).toISOString();

    // Who is this? A signed-in browser stays who it is. Signed out: the channel's owner, else the Google identity.
    let userId = session?.userId ?? null;
    const signingIn = userId === null;
    if (!userId) {
      userId = owner?.user_id ?? (await deps.db.prepare('SELECT id FROM users WHERE google_sub = ?').bind(tokens.idClaims.sub).first<{ id: string }>())?.id ?? null;
      if (!userId && !channel) {
        await deps.google.revoke(tokens.refreshToken); // no channel, no account: nothing can depend on this grant
        return problem(c, 'No channel', 'This Google account has no YouTube channel. Pick the account that owns your channel.');
      }
      if (!userId) {
        userId = randomToken(16);
        await deps.db
          .prepare('INSERT INTO users (id, google_sub, email, name, created_at) VALUES (?, ?, ?, ?, ?)')
          .bind(userId, tokens.idClaims.sub, tokens.idClaims.email ?? null, tokens.idClaims.name ?? null, nowIso)
          .run();
      }
      await createSession(c, deps, userId);
    }

    if (!channel) {
      await deps.google.revoke(tokens.refreshToken);
      if (signingIn) return c.redirect('/account', 302);
      return problem(c, 'No channel', 'This Google account has no YouTube channel. Pick the account that owns your channel.');
    }

    if (owner && owner.user_id !== userId) {
      return problem(c, 'Already connected', 'This channel is already connected to another ViewProof account.', 409);
    }
    if (owner) {
      // Their own channel again: refresh its access, no confirmation needed.
      await deps.db
        .prepare("UPDATE channels SET title = ?, handle = ?, avatar_url = ?, scopes = ?, refresh_token_enc = ?, status = 'active', status_reason = NULL, last_verified_at = ? WHERE channel_id = ?")
        .bind(channel.title, channel.handle, channel.avatarUrl, tokens.scopes.join(' '), enc, nowIso, channel.channelId)
        .run();
      return c.redirect(`/account?connected=${encodeURIComponent(channel.channelId)}`, 302);
    }

    const pendingId = randomToken(16);
    await deps.db
      .prepare('INSERT INTO pending_connections (id, user_id, channel_id, title, handle, avatar_url, subscriber_count, video_count, scopes, refresh_token_enc, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(pendingId, userId, channel.channelId, channel.title, channel.handle, channel.avatarUrl, channel.subscriberCount, channel.videoCount, tokens.scopes.join(' '), enc, nowIso)
      .run();
    return c.redirect(`/connect/confirm?id=${pendingId}`, 302);
  });

  app.post('/auth/logout', async (c) => {
    await clearSession(c, deps);
    return c.redirect('/', 302);
  });
}
