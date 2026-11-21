import type { ChannelRow, ReportCacheRow } from '@viewproof/db';
import type { Deps } from './app';
import type { GoogleError } from './google';
import { tryDecrypt } from './grants';

export type ChannelAccess = { channel: ChannelRow; accessToken: string };
export type AccessError = { error: 'reconnect' | 'gone' | 'google_failed'; message: string };

export const REVOKED_REASON = 'Google access was removed or expired';
export const UNREADABLE_REASON = "Stored access can't be read; reconnect";

export function ownedChannel(deps: Deps, userId: string, channelRowId: string): Promise<ChannelRow | null> {
  return deps.db.prepare('SELECT * FROM channels WHERE id = ? AND user_id = ?').bind(channelRowId, userId).first<ChannelRow>();
}

async function markReconnect(deps: Deps, ch: ChannelRow, reason: string): Promise<AccessError> {
  await deps.db
    .prepare("UPDATE channels SET status = 'reconnect', status_reason = ?, last_verified_at = ? WHERE id = ?")
    .bind(reason, new Date(deps.now()).toISOString(), ch.id)
    .run();
  return { error: 'reconnect', message: reason };
}

/** A fresh access token for the channel, or why there is none (and the channel's status updated to match). */
export async function accessFor(deps: Deps, ch: ChannelRow): Promise<ChannelAccess | AccessError> {
  if (ch.status === 'gone') return { error: 'gone', message: ch.status_reason ?? 'YouTube no longer returns this channel' };
  const stored = await tryDecrypt(deps, ch.refresh_token_enc);
  if (!stored) return markReconnect(deps, ch, UNREADABLE_REASON);
  const token = await deps.google.refresh(stored);
  if ('kind' in token) {
    if (token.kind === 'revoked') return markReconnect(deps, ch, REVOKED_REASON);
    return { error: 'google_failed', message: `Google sign-in service failed: ${token.reason}` };
  }
  return { channel: ch, accessToken: token.accessToken };
}

const isGoogleError = (x: unknown): x is GoogleError =>
  !!x && typeof x === 'object' && typeof (x as { kind?: unknown }).kind === 'string' && ['revoked', 'failed', 'forbidden'].includes((x as { kind: string }).kind);

/** Read-through cache in D1. Errors are returned but never stored. */
export async function cached<T>(deps: Deps, channelId: string, key: string, ttlMs: number, load: () => Promise<T | GoogleError>): Promise<T | GoogleError> {
  const row = await deps.db.prepare('SELECT * FROM report_cache WHERE channel_id = ? AND key = ?').bind(channelId, key).first<ReportCacheRow>();
  if (row && deps.now() - Date.parse(row.fetched_at) < ttlMs) return JSON.parse(row.body) as T;
  const fresh = await load();
  if (isGoogleError(fresh)) return fresh;
  await deps.db
    .prepare('INSERT INTO report_cache (channel_id, key, body, fetched_at) VALUES (?, ?, ?, ?) ON CONFLICT(channel_id, key) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at')
    .bind(channelId, key, JSON.stringify(fresh), new Date(deps.now()).toISOString())
    .run();
  return fresh;
}
