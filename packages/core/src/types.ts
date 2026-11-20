export type Platform = 'youtube';
export type Format = 'long' | 'short' | 'unknown';

/** One upload as listed in a channel's public RSS feed. */
export interface FeedVideo {
  platform: Platform;
  videoId: string;
  title: string;
  publishedAt: string;
  /** null when the feed omits the count — never guessed. */
  views: number | null;
  format: Format;
}
