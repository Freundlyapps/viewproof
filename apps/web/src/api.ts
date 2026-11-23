import type { ApiError } from '@viewproof/core';

export interface Me { id: string; email: string | null; name: string | null; plan: string; maxChannels: number | null; maxCompetitors?: number | null }
export interface ChannelInfo {
  id: string; platform: string; channelId: string; title: string | null; handle: string | null; avatarUrl: string | null;
  status: 'active' | 'reconnect' | 'gone'; statusReason: string | null; connectedAt: string; lastVerifiedAt: string; revenueAccess: boolean;
}

export const isApiError = (x: unknown): x is ApiError => !!x && typeof x === 'object' && 'error' in x && typeof (x as ApiError).error === 'string';

/** GET a JSON endpoint of our own API; failures come back as ApiError, never thrown. */
export async function getJson<T>(path: string): Promise<T | ApiError> {
  try {
    const res = await fetch(path, { credentials: 'same-origin', headers: { accept: 'application/json' } });
    const body = (await res.json().catch(() => null)) as unknown;
    if (res.status === 401) return { error: 'signed_out', message: 'Sign in first.' };
    if (!res.ok) return isApiError(body) ? body : { error: 'google_failed', message: `Server error (HTTP ${res.status})` };
    return body as T;
  } catch (e) {
    return { error: 'google_failed', message: e instanceof Error ? e.message : 'Network error' };
  }
}

/** POST/DELETE JSON to our API. Failures come back as ApiError, never thrown; 204 → null. */
export async function sendJson<T>(method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<T | null | ApiError> {
  try {
    const res = await fetch(path, {
      method, credentials: 'same-origin',
      headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return null;
    const out = (await res.json().catch(() => null)) as unknown;
    if (res.status === 401) return { error: 'signed_out', message: 'Sign in first.' };
    if (!res.ok) return isApiError(out) ? out : { error: 'google_failed', message: `Server error (HTTP ${res.status})` };
    return out as T;
  } catch (e) {
    return { error: 'google_failed', message: e instanceof Error ? e.message : 'Network error' };
  }
}
