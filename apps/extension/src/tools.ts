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
const CHECK_PAGE = "YouTube answered with a consent or robot-check page instead of the video. The extension asks signed out, so this video's tags can't be read this way.";

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
      const saveThrottle = (pausedUntil: number | null) => deps.area.set({ [THROTTLE_KEY]: { times: recent, pausedUntil } satisfies Throttle });
      let res: Response;
      try {
        // No cookies (never the user's YouTube sign-in), and no redirects: a redirect means a consent or check page.
        res = await deps.fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, { credentials: 'omit', redirect: 'manual' });
      } catch {
        await saveThrottle(null);
        return { ok: false, reason: "Couldn't reach YouTube (network error); try again." };
      }
      if (res.type === 'opaqueredirect' || res.redirected || (res.status >= 300 && res.status < 400)) {
        await saveThrottle(null);
        return { ok: false, reason: CHECK_PAGE };
      }
      if (res.status === 429 || res.status === 403) {
        const until = now + PAUSE_MS;
        await saveThrottle(until);
        return { ok: false, reason: `YouTube refused the request (HTTP ${res.status}); paused until ${new Date(until).toISOString()}` };
      }
      await saveThrottle(null);
      if (!res.ok) return { ok: false, reason: `YouTube answered HTTP ${res.status}; try again later.` };
      const raw = extractPlayerResponse(await res.text());
      if (!raw) return { ok: false, reason: CHECK_PAGE };
      const parsed = parsePlayerResponse(raw);
      if (!parsed.ok) {
        const ps = (raw as { playabilityStatus?: { status?: unknown; reason?: unknown } }).playabilityStatus;
        if (ps && ps.status !== 'OK' && typeof ps.reason === 'string' && ps.reason) return { ok: false, reason: `YouTube says: ${ps.reason}` };
        return { ok: false, reason: `YouTube's page had no readable video data (${parsed.reason}).` };
      }
      if (parsed.value.videoId !== videoId) return { ok: false, reason: "YouTube's page was for a different video; try again." };
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

/** YouTube's transcript panel layouts: the newer view-model one (seen 2026-11) and the older renderer one. */
const LAYOUTS = [
  { segment: 'transcript-segment-view-model', time: '.ytwTranscriptSegmentViewModelTimestamp', text: '[role="text"]' },
  { segment: 'ytd-transcript-segment-renderer', time: '.segment-timestamp', text: '.segment-text' },
] as const;

/** The segments of YouTube's transcript panel as the user opened it; null when none can be read completely. */
export function readTranscriptPanel(root: ParentNode): TranscriptSegment[] | null {
  for (const l of LAYOUTS) {
    const nodes = root.querySelectorAll(l.segment);
    if (nodes.length === 0) continue;
    const out: TranscriptSegment[] = [];
    for (const n of nodes) {
      const startSec = parseTimestamp(n.querySelector(l.time)?.textContent ?? '');
      if (startSec === null) return null;
      const text = (n.querySelector(l.text)?.textContent ?? '').replace(/\s+/g, ' ').trim();
      out.push({ startSec, text });
    }
    // Times but no text at all: YouTube renamed the text element. Saving blank lines would claim a transcript.
    return out.some((x) => x.text) ? out : null;
  }
  return null;
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
 * for two checks in a row, all for the video the page was entered for. Paused from navigation start until the next reset.
 */
export function transcriptCapture() {
  let video: string | null = null;
  let baseline = '';
  let pending = '';
  let saved = '';
  return {
    /** Call when YouTube finishes a navigation, with the video now shown and what the panel holds right then. */
    reset(videoId: string | null, current: TranscriptSegment[] | null): void {
      video = videoId;
      baseline = signature(current);
      pending = '';
      saved = '';
    },
    /** Call when a navigation starts: nothing is saved until the next reset. */
    pause(): void {
      video = null;
      pending = '';
    },
    tick(videoId: string | null, current: TranscriptSegment[] | null): TranscriptSegment[] | null {
      const sig = signature(current);
      if (!videoId || videoId !== video || !current || sig === baseline || sig === saved) { pending = ''; return null; }
      if (sig !== pending) { pending = sig; return null; }
      saved = sig;
      return current;
    },
  };
}
