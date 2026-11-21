/** JSON shapes of the /api/channels/:id/* endpoints, shared by the Worker and the web app. */
import type { Measured } from './measured';
import type { RangeKey, periodFor } from './period';

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
export interface Videos { range: RangeKey; dataThrough: string | null; videos: VideoRow[]; fetchedAt: string }

export interface SearchTerm {
  term: string;
  views: number;
  watchMinutes: number;
  previousViews: Measured<number>;
  /** The video (of the period's top 10) that got the most views from this term, if any. */
  topVideo: { videoId: string; title: string } | null;
}
export interface SearchTerms { range: RangeKey; terms: SearchTerm[]; note: string | null; fetchedAt: string }

export type Earnings =
  | { status: 'not_granted' }
  | { status: 'not_available'; reason: string }
  | {
      status: 'ok';
      range: RangeKey;
      totals: { estimatedRevenue: Pair; playbackBasedCpm: Pair; monetizedPlaybacks: Pair };
      topVideos: { videoId: string; title: string; estimatedRevenue: number; playbackBasedCpm: Measured<number> }[];
      fetchedAt: string;
    };

export interface UploadTimes { uploads: { videoId: string; title: string; publishedAt: string; firstWeekViews: Measured<number> }[]; fetchedAt: string }
