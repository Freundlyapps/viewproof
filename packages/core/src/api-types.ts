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
  totals: {
    views: Pair; watchMinutes: Pair; averageViewDuration: Pair; subscribersGained: Pair; subscribersLost: Pair;
    /** Share of each video watched on average (YouTube's averageViewPercentage, 0–100). */
    averageViewPercentage: Pair;
  };
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
  subscribersGained: Measured<number>;
  subscribersLost: Measured<number>;
  /** 0–100. */
  averageViewPercentage: Measured<number>;
  /** Thumbnail impressions summed over the period's days ViewProof has (Reporting API, last 30 days at most). */
  impressions: Measured<number>;
  /** YouTube's click-through rate for the video's latest day with data (0–1); inputs.day names the day. */
  latestCtr: Measured<number>;
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

/** Where the period's views came from (YouTube search, Browse, Suggested, Shorts feed…), with the period before. */
export interface TrafficSource {
  /** YouTube's insightTrafficSourceType code, e.g. YT_SEARCH. */
  type: string;
  label: string;
  views: number;
  watchMinutes: number;
  previousViews: Measured<number>;
}
export interface TrafficSources { range: RangeKey; coverage: Coverage; sources: TrafficSource[]; note: string | null; fetchedAt: string }

/** One point of a video's audience retention curve (YouTube gives up to 100, by share of the video's length). */
export interface RetentionPoint {
  /** Share of the video's length, 0.01–1. */
  elapsedRatio: number;
  /** The same point in seconds, when the video's length is known. */
  elapsedSec: number | null;
  /** Viewers still watching ÷ views (can pass 1 where people rewatch). */
  audienceWatchRatio: number;
  /** Retention at this point against videos of similar length on YouTube, 0–1 (0.5 = typical). */
  relativeRetentionPerformance: Measured<number>;
}
export interface VideoRetention {
  videoId: string;
  title: string;
  durationSec: number | null;
  range: RangeKey;
  period: { start: string; end: string };
  curve: RetentionPoint[];
  /** YouTube's first curve point at or after 0:30, as given (inputs.elapsedSec says where it is). */
  at30s: RetentionPoint | null;
  /** Why there is no 0:30 point. */
  at30sNote: string | null;
  note: string | null;
  fetchedAt: string;
}

/** One row of a breakdown (country, device…) with YouTube's views and watch time. */
export interface Slice { key: string; label: string; views: number; watchMinutes: number }
/** Who watches: countries, devices and age/gender, each with why it's empty when YouTube gives nothing. */
export interface Audience {
  range: RangeKey;
  coverage: Coverage;
  countries: Slice[];
  countriesNote: string | null;
  devices: Slice[];
  devicesNote: string | null;
  /** YouTube's viewerPercentage (signed-in viewers) per age group and gender, 0–100. */
  ageGender: { ageGroup: string; female: number; male: number; other: number }[];
  ageGenderNote: string | null;
  /** What YouTube doesn't give any app (shown so nobody guesses them). */
  notAvailable: string[];
  fetchedAt: string;
}

/** Thumbnail impressions and click-through rate (YouTube Reporting API, daily files, the last 30 days at most). */
export interface Thumbnails {
  /** waiting: jobs just started (data in about two days); failed: YouTube refused (reason). */
  status: 'ok' | 'waiting' | 'failed';
  reason: string | null;
  range: RangeKey;
  /** The days of the range that have data, oldest and newest. */
  days: { from: string | null; to: string | null; count: number };
  /** Impressions summed over the days ViewProof has. */
  totals: { impressions: Measured<number> };
  daily: { date: string; impressions: number }[];
  /** Per video: impressions summed, and YouTube's click-through rate per day as given (0–1). */
  videos: { videoId: string; title: string; thumbnailUrl: string | null; impressions: number; latestCtr: Measured<number>; ctrByDay: { date: string; ctr: number }[] }[];
  sources: { type: number; label: string; impressions: number }[];
  endScreens: { impressions: Measured<number>; clicks: Measured<number> };
  fetchedAt: string;
}

/**
 * One part of a video's check-up: YouTube's own values for the video, and the channel's value for the same
 * period where YouTube gives one. Nothing is computed from them (YouTube policy III.E.4.h): the creator compares.
 */
export interface CheckupPart {
  area: 'Reach' | 'Thumbnail & title' | 'Opening' | 'Watching' | 'Subscribers' | 'Next video';
  /** What to look for, in plain words (fixed guidance, not computed from the numbers). */
  guide: string;
  values: { label: string; video: Measured<number>; channel: Measured<number> | null; unit: 'count' | 'fraction' | 'percent' | 'seconds' | 'score' }[];
}
export interface VideoCheckup {
  video: { videoId: string; title: string; publishedAt: string; durationSec: number | null; thumbnailUrl: string | null };
  range: RangeKey;
  period: { start: string; end: string };
  views: Measured<number>;
  parts: CheckupPart[];
  retention: VideoRetention | null;
  /** YouTube's click-through rate per day for this video (0–1). */
  ctrByDay: { date: string; ctr: number }[];
  sources: TrafficSource[];
  fetchedAt: string;
}

export type Earnings =
  | { status: 'not_granted' }
  | { status: 'not_available'; reason: string }
  | {
      status: 'ok';
      range: RangeKey;
      coverage: Coverage;
      totals: {
        estimatedRevenue: Pair; playbackBasedCpm: Pair; monetizedPlaybacks: Pair;
        /** YouTube Premium revenue (estimatedRedPartnerRevenue). */
        premiumRevenue: Pair;
      };
      topVideos: { videoId: string; title: string; estimatedRevenue: number; playbackBasedCpm: Measured<number> }[];
      /** Top 10 countries by estimated revenue, or why there are none. */
      countries: { country: string; estimatedRevenue: number }[];
      countriesNote: string | null;
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
export interface Outliers {
  rows: OutlierRow[];
  /** `olderThanFeed`: found videos no longer among their channel's latest 15 uploads — the feed gives no ×N for them. */
  coverage: { videos: number; channels: number; channelsWaiting: number; olderThanFeed: number; days: 30 };
}

/** Plan 6b: one of the user's videos with its own top search terms (YouTube Analytics, last 90 days). */
export interface OptimizeVideo {
  video: { videoId: string; channelId: string; title: string; description: string; tags: string[]; publishedAt: string; durationSec: number | null };
  terms: { term: string; views: number }[];
  /** Why there are no terms, when YouTube lists none. */
  termsNote: string | null;
  period: { start: string; end: string };
  fetchedAt: string;
}
