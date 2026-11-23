import { type TranscriptSegment, extractPlayerResponse, parsePlayerResponse, parseTimestamp } from '@viewproof/core';

export const LOOKUPS_PER_HOUR = 30;
const HOUR = 3_600_000;
const PAUSE_MS = 24 * HOUR;
const CACHE_MS = 6 * HOUR;
const CACHE_MAX = 50;
const CACHE_KEY = 'video-lookup-cache';
const THROTTLE_KEY = 'video-lookup-throttle';

export interface VideoFacts { videoId: string; title: string; channelId: string; tags: string[]; description: string; lengthSeconds: number }
export type VideoLookupResult = { ok: true; video: VideoFacts } | { ok: false; reason: string };
type Cache = Record<string, { at: number; video: VideoFacts }>;
type Throttle = { times: number[]; pausedUntil: number | null };

/**
 * Tags and description of any public video for the Tools page: the same watch page a browser opens, fetched without cookies.
 * Asked only when the user looks a video up; ≤ 30 an hour; a refusal pauses lookups for 24 h.
 */
export function videoLookup(deps: { area: chrome.storage.StorageArea; fetch: typeof fetch; now: () => number }) {
  const get = async <T>(key: string, empty: T): Promise<T> => ((await deps.area.get(key))[key] as T | undefined) ?? empty;
  return {
    async lookup(videoId: string): Promise<VideoLookupResult> {
      if (!/^[\w-]{11}$/.test(videoId)) return { ok: false, reason: 'Not a YouTube video id.' };
      const now = deps.now();
      const cache = await get<Cache>(CACHE_KEY, {});
      const hit = cache[videoId];
      if (hit && now - hit.at < CACHE_MS) return { ok: true, video: hit.video };
      const th = await get<Throttle>(THROTTLE_KEY, { times: [], pausedUntil: null });
      if (th.pausedUntil && now < th.pausedUntil) return { ok: false, reason: `YouTube refused an earlier request; paused until ${new Date(th.pausedUntil).toISOString()}` };
      const recent = th.times.filter((t) => now - t < HOUR);
      if (recent.length >= LOOKUPS_PER_HOUR) {
        const mins = Math.max(1, Math.ceil((recent[0]! + HOUR - now) / 60_000));
        return { ok: false, reason: `Lookup limit reached (${LOOKUPS_PER_HOUR} per hour); try again in ${mins} minute${mins === 1 ? '' : 's'}.` };
      }
      recent.push(now);
      let res: Response;
      try {
        res = await deps.fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, { credentials: 'omit' });
      } catch {
        await deps.area.set({ [THROTTLE_KEY]: { times: recent, pausedUntil: null } satisfies Throttle });
        return { ok: false, reason: "Couldn't reach YouTube (network error); try again." };
      }
      if (!res.ok) {
        const until = now + PAUSE_MS;
        await deps.area.set({ [THROTTLE_KEY]: { times: recent, pausedUntil: until } satisfies Throttle });
        return { ok: false, reason: `YouTube refused the request (HTTP ${res.status}); paused until ${new Date(until).toISOString()}` };
      }
      await deps.area.set({ [THROTTLE_KEY]: { times: recent, pausedUntil: null } satisfies Throttle });
      const parsed = parsePlayerResponse(extractPlayerResponse(await res.text()));
      if (!parsed.ok) {
        return { ok: false, reason: "YouTube's page had no video data (it may have shown a consent or robot check). Open the video on YouTube once, then try again." };
      }
      const v = parsed.value;
      const video: VideoFacts = { videoId: v.videoId, title: v.title, channelId: v.channelId, tags: v.tags, description: v.description, lengthSeconds: v.lengthSeconds };
      const next: Cache = {};
      for (const [k, e] of Object.entries(cache).sort((a, b) => b[1].at - a[1].at).slice(0, CACHE_MAX - 1)) if (now - e.at < CACHE_MS) next[k] = e;
      next[videoId] = { at: now, video };
      await deps.area.set({ [CACHE_KEY]: next });
      return { ok: true, video };
    },
  };
}

/** The segments of YouTube's transcript panel as the user opened it; null when none can be read completely. */
export function readTranscriptPanel(root: ParentNode): TranscriptSegment[] | null {
  const nodes = root.querySelectorAll('ytd-transcript-segment-renderer');
  if (nodes.length === 0) return null;
  const out: TranscriptSegment[] = [];
  for (const n of nodes) {
    const startSec = parseTimestamp(n.querySelector('.segment-timestamp')?.textContent ?? '');
    if (startSec === null) return null;
    const text = (n.querySelector('.segment-text')?.textContent ?? '').replace(/\s+/g, ' ').trim();
    out.push({ startSec, text });
  }
  return out;
}

export interface StoredTranscript { videoId: string; title: string; savedAt: number; segments: TranscriptSegment[] }
const TRANSCRIPTS_KEY = 'transcripts';
const TRANSCRIPTS_MAX = 20;
const TRANSCRIPT_DAYS_MS = 30 * 24 * HOUR;

/** Transcripts the user opened on YouTube, kept only in this browser: the 20 newest, for 30 days. */
export function transcriptStore(area: chrome.storage.StorageArea) {
  const all = async () => ((await area.get(TRANSCRIPTS_KEY))[TRANSCRIPTS_KEY] as StoredTranscript[] | undefined) ?? [];
  const fresh = (list: StoredTranscript[], now: number) => list.filter((t) => now - t.savedAt < TRANSCRIPT_DAYS_MS);
  return {
    async put(t: { videoId: string; title: string; segments: TranscriptSegment[] }, now: number): Promise<void> {
      const rest = fresh(await all(), now).filter((x) => x.videoId !== t.videoId);
      await area.set({ [TRANSCRIPTS_KEY]: [{ ...t, savedAt: now }, ...rest].slice(0, TRANSCRIPTS_MAX) });
    },
    async list(now: number): Promise<StoredTranscript[]> {
      return fresh(await all(), now).sort((a, b) => b.savedAt - a.savedAt);
    },
  };
}

const signature = (s: TranscriptSegment[] | null) => (s ? `${s.length}|${s[0]?.text}|${s[s.length - 1]?.text}` : '');

/**
 * Decides when the transcript panel holds the current video's transcript, fully loaded: its content changed since the
 * page was entered (so a panel left over from the previous video is never saved under the new one) and stayed the same
 * for two checks in a row. `tick` returns the segments to save, once per video and content.
 */
export function transcriptCapture() {
  let baseline = '';
  let pending = '';
  let saved = '';
  return {
    /** Call when YouTube finishes a navigation, with what the panel holds right then. */
    reset(current: TranscriptSegment[] | null): void {
      baseline = signature(current);
      pending = '';
      saved = '';
    },
    tick(current: TranscriptSegment[] | null): TranscriptSegment[] | null {
      const sig = signature(current);
      if (!current || sig === baseline || sig === saved) { pending = ''; return null; }
      if (sig !== pending) { pending = sig; return null; }
      saved = sig;
      return current;
    },
  };
}
