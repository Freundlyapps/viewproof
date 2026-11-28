// Sign-in for MCP chat apps (Claude, ChatGPT…): OAuth 2.1 authorization server for /mcp.
// Discovery (RFC 9728, RFC 8414), dynamic client registration (RFC 7591), authorization code + PKCE S256,
// rotating refresh tokens. Public clients only: there are no client secrets. A connection is a row in mcp_tokens.
import type { Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Deps } from '../app';
import { b64url, randomToken, sha256Hex } from '../crypto';
import { readSession } from '../session';
import { McpConsent } from '../views/McpConsent';
import { Message } from '../views/Message';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
export const CODE_TTL_MS = 10 * MIN;
export const ACCESS_TTL_S = 3600;
export const REFRESH_TTL_MS = 90 * DAY;
const UNUSED_CLIENT_TTL_MS = DAY;
/** Connected apps per user; connecting one more removes the one used longest ago. */
export const MAX_CONNECTED_APPS = 10;
const RETURN_TTL_S = 15 * 60;
const SCOPE = 'mcp';

/** Where /account sends a browser back to after signing in from the consent flow. */
export const returnCookie = (deps: Pick<Deps, 'config'>) => (deps.config.secureCookies ? '__Host-vp_mcp_return' : 'vp_mcp_return');

const resourceOf = (deps: Deps) => `${deps.config.appOrigin}/mcp`;
export const resourceMetadataUrl = (deps: Deps) => `${deps.config.appOrigin}/.well-known/oauth-protected-resource`;
const iso = (ms: number) => new Date(ms).toISOString();

/** Exact redirect URLs only: https, http on the loopback address, or an app's own scheme (cursor://…). */
export function validRedirect(u: string): boolean {
  if (u.length > 500) return false;
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) && !['javascript:', 'data:', 'file:', 'blob:', 'about:', 'vbscript:', 'ws:', 'wss:', 'ftp:'].includes(url.protocol);
}

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
const oauthError = (c: Context, error: string, description: string, status: 400 | 401 = 400) =>
  c.json({ error, error_description: description }, status, { ...cors, 'cache-control': 'no-store' });
const page = (c: Context, title: string, text: string, status: 200 | 400 = 400) => {
  c.status(status);
  return c.html(Message({ title, text }));
};

interface Client { id: string; name: string; redirect_uris: string }
const clientOf = (deps: Deps, id: string) => deps.db.prepare('SELECT id, name, redirect_uris FROM mcp_clients WHERE id = ?').bind(id).first<Client>();

/** The authorize request, checked in the order OAuth requires: errors before the redirect is trusted are shown, never redirected. */
async function checkRequest(deps: Deps, q: Record<string, string | undefined>):
  Promise<{ kind: 'page'; title: string; text: string } | { kind: 'redirect'; to: string } | { kind: 'ok'; client: Client; redirect: string; challenge: string; state: string }> {
  const client = q.client_id ? await clientOf(deps, q.client_id) : null;
  if (!client) return { kind: 'page', title: 'Unknown app', text: 'This app is not registered with ViewProof. Start connecting again from the app.' };
  const redirect = q.redirect_uri ?? '';
  if (!(JSON.parse(client.redirect_uris) as string[]).includes(redirect)) {
    return { kind: 'page', title: 'Wrong return address', text: 'The app asked to return to an address it did not register. Nothing was connected.' };
  }
  const state = q.state ?? '';
  const back = (error: string, description: string) => {
    const u = new URL(redirect);
    u.searchParams.set('error', error);
    u.searchParams.set('error_description', description);
    if (state) u.searchParams.set('state', state);
    u.searchParams.set('iss', deps.config.appOrigin);
    return { kind: 'redirect' as const, to: u.toString() };
  };
  if (q.response_type !== 'code') return back('unsupported_response_type', 'Only response_type=code is supported.');
  if (q.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(q.code_challenge ?? '')) return back('invalid_request', 'PKCE with code_challenge_method=S256 is required.');
  if (q.resource && q.resource.replace(/\/$/, '') !== resourceOf(deps) && q.resource.replace(/\/$/, '') !== deps.config.appOrigin) {
    return back('invalid_target', `The only resource here is ${resourceOf(deps)}.`);
  }
  return { kind: 'ok', client, redirect, challenge: q.code_challenge!, state };
}

/** Removes codes that expired and registrations that never connected. */
async function cleanup(deps: Deps): Promise<void> {
  const now = deps.now();
  await deps.db.prepare('DELETE FROM mcp_codes WHERE created_at < ?').bind(iso(now - CODE_TTL_MS)).run();
  await deps.db.prepare('DELETE FROM mcp_clients WHERE used_at IS NULL AND created_at < ?').bind(iso(now - UNUSED_CLIENT_TTL_MS)).run();
}

