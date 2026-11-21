/** JSON shapes of the /api/channels/:id/* endpoints, shared by the Worker and the web app. */
import type { Measured } from './measured';
import type { Coverage, RangeKey, periodFor } from './period';

export type ApiErrorCode = 'signed_out' | 'not_found' | 'reconnect' | 'gone' | 'google_failed';
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

/** Countries a keyword estimate can be asked for (DataForSEO location codes). */
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

/** Estimated volume from a keyword data vendor (never YouTube data; always labelled). */
export type KeywordEstimate =
  | { status: 'off'; reason: string }
  | { status: 'failed'; reason: string }
  | {
      status: 'ok'; provider: string; label: string; keyword: string; country: string;
      volume: Measured<number>; monthly: { month: string; volume: number }[];
      /** Relative YouTube search interest, 0–100 (Google Trends, YouTube search). */
      interest: { date: string; value: number }[];
      fetchedAt: string;
    };

/** The creator's own search terms (S1) that contain a keyword. */
export interface YourTerms { keyword: string; coverage: Coverage; terms: SearchTerm[]; note: string | null; fetchedAt: string }
