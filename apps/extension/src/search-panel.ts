import { type FeedVideo, type Measured, type ParseResult, type SearchPage, type TopResultsFacts, outlierScore } from '@viewproof/core';
import type { CardModel } from './page-panel';

/** Channel feeds fetched per search page, and how many at once (Global Constraints). */
export const MAX_SEARCH_FEEDS = 8;
const CONCURRENCY = 2;

/**
 * ×N for search results that are among their channel's latest feed uploads: exact count from the search page,
 * upload time and format from the feed. Stops on 403/429 and when the user has moved on.
 */
export async function searchFeedOutliers(page: SearchPage, deps: {
  baseline: (channelId: string) => Promise<ParseResult<FeedVideo[]>>;
  isCurrent: () => boolean;
}): Promise<{ outliers: Map<string, Measured<number>>; channelsChecked: number; stopped: string | null }> {
  const outliers = new Map<string, Measured<number>>();
  const queue = [...new Set(page.results.map((r) => r.channelId).filter((c): c is string => !!c))].slice(0, MAX_SEARCH_FEEDS);
  let channelsChecked = 0;
  let stopped: string | null = null;

  const worker = async () => {
    for (let ch = queue.shift(); ch !== undefined; ch = queue.shift()) {
      if (stopped || !deps.isCurrent()) return;
      const feed = await deps.baseline(ch);
      if (!deps.isCurrent()) return;
      channelsChecked++;
      if (!feed.ok) {
        if (/HTTP (403|429)/.test(feed.reason)) stopped = feed.reason;
        continue;
      }
      for (const r of page.results) {
        if (r.channelId !== ch || r.views.kind !== 'value' || r.live) continue;
        const entry = feed.value.find((f) => f.videoId === r.videoId);
        if (!entry) continue;
        outliers.set(r.videoId, outlierScore({
          video: { videoId: r.videoId, views: r.views.value, format: entry.format, publishedAt: entry.publishedAt, isLive: false, isUpcoming: false },
          baseline: feed.value,
        }));
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { outliers, channelsChecked, stopped };
}

const num = new Intl.NumberFormat('en-US');
function days(d: number): string {
  if (d < 1) return 'under a day';
  if (d < 60) return `${Math.round(d)} days`;
  if (d < 730) return `${Math.round(d / 30)} months`;
  return `${Math.round(d / 365)} years`;
}

export interface SearchCover {
  withXn: number;
  total: number;
  stopped: string | null;
  rows: NonNullable<CardModel['rows']>;
}

/** The search panel: plain facts about the results the user is looking at, and ×N where it can be computed. */
export function searchCard(page: SearchPage, f: TopResultsFacts, summary: string[], cover: SearchCover | null): CardModel {
  const val = (m: Measured<number>, show: (v: number) => string) => (m.kind === 'value' ? show(m.value) : 'No data');
  const stats: CardModel['stats'] = [
    { label: 'Median views', value: val(f.medianViews, (v) => num.format(Math.round(v))), note: `of ${f.videos} results` },
    { label: 'Median upload age', value: val(f.medianAgeDays, days), note: "from YouTube's rounded labels" },
    { label: 'From the last 90 days', value: val(f.recent, (v) => `${v} of ${f.videos}`) },
    { label: 'Under 10,000 views', value: val(f.under10kViews, (v) => `${v} of ${f.videos}`) },
  ];
  const lines = [...summary];
  if (!cover) lines.push('Checking channel feeds for ×N…');
  else {
    lines.push(`×N shown for ${cover.withXn} of ${cover.total} results — the rest are older than their channel's latest 15 uploads, or their channel wasn't checked (at most ${MAX_SEARCH_FEEDS} per search).`);
    if (cover.stopped) lines.push(`Stopped checking feeds: YouTube asked to slow down (${cover.stopped}).`);
  }
  return { title: `What ranks for "${page.query}"`, stats, lines, rows: cover?.rows ?? [] };
}
