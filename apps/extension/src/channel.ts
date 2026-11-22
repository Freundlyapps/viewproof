import type { ChannelPage, Measured } from '@viewproof/core';
import type { Badge } from './badges';
import type { CardModel } from './page-panel';

/** Message posted by the MAIN-world script with the channel page data YouTube already loaded. */
export const CHANNEL_MSG = 'viewproof:channel' as const;
export interface ChannelMessage { type: typeof CHANNEL_MSG; url: string; data: unknown }

export function isChannelMessage(e: MessageEvent, self: Window, origin: string): e is MessageEvent<ChannelMessage> {
  if (e.source !== self || e.origin !== origin) return false;
  const d = e.data as Partial<ChannelMessage> | null;
  return !!d && d.type === CHANNEL_MSG && typeof d.url === 'string' && 'data' in d;
}

/** A channel's Videos or Shorts tab; null for every other page. */
export function isChannelPath(pathname: string): 'videos' | 'shorts' | null {
  const m = /^\/(?:@[^/]+|channel\/[\w-]+|c\/[^/]+|user\/[^/]+)\/(videos|shorts)\/?$/.exec(pathname);
  return m ? (m[1] as 'videos' | 'shorts') : null;
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export function badgeFor(m: Measured<number> | undefined): Badge | null {
  if (!m || m.kind !== 'value') return null;
  const i = m.inputs;
  const range = i.rounded === true ? ` (between ×${i.low} and ×${i.high}: YouTube shows rounded counts here)` : '';
  const base = typeof i.baselineMedian === 'number' ? `; the channel's earlier videos have a median of ${compact.format(i.baselineMedian)} views` : '';
  return {
    text: `×${m.value}`,
    title: `ViewProof: ×${m.value} vs this channel's usual views${base}${range}.`,
    tone: m.value >= 3 ? 'hi' : m.value <= 0.3 ? 'lo' : 'plain',
  };
}

export function channelBadges(outliers: Map<string, Measured<number>>): Map<string, Badge> {
  const out = new Map<string, Badge>();
  for (const [id, m] of outliers) { const b = badgeFor(m); if (b) out.set(id, b); }
  return out;
}

const TOP = 5;

/** The channel panel: usual views, the biggest outliers on the page, and why some videos have no ×N. */
export function channelCard(page: ChannelPage, outliers: Map<string, Measured<number>>, summary?: { medianViews: Measured<number>; counted: number }): CardModel {
  const withXn = page.videos.flatMap((v) => { const m = outliers.get(v.videoId); return m?.kind === 'value' ? [{ v, m }] : []; });
  const missing = page.videos.map((v) => outliers.get(v.videoId)).filter((m): m is Extract<Measured<number>, { kind: 'no_data' }> => m?.kind === 'no_data');
  const counts = page.videos.filter((v) => v.views).slice(0, 15).map((v) => v.views!.mid).sort((a, b) => a - b);
  const med = summary?.medianViews.kind === 'value' ? summary.medianViews.value
    : counts.length ? (counts.length % 2 ? counts[(counts.length - 1) / 2]! : (counts[counts.length / 2 - 1]! + counts[counts.length / 2]!) / 2) : null;
  const stats: CardModel['stats'] = [
    { label: `Usual views (median of latest ${counts.length})`, value: med === null ? 'No data' : `≈${compact.format(med)}`, note: 'from rounded counts' },
  ];
  if (page.subscribersText) stats.push({ label: 'Subscribers', value: page.subscribersText.replace(/\s*subscribers?$/i, '') });
  const lines = [`×N for ${withXn.length} of ${page.videos.length} videos on this page: shown views ÷ the median of the next 15 older videos on this tab. Videos loaded by scrolling aren't included.`];
  if (missing.length) {
    // "Needs 5 earlier videos…; found 4" and "…; found 3" are one reason.
    const reasons = [...new Set(missing.map((m) => m.reason.replace(/; found \d+$/, '')))];
    lines.push(`${missing.length} without ×N: ${reasons.slice(0, 2).join('; ')}.`);
  }
  const rows = withXn
    .sort((a, b) => (b.m as { value: number }).value - (a.m as { value: number }).value)
    .slice(0, TOP)
    .map(({ v, m }) => {
      const i = (m as Extract<Measured<number>, { kind: 'value' }>).inputs;
      return {
        text: v.title || v.videoId,
        href: page.tab === 'shorts' ? `https://www.youtube.com/shorts/${v.videoId}` : `https://www.youtube.com/watch?v=${v.videoId}`,
        badge: `×${(m as { value: number }).value}`,
        note: `${v.viewsText}${v.ageLabel ? ` · ${v.ageLabel}` : ''} · between ×${i.low} and ×${i.high} (rounded counts)`,
      };
    });
  return { title: "This channel's videos", subtitle: page.title, stats, lines, rows };
}
