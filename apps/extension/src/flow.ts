import { MIN_DELTA_MINUTES, type ViewObservation, buildScorecard, parsePlayerResponse } from '@open-iq/core';
import { type BaselineCache, getBaseline } from './baseline';
import type { NavigationGuard } from './bridge';
import type { PanelState } from './panel';
import type { ObservationStore } from './store';

export interface FlowDeps {
  guard: NavigationGuard;
  store: ObservationStore;
  cache: BaselineCache;
  fetch: typeof fetch;
  now: () => number;
  currentUrl: () => string;
  render: (state: PanelState) => void;
}

/** One player-data message → one panel render, unless the user has moved on. */
export async function handlePlayer(msg: { url: string; payload: unknown }, d: FlowDeps): Promise<void> {
  const seq = d.guard.next(msg.url);
  const parsed = parsePlayerResponse(msg.payload);
  if (!parsed.ok) {
    if (d.guard.isCurrent(seq, d.currentUrl())) d.render({ kind: 'error', reason: parsed.reason });
    return;
  }
  const video = parsed.value;
  const nowIso = new Date(d.now()).toISOString();

  let previous: ViewObservation | null = null;
  try {
    previous = await d.store.getLatest(video.videoId);
    // Keep the older sighting until it is old enough to give a meaningful delta.
    const tooClose = previous && d.now() - Date.parse(previous.at) < MIN_DELTA_MINUTES * 60_000;
    if (!tooClose && !video.isLive && !video.isUpcoming) await d.store.record(video.videoId, { views: video.views, at: nowIso });
  } catch {
    // Local storage is an optimisation; without it VPH falls back to the since-upload average.
  }

  const baseline = await getBaseline(video.channelId, { fetch: d.fetch, now: d.now, cache: d.cache });
  if (!d.guard.isCurrent(seq, d.currentUrl())) return;
  d.render({ kind: 'ok', card: buildScorecard({ video, previous, baseline, now: nowIso }) });
}
