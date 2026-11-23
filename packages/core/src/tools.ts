/** Helpers for the Tools page (spec 9b): pure functions on the user's own input. */

const ID = /^[\w-]{11}$/;
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);

/** A YouTube video id from a watch / youtu.be / shorts / embed / live link, or a bare 11-character id. */
export function videoIdFromInput(input: string): string | null {
  const s = input.trim();
  if (ID.test(s)) return s;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1] ?? null;
  else if (YT_HOSTS.has(host)) {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'watch') id = url.searchParams.get('v');
    else if (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') id = parts[1] ?? null;
  }
  return id && ID.test(id) ? id : null;
}

const MARKERS = ['ytInitialPlayerResponse = ', 'ytInitialPlayerResponse=', '"ytInitialPlayerResponse"] = ', '"ytInitialPlayerResponse"]='];

/** The JSON object assigned to ytInitialPlayerResponse in a watch page's HTML; null when it isn't there or isn't JSON. */
export function extractPlayerResponse(html: string): unknown | null {
  for (const marker of MARKERS) {
    const at = html.indexOf(marker);
    if (at < 0) continue;
    const start = at + marker.length;
    if (html[start] !== '{') return null;
    const end = objectEnd(html, start);
    if (end < 0) return null;
    try {
      return JSON.parse(html.slice(start, end + 1)) as unknown;
    } catch {
      return null;
    }
  }
  return null;
}

/** Index of the brace closing the object that opens at `start`, skipping braces inside strings; -1 if unterminated. */
function objectEnd(s: string, start: number): number {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

export type Calc<K extends string> = ({ ok: true } & Record<K, number>) | { ok: false; reason: string };

const whole = (n: number) => Number.isInteger(n) && n >= 0;
const nonNeg = (n: number) => Number.isFinite(n) && n >= 0;
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
const TOO_LARGE = { ok: false as const, reason: 'These numbers are too large.' };

/**
 * A whole number as people type it: plain digits, or groups of three split consistently by "." "," or spaces
 * ("12.400" and "12,400" are both 12400: a count has no fraction). Anything else is NaN, never a guess.
 */
export function parseCount(input: string): number {
  const s = input.trim();
  if (/^\d+$/.test(s)) return Number(s);
  const m = /^\d{1,3}([., ])\d{3}(?:\1\d{3})*$/.exec(s);
  return m ? Number(s.split(m[1]!).join('')) : Number.NaN;
}

/**
 * A decimal number with one decimal mark, "." or "," ("2,5" = 2.5). A mark followed by exactly three digits ("1,000")
 * could be a thousands separator, so it is NaN rather than a guess.
 */
export function parseDecimal(input: string): number {
  const m = /^(\d+)(?:[.,](\d+))?$/.exec(input.trim());
  if (!m || m[2]?.length === 3) return Number.NaN;
  return Number(m[2] === undefined ? m[1] : `${m[1]}.${m[2]}`);
}

/** (likes + comments) ÷ views × 100, from numbers the user typed. */
export function engagementRate(v: { views: number; likes: number; comments: number }): Calc<'percent'> {
  if (!whole(v.views)) return { ok: false, reason: 'Views must be a whole number, 0 or more.' };
  if (!whole(v.likes)) return { ok: false, reason: 'Likes must be a whole number, 0 or more.' };
  if (!whole(v.comments)) return { ok: false, reason: 'Comments must be a whole number, 0 or more.' };
  if (v.views === 0) return { ok: false, reason: 'Views must be more than 0.' };
  const percent = round(((v.likes + v.comments) / v.views) * 100, 2);
  return Number.isFinite(percent) ? { ok: true, percent } : TOO_LARGE;
}

/** Watch time in hours: views × average view duration. */
export function watchTime(v: { views: number; avgSec: number }): Calc<'hours'> {
  if (!whole(v.views)) return { ok: false, reason: 'Views must be a whole number, 0 or more.' };
  if (!nonNeg(v.avgSec)) return { ok: false, reason: 'Average view duration must be 0 seconds or more.' };
  const hours = round((v.views * v.avgSec) / 3600, 1);
  return Number.isFinite(hours) ? { ok: true, hours } : TOO_LARGE;
}

/** Average view duration in seconds: watch hours ÷ views. */
export function avgViewDuration(v: { views: number; hours: number }): Calc<'seconds'> {
  if (!whole(v.views)) return { ok: false, reason: 'Views must be a whole number, 0 or more.' };
  if (!nonNeg(v.hours)) return { ok: false, reason: 'Watch time must be 0 hours or more.' };
  if (v.views === 0) return { ok: false, reason: 'Views must be more than 0.' };
  const seconds = Math.round((v.hours * 3600) / v.views);
  return Number.isFinite(seconds) ? { ok: true, seconds } : TOO_LARGE;
}

/** "4:05" → 245, "1:02:03" → 3723; null when it isn't a clock time. */
export function parseTimestamp(t: string): number | null {
  const m = /^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*$/.exec(t);
  if (!m) return null;
  const [h, mi, s] = [Number(m[1] ?? 0), Number(m[2]), Number(m[3])];
  if (s > 59 || (m[1] !== undefined && mi > 59)) return null;
  return h * 3600 + mi * 60 + s;
}

/** 245 → "4:05", 3725 → "1:02:05". */
export function clock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(Math.floor(sec % 60)).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export interface TranscriptSegment { startSec: number; text: string }

/** Plain text of a transcript, one segment per line, optionally with its start time. */
export function transcriptText(segments: TranscriptSegment[], withTimes: boolean): string {
  return segments.map((s) => {
    const text = s.text.replace(/\s+/g, ' ').trim();
    return withTimes ? `${clock(s.startSec)} ${text}` : text;
  }).join('\n');
}
