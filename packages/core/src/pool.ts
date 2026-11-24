import type { SearchResult } from './keywords';
import type { WatchVideo } from './player';
import type { Format } from './types';

/** One public fact set about a video, as seen on a YouTube page by an opted-in browser (spec §6 S2). */
export interface PoolObservation {
  videoId: string;
  channelId: string;
  title: string;
  views: number;
  /** Exact upload time (watch pages); null when only an age is shown. */
  publishedAt: string | null;
  /** Upload age in days from YouTube's rounded label (search pages). */
  ageDays: number | null;
  durationSec: number | null;
  format: Format;
  source: 'watch' | 'search';
  observedAt: string;
}
/**
 * What each field of a pool upload is, in the words the privacy page uses. Keyed by every PoolObservation field, so a
 * field added to uploads without a description here does not compile (and the page can't silently leave it out).
 */
export const POOL_FIELD_LABELS: Record<keyof PoolObservation, string> = {
  videoId: 'video id',
  channelId: 'channel id',
  title: 'title',
  views: 'view count',
  publishedAt: 'upload time',
  ageDays: 'upload age in days',
  durationSec: 'length',
  format: 'whether it is a Short',
  source: 'whether it was seen on a watch page or in search results',
  observedAt: 'when it was seen',
};
export interface PoolBatch { v: 1; observations: PoolObservation[] }

export const MAX_BATCH = 300;
const MAX_VIEWS = 2e10;
const MAX_AGE_MS = 7 * 86_400_000;
const SKEW_MS = 5 * 60_000;
const MAX_DROP = 0.01;
const MAX_GROWTH_PER_HOUR = 1_000_000;
const HOUR_MS = 3_600_000;

const VIDEO_ID = /^[\w-]{11}$/;
const CHANNEL_ID = /^UC[\w-]{22}$/;
const FORMATS: readonly Format[] = ['long', 'short', 'unknown'];
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
const isIso = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(x) && Number.isFinite(Date.parse(x));

/** First problem with one item, as "field: reason"; null when valid. */
function problem(x: unknown, now: number): string | null {
  if (!x || typeof x !== 'object') return 'item: not an object';
  const o = x as Record<string, unknown>;
  if (typeof o.videoId !== 'string' || !VIDEO_ID.test(o.videoId)) return 'videoId: not a YouTube video id';
  if (typeof o.channelId !== 'string' || !CHANNEL_ID.test(o.channelId)) return 'channelId: not a YouTube channel id';
  if (typeof o.title !== 'string' || o.title.trim() === '' || o.title.length > 200) return 'title: empty or longer than 200 characters';
  if (!isInt(o.views) || o.views < 0 || o.views > MAX_VIEWS) return 'views: not a whole number between 0 and 20 billion';
  if (o.publishedAt !== null && (!isIso(o.publishedAt) || Date.parse(o.publishedAt) > now + SKEW_MS)) return 'publishedAt: not a past ISO time';
  if (o.ageDays !== null && (!isInt(o.ageDays) || o.ageDays < 0 || o.ageDays > 30_000)) return 'ageDays: not a whole number of days';
  if (o.durationSec !== null && (!isInt(o.durationSec) || o.durationSec < 0 || o.durationSec > 7 * 86_400)) return 'durationSec: not a length in seconds';
  if (!FORMATS.includes(o.format as Format)) return 'format: not long, short or unknown';
  if (o.source !== 'watch' && o.source !== 'search') return 'source: not watch or search';
  if (!isIso(o.observedAt) || Date.parse(o.observedAt) > now + SKEW_MS || now - Date.parse(o.observedAt) > MAX_AGE_MS) return 'observedAt: not within the last 7 days';
  return null;
}

/** Validate a contributed batch: unreadable batches fail whole; bad items are listed with a reason. */
export function parseBatch(x: unknown, nowIso: string):
  { ok: true; items: PoolObservation[]; rejected: { index: number; reason: string }[] } | { ok: false; reason: string } {
  const b = x as { v?: unknown; observations?: unknown } | null;
  if (!b || typeof b !== 'object' || b.v !== 1 || !Array.isArray(b.observations)) return { ok: false, reason: 'Expected { v: 1, observations: [...] }' };
  if (b.observations.length > MAX_BATCH) return { ok: false, reason: `At most ${MAX_BATCH} observations per batch` };
  const now = Date.parse(nowIso);
  const items: PoolObservation[] = [];
  const rejected: { index: number; reason: string }[] = [];
  b.observations.forEach((o, index) => {
    const p = problem(o, now);
    if (p) rejected.push({ index, reason: p });
    else {
      const v = o as PoolObservation;
      items.push({ videoId: v.videoId, channelId: v.channelId, title: v.title.trim(), views: v.views, publishedAt: v.publishedAt, ageDays: v.ageDays, durationSec: v.durationSec, format: v.format, source: v.source, observedAt: v.observedAt });
    }
  });
  return { ok: true, items, rejected };
}

/** D6: a count never falls more than 1 % and never grows faster than 1 M/hour (+10 %) between accepted observations. */
export function plausible(prev: { views: number; at: string } | null, next: { views: number; at: string }): string | null {
  if (!prev) return null;
  if (next.views < prev.views * (1 - MAX_DROP)) return `views fell from ${prev.views} to ${next.views}`;
  const hours = Math.max((Date.parse(next.at) - Date.parse(prev.at)) / HOUR_MS, 1);
  const perHour = (next.views - prev.views) / hours;
  if (next.views > prev.views * 1.1 && perHour > MAX_GROWTH_PER_HOUR) return `views grew implausibly fast (${Math.round(perHour)} per hour)`;
  return null;
}

/** A watch page's facts; null for live or upcoming videos and hidden counts. */
export function fromWatch(v: WatchVideo, nowIso: string): PoolObservation | null {
  if (v.isLive || v.isUpcoming || v.views === null) return null;
  return { videoId: v.videoId, channelId: v.channelId, title: v.title, views: v.views, publishedAt: v.publishedAt, ageDays: null, durationSec: v.lengthSeconds, format: v.format, source: 'watch', observedAt: nowIso };
}

/** A search result's facts; null without a view count or channel id, or when live. Format is left to the channel's feed. */
export function fromSearch(r: SearchResult, nowIso: string): PoolObservation | null {
  if (r.live || r.views.kind !== 'value' || !r.channelId || !CHANNEL_ID.test(r.channelId)) return null;
  return {
    videoId: r.videoId, channelId: r.channelId, title: r.title, views: r.views.value, publishedAt: null,
    ageDays: r.ageDays.kind === 'value' ? Math.round(r.ageDays.value) : null, durationSec: r.durationSec, format: 'unknown', source: 'search', observedAt: nowIso,
  };
}