async function issue(deps: Deps, userId: string, client: Client, replaceId?: string) {
  const access = `vpm_${randomToken(32)}`;
  const refresh = `vpr_${randomToken(32)}`;
  const now = deps.now();
  if (replaceId) {
    await deps.db.prepare('UPDATE mcp_tokens SET id_hash = ?, expires_at = ?, refresh_hash = ?, refresh_expires_at = ? WHERE id = ?')
      .bind(await sha256Hex(access), iso(now + ACCESS_TTL_S * 1000), await sha256Hex(refresh), iso(now + REFRESH_TTL_MS), replaceId).run();
  } else {
    // One connection per app and user; past the limit, the connection used longest ago goes.
    await deps.db.prepare('DELETE FROM mcp_tokens WHERE user_id = ? AND client_id = ?').bind(userId, client.id).run();
    await deps.db.prepare(
      `DELETE FROM mcp_tokens WHERE id IN (SELECT id FROM mcp_tokens WHERE user_id = ? AND client_id IS NOT NULL
         ORDER BY COALESCE(last_used_at, created_at) DESC LIMIT -1 OFFSET ?)`,
    ).bind(userId, MAX_CONNECTED_APPS - 1).run();
    await deps.db.prepare(
      'INSERT INTO mcp_tokens (id, id_hash, user_id, label, created_at, client_id, expires_at, refresh_hash, refresh_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(randomToken(12), await sha256Hex(access), userId, client.name, iso(now), client.id, iso(now + ACCESS_TTL_S * 1000), await sha256Hex(refresh), iso(now + REFRESH_TTL_MS)).run();
  }
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: SCOPE };
}

