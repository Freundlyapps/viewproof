/** JSON shapes of the /api/channels/:id/* endpoints, shared by the Worker and the web app. */
import type { Measured } from './measured';
import type { Coverage, RangeKey, periodFor } from './period';

export type ApiErrorCode = 'signed_out' | 'not_found' | 'reconnect' | 'gone' | 'google_failed' | 'bad_request' | 'limit';
export interface ApiError { error: ApiErrorCode; message: string }

/** A YouTube value for the chosen period and the same-length period before it (no % change: III.E.4.h). */
export interface Pair { current: Measured<number>; previous: Measured<number> }
export type Period = ReturnType<typeof periodFor>;

export interface Overview {
  channelId: string;
  range: RangeKey;
  period: Period;
  /** Last day YouTube returned data for (it lags 48–72 h), or null when it returned none. */
  dataThrough: string | null;
  totals: { views: Pair; watchMinutes: Pair; averageViewDuration: Pair; subscribersGained: Pair; subscribersLost: Pair };
  daily: { date: string; views: number }[];
  /** Which days the comparison covers (YouTube lags, so often fewer than the range). */
  coverage: Coverage;
  fetchedAt: string;
}

export interface VideoRow {
  videoId: string;
  title: string;
  publishedAt: string;
  durationSec: number | null;
  thumbnailUrl: string | null;
  lifetimeViews: Measured<number>;
  views: Measured<number>;
  watchMinutes: Measured<number>;
  averageViewDuration: Measured<number>;
}
export interface Videos { range: RangeKey; dataThrough: string | null; coverage: Coverage; videos: VideoRow[]; fetchedAt: string }

export interface SearchTerm {
  term: string;
  views: number;
  watchMinutes: number;
  previousViews: Measured<number>;
  /** The video (of the period's top 10) that got the most views from this term, if any. */
  topVideo: { videoId: string; title: string } | null;
}
export interface SearchTerms { range: RangeKey; coverage: Coverage; terms: SearchTerm[]; note: string | null; fetchedAt: string }

export type Earnings =
  | { status: 'not_granted' }
  | { status: 'not_available'; reason: string }
  | {
      status: 'ok';
      range: RangeKey;
      coverage: Coverage;
      totals: { estimatedRevenue: Pair; playbackBasedCpm: Pair; monetizedPlaybacks: Pair };
      topVideos: { videoId: string; title: string; estimatedRevenue: number; playbackBasedCpm: Measured<number> }[];
      fetchedAt: string;
    };

export interface UploadTimes { uploads: { videoId: string; title: string; publishedAt: string; firstWeekViews: Measured<number> }[]; fetchedAt: string }

/** Countries a keyword trend can be asked for (DataForSEO location codes). */
export const COUNTRIES: { code: string; name: string; locationCode: number }[] = [
  { code: 'US', name: 'United States', locationCode: 2840 },
  { code: 'GB', name: 'United Kingdom', locationCode: 2826 },
  { code: 'DE', name: 'Germany', locationCode: 2276 },
  { code: 'IN', name: 'India', locationCode: 2356 },
  { code: 'CA', name: 'Canada', locationCode: 2124 },
  { code: 'AU', name: 'Australia', locationCode: 2036 },
  { code: 'FR', name: 'France', locationCode: 2250 },
  { code: 'ES', name: 'Spain', locationCode: 2724 },
  { code: 'BR', name: 'Brazil', locationCode: 2076 },
];
export const DEFAULT_COUNTRY = 'US';

/**
 * Relative YouTube search interest from Google Trends (via a vendor), 100 = the peak week in the range.
 * Not a number of searches, and not YouTube API data.
 */
export type KeywordTrends =
  | { status: 'off'; reason: string }
  | { status: 'failed'; reason: string }
  | {
      status: 'ok'; provider: string; label: string; keyword: string; country: string;
      interest: { date: string; value: number }[];
      /** Why `interest` is empty, when it is. */
      note: string | null;
      fetchedAt: string;
    };

/** The creator's own search terms (S1) that contain a keyword. */
export interface YourTerms { keyword: string; coverage: Coverage; terms: SearchTerm[]; note: string | null; fetchedAt: string }

/** A tracked competitor channel (plan 5a). Feed facts are public RSS data; `subscribers` is YouTube Data API data shown "as of". */
export interface Competitor {
  channelId: string;
  title: string;
  handle: string | null;
  addedAt: string;
  lastCheckedAt: string | null;
  /** Why the latest feed check failed, when it did. */
  checkError: string | null;
  subscribers: Measured<number>;
  totalViews: Measured<number>;
  summary: import('./competitors').ChannelSummary;
}
export interface CompetitorDetail extends Competitor { videos: import('./competitors').CompetitorVideo[] }
export interface CompetitorUploads { uploads: (import('./competitors').CompetitorVideo & { channelId: string; channelTitle: string })[] }

/** Plan 5b: data pool. */
export interface ContributeResult { accepted: number; rejected: number; reasons: string[] }
export interface PoolBrowser {
  id: string; label: string; createdAt: string; lastUsedAt: string | null;
  acceptedToday: number; rejectedToday: number; acceptedTotal: number; status: 'active' | 'suspended';
}
export type OutlierRow = import('./competitors').CompetitorVideo & { channelId: string; channelTitle: string; channelMedian: Measured<number> };
export interface Outliers { rows: OutlierRow[]; coverage: { videos: number; channels: number; channelsWaiting: number; days: 30 } }
