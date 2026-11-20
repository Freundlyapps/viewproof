import { type Measured, median, noData, value } from './measured';
import type { FeedVideo, Format } from './types';

export const MIN_BASELINE = 5;
export const MAX_BASELINE = 15;
export const NEGATIVE_OUTLIER = 0.3;

/**
 * Outlier score ×N = views ÷ median views of the channel's earlier uploads
 * of the same format (spec §7, D1: baseline is the public RSS feed, ≤ 15).
 */
export function outlierScore(args: {
  video: { videoId: string; views: number; format: Format; publishedAt: string; isLive: boolean; isUpcoming: boolean };
  baseline: readonly FeedVideo[];
}): Measured<number> {
  const { video, baseline } = args;
  if (video.isLive || video.isUpcoming) return noData('Live or upcoming video');

  const others = baseline.filter(
    (b): b is FeedVideo & { views: number } => b.videoId !== video.videoId && b.views !== null,
  );
  const published = Date.parse(video.publishedAt);
  const earlier = others.filter((b) => Date.parse(b.publishedAt) < published);
  const pool = (earlier.length > 0 ? earlier : others).filter(
    (b) => b.format === video.format || b.format === 'unknown',
  );
  const chosen = [...pool]
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, MAX_BASELINE);

  if (chosen.length < MIN_BASELINE) {
    return noData(`Needs ${MIN_BASELINE} earlier videos of the same type; found ${chosen.length}`);
  }
  const med = median(chosen.map((b) => b.views))!;
  if (med <= 0) return noData('Earlier videos have no views yet');

  const score = Math.round((video.views / med) * 10) / 10;
  return value(score, "views ÷ median views of the channel's earlier videos", {
    views: video.views,
    baselineMedian: med,
    baselineCount: chosen.length,
    mixedFormats: chosen.some((b) => b.format === 'unknown'),
    negative: score <= NEGATIVE_OUTLIER,
  });
}
