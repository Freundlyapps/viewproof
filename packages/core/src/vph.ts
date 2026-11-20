import { type Measured, noData, value } from './measured';

export interface ViewObservation {
  views: number;
  /** ISO 8601 time the count was observed. */
  at: string;
}

/** Two observations closer than this are too noisy for a delta. */
export const MIN_DELTA_MINUTES = 10;

const HOUR_MS = 3_600_000;

/**
 * Views per hour. Delta between the user's own two observations when usable,
 * otherwise the average since upload (spec §7).
 */
export function viewsPerHour(args: {
  current: ViewObservation;
  previous: ViewObservation | null;
  publishedAt: string;
}): Measured<number> {
  const { current, previous, publishedAt } = args;
  const nowMs = Date.parse(current.at);

  if (previous) {
    const hours = (nowMs - Date.parse(previous.at)) / HOUR_MS;
    if (hours * 60 >= MIN_DELTA_MINUTES && current.views >= previous.views) {
      return value(Math.round((current.views - previous.views) / hours), 'view change ÷ hours between your two visits', {
        mode: 'delta',
        viewDelta: current.views - previous.views,
        hours: Math.round(hours * 100) / 100,
      });
    }
  }

  const hoursSinceUpload = (nowMs - Date.parse(publishedAt)) / HOUR_MS;
  if (!Number.isFinite(hoursSinceUpload)) return noData('Upload time unknown');
  if (hoursSinceUpload < 1) return noData('Published less than an hour ago');
  return value(Math.round(current.views / hoursSinceUpload), 'views ÷ hours since upload (average)', {
    mode: 'since_upload',
    views: current.views,
    hours: Math.round(hoursSinceUpload * 100) / 100,
  });
}
