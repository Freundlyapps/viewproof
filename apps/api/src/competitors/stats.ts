/** YouTube Data API `channels.list` for other channels: current counts only (never stored beyond 30 days, never charted). */
export interface ChannelStats { title: string; subscribers: number | null; totalViews: number | null; videoCount: number | null }
export type StatsAuth = { key: string } | { token: string };

export interface ChannelStatsClient {
  byIds(ids: string[], auth: StatsAuth): Promise<Map<string, ChannelStats> | { error: string }>;
  /** Channel id for an @handle, null when none. */
  byHandle(handle: string, auth: StatsAuth): Promise<string | null | { error: string }>;
}

const API = 'https://www.googleapis.com/youtube/v3/channels';

export function httpChannelStats(fetchFn: typeof fetch): ChannelStatsClient {
  async function list(params: Record<string, string>, auth: StatsAuth): Promise<Record<string, any>[] | { error: string }> {
    const q = new URLSearchParams({ part: 'snippet,statistics', maxResults: '50', ...params, ...('key' in auth ? { key: auth.key } : {}) });
    try {
      const res = await fetchFn(`${API}?${q}`, { headers: 'token' in auth ? { Authorization: `Bearer ${auth.token}` } : {} });
      const body = (await res.json().catch(() => null)) as { items?: Record<string, any>[]; error?: { message?: string } } | null;
      if (!res.ok) return { error: `YouTube Data API: ${body?.error?.message ?? `HTTP ${res.status}`}` };
      return body?.items ?? [];
    } catch (e) {
      return { error: `YouTube Data API: ${e instanceof Error ? e.message : 'network error'}` };
    }
  }
  const num = (x: unknown) => (typeof x === 'string' && /^\d+$/.test(x) ? Number(x) : null);
  return {
    async byIds(ids, auth) {
      const out = new Map<string, ChannelStats>();
      for (let i = 0; i < ids.length; i += 50) {
        const items = await list({ id: ids.slice(i, i + 50).join(',') }, auth);
        if ('error' in items) return items;
        for (const it of items) {
          const st = it.statistics ?? {};
          out.set(String(it.id), {
            title: String(it.snippet?.title ?? ''),
            subscribers: st.hiddenSubscriberCount ? null : num(st.subscriberCount),
            totalViews: num(st.viewCount),
            videoCount: num(st.videoCount),
          });
        }
      }
      return out;
    },
    async byHandle(handle, auth) {
      const items = await list({ forHandle: handle }, auth);
      if ('error' in items) return items;
      return items[0]?.id ? String(items[0].id) : null;
    },
  };
}
