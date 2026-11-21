import type { GoogleClient } from './google';

type Refreshed = Awaited<ReturnType<GoogleClient['refresh']>>;
export type TokenStore = Map<string, { at: number; p: Promise<Refreshed> }>;

/** Google access tokens last an hour; reuse one for 45 minutes. */
const KEEP_MS = 45 * 60_000;

/**
 * Wraps a Google client so each refresh token is exchanged at most once per 45 minutes
 * (concurrent callers share the same call). Failures are not kept. The store lives as long
 * as the Worker isolate, so tabs opened together renew Google access once.
 */
export function memoizeRefresh(google: GoogleClient, store: TokenStore, now: () => number): GoogleClient {
  return {
    ...google,
    refresh(refreshToken) {
      const t = now();
      for (const [k, v] of store) if (t - v.at >= KEEP_MS) store.delete(k);
      const hit = store.get(refreshToken);
      if (hit) return hit.p;
      const p = google.refresh(refreshToken).then((r) => {
        if ('kind' in r) store.delete(refreshToken);
        return r;
      });
      store.set(refreshToken, { at: t, p });
      return p;
    },
  };
}
