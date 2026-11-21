import type { YouTubeClient } from '../src/youtube';

/** Test double for the YouTube client; records calls (method + query). */
export function fakeYouTube(over: Partial<YouTubeClient> = {}): YouTubeClient & { calls: { method: string; arg: unknown }[] } {
  const calls: { method: string; arg: unknown }[] = [];
  const base: YouTubeClient = {
    report: async () => ({ columns: [], rows: [] }),
    uploads: async () => [],
  };
  const m = { ...base, ...over };
  return {
    report: (t, q) => (calls.push({ method: 'report', arg: q }), m.report(t, q)),
    uploads: (t, n) => (calls.push({ method: 'uploads', arg: n }), m.uploads(t, n)),
    calls,
  };
}
