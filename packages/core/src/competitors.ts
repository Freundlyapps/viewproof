import { type Measured, median, noData, value } from './measured';
import { outlierScore } from './outlier';
import type { FeedVideo, Format } from './types';
import { viewsPerHour } from './vph';

const INVALID = { kind: 'invalid', reason: 'Paste a channel link, its @handle or its UC… id.' } as const;
const CHANNEL_ID = /^UC[\w-]{22}$/;
const HANDLE = /^@[\w.-]{3,30}$/;

/** A pasted channel link, @handle or UC… id. */
export function parseChannelInput(s: string): { kind: 'id'; channelId: string } | { kind: 'handle'; handle: string } | typeof INVALID {
  const t = s.trim();
  if (CHANNEL_ID.test(t)) return { kind: 'id', channelId: t };
  if (HANDLE.test(t)) return { kind: 'handle', handle: t.toLowerCase() };
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
  } catch {
    return INVALID;
  }
  if (!/(^|\.)youtube\.com$/i.test(u.hostname)) return INVALID;
  const [first, second] = u.pathname.split('/').filter(Boolean);
  if (first === 'channel' && second && CHANNEL_ID.test(second)) return { kind: 'id', channelId: second };
  if (first && HANDLE.test(decodeURIComponent(first))) return { kind: 'handle', handle: decodeURIComponent(first).toLowerCase() };
  return INVALID;
}

export interface Snapshot { views: number; at: string }

export interface CompetitorVideo {
  videoId: string;
  title: string;
  publishedAt: string;
  format: Format;
  views: Measured<number>;
  vph: Measured<number>;
  outlier: Measured<number>;
  /** ViewProof's own checks of the public count, oldest first. */
  history: Snapshot[];
}

const FEED = 'public RSS feed';
const HOUR_MS = 3_600_000;

/** Views, views per hour (between our checks ≥ 60 min apart, else since upload) and ×N against the channel's feed. */
export function videoStats(
  v: { videoId: string; title: string; publishedAt: string; format: Format; views: number | null },
  snapshots: Snapshot[], feed: FeedVideo[], nowIso: string,
): CompetitorVideo {
  const base = { videoId: v.videoId, title: v.title, publishedAt: v.publishedAt, format: v.format, history: snapshots };
  if (v.views === null) {
    const why = 'The feed shows no view count for this video';
    return { ...base, views: noData(why), vph: noData(why), outlier: noData(why) };
  }
  const young = Date.parse(nowIso) - Date.parse(v.publishedAt) < HOUR_MS;
  if (v.views === 0) {
    // The feed lists scheduled premieres and live streams with 0 views; it can't tell them from a brand-new upload.
    const why = 'No public views yet: new, upcoming or live';
    return { ...base, views: value(0, FEED, { at: nowIso }), vph: noData(why), outlier: noData(why) };
  }
  const latest = snapshots.at(-1);
  const current = latest && latest.views === v.views ? latest : { views: v.views, at: nowIso };
  const previous = [...snapshots].reverse().find((s) => Date.parse(current.at) - Date.parse(s.at) >= HOUR_MS) ?? null;
  return {
    ...base,
    views: value(v.views, FEED, { at: current.at }),
    vph: serverChecks(viewsPerHour({ current, previous, publishedAt: v.publishedAt })),
    outlier: young ? noData('Published less than an hour ago') : outlierScore({ video: { ...v, isLive: false, isUpcoming: false }, baseline: feed }),
  };
}

/** The core formula text speaks of the user's own visits; here the two observations are ViewProof's feed checks. */
function serverChecks(m: Measured<number>): Measured<number> {
  return m.kind === 'value' && m.inputs.mode === 'delta' ? { ...m, formula: "view change ÷ hours between two of ViewProof's feed checks" } : m;
}

const DAY_MS = 86_400_000;

/** Facts over the feed's latest 15 uploads (counts and medians of public feed data, not API data). */
export function channelSummary(feed: FeedVideo[], nowIso: string) {
  const now = Date.parse(nowIso);
  const latest = [...feed].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0];
  const med = (format: Format, label: string): Measured<number> => {
    const xs = feed.filter((x) => x.format === format && x.views !== null).map((x) => x.views!);
    const m = median(xs);
    return m === null ? noData(`No ${label} in the feed's latest ${feed.length} uploads`) : value(m, `median views of ${xs.length} ${label} in the feed`, { n: xs.length });
  };
  return {
    latestUploadAt: latest?.publishedAt ?? null,
    inLast30Days: { count: feed.filter((x) => now - Date.parse(x.publishedAt) <= 30 * DAY_MS).length, ofFeed: feed.length },
    medianViewsLong: med('long', 'long videos'),
    medianViewsShorts: med('short', 'Shorts'),
  };
}
export type ChannelSummary = ReturnType<typeof channelSummary>;
