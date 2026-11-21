import type { KeywordTrends } from '@viewproof/core';

/** An optional source of keyword trends (spec D2). Vendors plug in behind this; none is YouTube API data. */
export interface KeywordProvider {
  name: string;
  trends(keyword: string, country: { code: string; locationCode: number }): Promise<KeywordTrends>;
}

/** Shown with every trend series (policy III.E.4.h disclosure: not YouTube API data). */
export const TRENDS_LABEL = 'Relative YouTube search interest from Google Trends (via DataForSEO), 100 = peak week. Not a number of searches; not YouTube API data.';

/** No vendor configured or allowed: trends are "off" with the reason. */
export function noProvider(reason: string): KeywordProvider {
  return { name: 'none', trends: async () => ({ status: 'off', reason }) };
}
