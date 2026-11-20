import type { ParseResult } from './feed';
import { type Measured, noData, value } from './measured';
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
  /** Hours since publishing; no_data for scheduled videos. */
  age: Measured<number>;
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
  const ageHours = Math.floor((Date.parse(now) - Date.parse(video.publishedAt)) / 3_600_000);
  const views = video.views;
  return {
    platform: 'youtube',
    videoId: video.videoId,
    title: video.title,
    vph: liveOrUpcoming
      ? noData('Live or upcoming video')
      : views === null
        ? noData('View count not shown')
        : viewsPerHour({ current: { views, at: now }, previous, publishedAt: video.publishedAt }),
    outlier: views === null && !liveOrUpcoming
      ? noData('View count not shown')
      : baseline.ok
      ? outlierScore({ video, baseline: baseline.value })
      : liveOrUpcoming
        ? noData('Live or upcoming video')
        : noData(`Couldn't load this channel's recent videos: ${baseline.reason}`),
    age: video.isUpcoming || ageHours < 0
      ? noData('Not published yet')
      : value(ageHours, 'hours since publishing', { publishedAt: video.publishedAt }),
    tags: video.tags,
  };
}
