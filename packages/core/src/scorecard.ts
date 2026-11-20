import type { ParseResult } from './feed';
import { type Measured, noData } from './measured';
import { outlierScore } from './outlier';
import type { WatchVideo } from './player';
import type { FeedVideo } from './types';
import { type ViewObservation, viewsPerHour } from './vph';

export interface Scorecard {
  platform: 'youtube';
  videoId: string;
  title: string;
  vph: Measured<number>;
  outlier: Measured<number>;
  ageHours: number;
  tags: string[];
}

export function buildScorecard(args: {
  video: WatchVideo;
  previous: ViewObservation | null;
  baseline: ParseResult<FeedVideo[]>;
  now: string;
}): Scorecard {
  const { video, previous, baseline, now } = args;
  const liveOrUpcoming = video.isLive || video.isUpcoming;
  return {
    platform: 'youtube',
    videoId: video.videoId,
    title: video.title,
    vph: liveOrUpcoming
      ? noData('Live or upcoming video')
      : viewsPerHour({ current: { views: video.views, at: now }, previous, publishedAt: video.publishedAt }),
    outlier: baseline.ok
      ? outlierScore({ video, baseline: baseline.value })
      : liveOrUpcoming
        ? noData('Live or upcoming video')
        : noData(`Couldn't load this channel's recent videos: ${baseline.reason}`),
    ageHours: Math.floor((Date.parse(now) - Date.parse(video.publishedAt)) / 3_600_000),
    tags: video.tags,
  };
}
