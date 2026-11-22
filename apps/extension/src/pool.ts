import { MAX_BATCH, type ContributeResult, type PoolObservation } from '@viewproof/core';

/** Opt-in pool contribution, kept in chrome.storage.local (spec §6 S2). Sends nothing without consent and a linked server. */
export const POOL_KEY = 'pool';
export const MAX_QUEUE = 1000;
export const MAX_LOG = 500;

export interface PoolLogEntry {
  at: string;
  sent: number;
  accepted: number;
  rejected: number;
  reasons: string[];
  /** Exactly what left this browser. */
  videos: { videoId: string; title: string; views: number; source: 'watch' | 'search' }[];
  error: string | null;
}
export interface PoolState {
  consent: boolean;
  token: string | null;
  server: string | null;
  linkedAt: string | null;
  paused: boolean;
  /** Why sending stopped (unlinked, paused), shown on the options page. */
  statusNote: string | null;
  queue: PoolObservation[];
  log: PoolLogEntry[];
}
const EMPTY: PoolState = { consent: false, token: null, server: null, linkedAt: null, paused: false, statusNote: null, queue: [], log: [] };
export type FlushResult = 'idle' | 'sent' | 'unlinked' | 'paused' | 'error';

export function poolStore(area: chrome.storage.StorageArea) {
  const get = async (): Promise<PoolState> => ({ ...EMPTY, ...(((await area.get(POOL_KEY))[POOL_KEY] as Partial<PoolState> | undefined) ?? {}) });
  const put = async (s: PoolState) => area.set({ [POOL_KEY]: s });
  const active = (s: PoolState) => s.consent && !!s.token && !!s.server && !s.paused;
  const log = (s: PoolState, e: PoolLogEntry) => [e, ...s.log].slice(0, MAX_LOG);

  return {
    get,
    async setConsent(on: boolean) {
      const s = await get();
      await put({ ...s, consent: on, queue: on ? s.queue : [] });
    },
    async link(token: string, server: string, now: number) {
      const s = await get();
      await put({ ...s, token, server, linkedAt: new Date(now).toISOString(), paused: false, statusNote: null });
    },
    async unlink() {
      const s = await get();
      await put({ ...s, token: null, server: null, linkedAt: null, paused: false, statusNote: null, queue: [] });
    },
    async clearLog() {
      await put({ ...(await get()), log: [] });
    },
    /** Queue observations (newest kept; the same video with the same count only once). Returns the queue length, 0 when inactive. */
    async enqueue(items: PoolObservation[]): Promise<number> {
      const s = await get();
      if (!active(s) || items.length === 0) return 0;
      const seen = new Set(s.queue.map((q) => `${q.videoId}:${q.views}`));
      const fresh = items.filter((i) => { const k = `${i.videoId}:${i.views}`; if (seen.has(k)) return false; seen.add(k); return true; });
      const queue = [...s.queue, ...fresh].slice(-MAX_QUEUE);
      await put({ ...s, queue });
      return queue.length;
    },
    /** Send up to one batch to the linked server. 401 unlinks, 403 pauses; network errors and 429 keep the queue. */
    async flush(fetchFn: typeof fetch, now: number): Promise<FlushResult> {
      const s = await get();
      if (!active(s) || s.queue.length === 0) return 'idle';
      const batch = s.queue.slice(0, MAX_BATCH);
      const at = new Date(now).toISOString();
      const entry = (over: Partial<PoolLogEntry>): PoolLogEntry => ({
        at, sent: batch.length, accepted: 0, rejected: 0, reasons: [], error: null,
        videos: batch.map((b) => ({ videoId: b.videoId, title: b.title, views: b.views, source: b.source })), ...over,
      });
      let res: Response;
      try {
        res = await fetchFn(`${s.server}/api/pool/contribute`, {
          method: 'POST', credentials: 'omit',
          headers: { authorization: `Bearer ${s.token}`, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ v: 1, observations: batch }),
        });
      } catch (e) {
        await put({ ...s, log: log(s, entry({ sent: 0, error: `Not sent: ${e instanceof Error ? e.message : 'network error'}` })) });
        return 'error';
      }
      const body = (await res.json().catch(() => null)) as (ContributeResult & { message?: string }) | null;
      const message = body?.message ?? `HTTP ${res.status}`;
      if (res.status === 401) {
        await put({ ...s, token: null, server: null, linkedAt: null, queue: [], statusNote: message, log: log(s, entry({ sent: 0, error: message })) });
        return 'unlinked';
      }
      if (res.status === 403) {
        await put({ ...s, paused: true, queue: [], statusNote: message, log: log(s, entry({ sent: 0, error: message })) });
        return 'paused';
      }
      if (!res.ok || !body) {
        await put({ ...s, log: log(s, entry({ sent: 0, error: message })) });
        return 'error';
      }
      const fresh = await get(); // items may have been queued while sending
      await put({ ...fresh, queue: fresh.queue.slice(batch.length), log: log(fresh, entry({ accepted: body.accepted, rejected: body.rejected, reasons: body.reasons })) });
      return 'sent';
    },
  };
}