export function mcpOAuthRoutes(app: Hono, deps: Deps): void {
  const protectedResource = (c: Context) => c.json({
    resource: resourceOf(deps),
    authorization_servers: [deps.config.appOrigin],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'ViewProof',
  }, 200, cors);
  app.get('/.well-known/oauth-protected-resource', protectedResource);
  app.get('/.well-known/oauth-protected-resource/mcp', protectedResource);
  const serverMetadata = (c: Context) => c.json({
    issuer: deps.config.appOrigin,
    authorization_endpoint: `${deps.config.appOrigin}/oauth/authorize`,
    token_endpoint: `${deps.config.appOrigin}/oauth/token`,
    registration_endpoint: `${deps.config.appOrigin}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [SCOPE],
    authorization_response_iss_parameter_supported: true,
  }, 200, cors);
  app.get('/.well-known/oauth-authorization-server', serverMetadata);
  app.get('/.well-known/oauth-authorization-server/mcp', serverMetadata);
  for (const p of ['/.well-known/*', '/oauth/token', '/oauth/register']) app.options(p, (c) => c.body(null, 204, cors));

  app.post('/oauth/register', async (c) => {
    await cleanup(deps);
    const body = (await c.req.json().catch(() => null)) as { redirect_uris?: unknown; client_name?: unknown } | null;
    const uris = body?.redirect_uris;
    if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10 || !uris.every((u) => typeof u === 'string' && validRedirect(u))) {
      return oauthError(c, 'invalid_redirect_uri', 'redirect_uris must list 1 to 10 exact https, loopback http or app-scheme URLs without a fragment.');
    }
    const name = typeof body!.client_name === 'string' && body!.client_name.trim() ? body!.client_name.trim().slice(0, 60) : 'AI app';
    const id = `vpc_${randomToken(16)}`;
    const now = deps.now();
    await deps.db.prepare('INSERT INTO mcp_clients (id, name, redirect_uris, created_at) VALUES (?, ?, ?, ?)').bind(id, name, JSON.stringify(uris), iso(now)).run();
    return c.json({
      client_id: id, client_id_issued_at: Math.floor(now / 1000), client_name: name, redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none',
    }, 201, { ...cors, 'cache-control': 'no-store' });
  });

  app.get('/oauth/authorize', async (c) => {
    await cleanup(deps);
    const r = await checkRequest(deps, c.req.query());
    if (r.kind === 'page') return page(c, r.title, r.text);
    if (r.kind === 'redirect') return c.redirect(r.to, 302);
    if (!(await readSession(c, deps))) {
      // Sign in first; /account sends this browser back here afterwards.
      const u = new URL(c.req.url);
      setCookie(c, returnCookie(deps), `${u.pathname}${u.search}`, { httpOnly: true, secure: deps.config.secureCookies, sameSite: 'Lax', path: '/', maxAge: RETURN_TTL_S });
      c.status(200);
      return c.html(Message({
        title: 'Sign in to ViewProof',
        text: `“${r.client.name}” wants to read your ViewProof data. Sign in first; you'll come back here to allow or cancel it.`,
        action: { href: '/auth/google/start', label: 'Sign in with Google' },
      }));
    }
    return c.html(McpConsent({ appName: r.client.name, redirectHost: new URL(r.redirect).host || r.redirect, req: { client_id: r.client.id, redirect_uri: r.redirect, code_challenge: r.challenge, state: r.state } }));
  });

  app.post('/oauth/authorize', async (c) => {
    const s = await readSession(c, deps);
    if (!s) return page(c, 'Signed out', 'You were signed out. Start connecting again from the app.');
    const f = Object.fromEntries(Object.entries(await c.req.parseBody()).map(([k, v]) => [k, typeof v === 'string' ? v : undefined]));
    const r = await checkRequest(deps, { ...f, response_type: 'code', code_challenge_method: 'S256' });
    if (r.kind === 'page') return page(c, r.title, r.text);
    if (r.kind === 'redirect') return c.redirect(r.to, 302);
    const u = new URL(r.redirect);
    if (r.state) u.searchParams.set('state', r.state);
    u.searchParams.set('iss', deps.config.appOrigin);
    if (f.decision !== 'allow') {
      u.searchParams.set('error', 'access_denied');
      return c.redirect(u.toString(), 302);
    }
    const code = randomToken(32);
    await deps.db.prepare('INSERT INTO mcp_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(await sha256Hex(code), r.client.id, s.userId, r.redirect, r.challenge, iso(deps.now())).run();
    u.searchParams.set('code', code);
    return c.redirect(u.toString(), 302);
  });

  app.post('/oauth/token', async (c) => {
    const type = c.req.header('content-type') ?? '';
    const raw = type.includes('application/json') ? ((await c.req.json().catch(() => ({}))) as Record<string, unknown>) : await c.req.parseBody();
    const f = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string) : '');
    const now = deps.now();

    if (f('grant_type') === 'authorization_code') {
      const row = await deps.db.prepare('DELETE FROM mcp_codes WHERE code_hash = ? RETURNING client_id, user_id, redirect_uri, code_challenge, created_at')
        .bind(await sha256Hex(f('code'))).first<{ client_id: string; user_id: string; redirect_uri: string; code_challenge: string; created_at: string }>();
      if (!row || now - Date.parse(row.created_at) > CODE_TTL_MS) return oauthError(c, 'invalid_grant', 'The code is unknown, used or expired.');
      if (row.client_id !== f('client_id') || row.redirect_uri !== f('redirect_uri')) return oauthError(c, 'invalid_grant', 'The code was issued to another app or return address.');
      const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(f('code_verifier')))));
      if (!f('code_verifier') || challenge !== row.code_challenge) return oauthError(c, 'invalid_grant', 'The code_verifier does not match.');
      const client = await clientOf(deps, row.client_id);
      if (!client) return oauthError(c, 'invalid_grant', 'The app is no longer registered.');
      await deps.db.prepare('UPDATE mcp_clients SET used_at = ? WHERE id = ?').bind(iso(now), client.id).run();
      return c.json(await issue(deps, row.user_id, client), 200, { ...cors, 'cache-control': 'no-store' });
    }

    if (f('grant_type') === 'refresh_token') {
      const row = await deps.db.prepare('SELECT id, user_id, client_id, refresh_expires_at FROM mcp_tokens WHERE refresh_hash = ?')
        .bind(await sha256Hex(f('refresh_token'))).first<{ id: string; user_id: string; client_id: string; refresh_expires_at: string }>();
      if (!row || Date.parse(row.refresh_expires_at) <= now) return oauthError(c, 'invalid_grant', 'The refresh token is unknown, revoked or expired. Connect again.');
      if (f('client_id') && f('client_id') !== row.client_id) return oauthError(c, 'invalid_grant', 'The refresh token belongs to another app.');
      const client = await clientOf(deps, row.client_id);
      if (!client) return oauthError(c, 'invalid_grant', 'The app is no longer registered.');
      return c.json(await issue(deps, row.user_id, client, row.id), 200, { ...cors, 'cache-control': 'no-store' });
    }

    return oauthError(c, 'unsupported_grant_type', 'Use authorization_code or refresh_token.');
  });
}

/** After signing in from the consent flow, the browser goes back to the app's request (once). */
export function takeReturn(c: Context, deps: Deps): string | null {
  const v = getCookie(c, returnCookie(deps));
  if (!v) return null;
  deleteCookie(c, returnCookie(deps), { path: '/', secure: deps.config.secureCookies });
  return v.startsWith('/oauth/authorize?') ? v : null;
}
