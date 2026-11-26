import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Deps } from './app';
import { randomToken, sha256Hex } from './crypto';

export const SESSION_COOKIE = 'vp_session';
/** On https the cookie gets the __Host- prefix: Secure, Path=/, no Domain, so no subdomain can plant one. */
export const sessionCookieName = (deps: Pick<Deps, 'config'>) => (deps.config.secureCookies ? `__Host-${SESSION_COOKIE}` : SESSION_COOKIE);
export const SESSION_DAYS = 30;
const DAY_MS = 86_400_000;

/** New session: random id in an HttpOnly cookie, only its SHA-256 hash in the database. */
export async function createSession(c: Context, deps: Deps, userId: string): Promise<void> {
  const id = randomToken();
  const now = deps.now();
  await deps.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(new Date(now).toISOString()).run();
  await deps.db
    .prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(id), userId, new Date(now).toISOString(), new Date(now + SESSION_DAYS * DAY_MS).toISOString())
    .run();
  setCookie(c, sessionCookieName(deps), id, {
    httpOnly: true,
    secure: deps.config.secureCookies,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  });
}

export async function readSession(c: Context, deps: Deps): Promise<{ userId: string } | null> {
  const id = getCookie(c, sessionCookieName(deps));
  if (!id) return null;
  const hash = await sha256Hex(id);
  const row = await deps.db.prepare('SELECT user_id, expires_at FROM sessions WHERE id_hash = ?').bind(hash).first<{ user_id: string; expires_at: string }>();
  if (!row) return null;
  if (Date.parse(row.expires_at) <= deps.now()) {
    await deps.db.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(hash).run();
    return null;
  }
  return { userId: row.user_id };
}

export async function clearSession(c: Context, deps: Deps): Promise<void> {
  const id = getCookie(c, sessionCookieName(deps));
  if (id) await deps.db.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(await sha256Hex(id)).run();
  deleteCookie(c, sessionCookieName(deps), { path: '/', secure: deps.config.secureCookies });
}
