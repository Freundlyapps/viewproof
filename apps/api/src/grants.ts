import type { PendingConnectionRow } from '@viewproof/db';
import type { Deps } from './app';
import { decryptSecret } from './crypto';

/**
 * Google's revoke ends ViewProof's whole grant for that Google identity, which also kills any
 * stored connection made with it. So we only revoke when no connected channel can depend on it.
 */

/** Decrypt a stored token, or null when it can't be read (e.g. TOKEN_KEY changed). */
export async function tryDecrypt(deps: Deps, box: string): Promise<string | null> {
  try {
    return await decryptSecret(box, deps.config.tokenKey);
  } catch {
    return null;
  }
}

export async function isConnected(deps: Deps, channelId: string): Promise<boolean> {
  return (await deps.db.prepare('SELECT 1 AS x FROM channels WHERE channel_id = ?').bind(channelId).first()) !== null;
}

/**
 * Revoke a fresh grant we won't keep — unless a connection may depend on it: its channel is connected
 * (anyone's), or, when the channel is unknown, the Google identity already has a ViewProof account.
 */
export async function releaseGrant(deps: Deps, token: string, channelId: string | null, sub?: string): Promise<boolean> {
  if (channelId !== null) {
    if (await isConnected(deps, channelId)) return false;
  } else if (!sub || (await deps.db.prepare('SELECT 1 AS x FROM users WHERE google_sub = ?').bind(sub).first()) !== null) {
    return false;
  }
  await deps.google.revoke(token);
  return true;
}

/** Drop a pending connection, revoking its grant when safe. */
export async function discardPending(deps: Deps, p: PendingConnectionRow): Promise<void> {
  const token = await tryDecrypt(deps, p.refresh_token_enc);
  if (token) await releaseGrant(deps, token, p.channel_id);
  await deps.db.prepare('DELETE FROM pending_connections WHERE id = ?').bind(p.id).run();
}

const PENDING_TTL_MS = 60 * 60_000;
const STATE_TTL_MS = 10 * 60_000;

/** Housekeeping on each sign-in start: bounded, so it never slows a request much. */
export async function cleanup(deps: Deps): Promise<void> {
  const now = deps.now();
  await deps.db.prepare('DELETE FROM oauth_states WHERE created_at < ?').bind(new Date(now - STATE_TTL_MS).toISOString()).run();
  const stale = (
    await deps.db.prepare('SELECT * FROM pending_connections WHERE created_at < ? LIMIT 20').bind(new Date(now - PENDING_TTL_MS).toISOString()).all<PendingConnectionRow>()
  ).results;
  for (const p of stale) await discardPending(deps, p);
}
