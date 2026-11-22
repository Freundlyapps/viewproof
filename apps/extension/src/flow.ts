import { type ChecklistSettings, DEFAULT_CHECKLIST, MIN_DELTA_MINUTES, type ViewObservation, buildScorecard, parsePlayerResponse } from '@viewproof/core';
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
  /** The user's checklist rules (extension settings); defaults when absent. */
  checklist?: () => Promise<ChecklistSettings>;
}

/** One player-data message → one panel render, unless the user has moved on. */
export async function handlePlayer(msg: { url: string; payload: unknown; reason?: string }, d: FlowDeps): Promise<void> {
  const seq = d.guard.next(msg.url);
  const show = (state: PanelState) => {
    if (d.guard.isCurrent(seq, d.currentUrl())) d.render(state);
  };
  try {
    await run(msg, d, seq, show);
  } catch (e) {
    show({ kind: 'error', reason: e instanceof Error ? e.message : 'unexpected error' });
  }
}

async function run(msg: { url: string; payload: unknown; reason?: string }, d: FlowDeps, seq: number, show: (s: PanelState) => void): Promise<void> {
  if (msg.payload === null && msg.reason) return show({ kind: 'error', reason: msg.reason });
  const parsed = parsePlayerResponse(msg.payload);
  if (!parsed.ok) return show({ kind: 'error', reason: parsed.reason });
  const video = parsed.value;
  const nowIso = new Date(d.now()).toISOString();
  const checklist = d.checklist ? await d.checklist().catch(() => DEFAULT_CHECKLIST) : DEFAULT_CHECKLIST;

  let previous: ViewObservation | null = null;
  try {
    previous = await d.store.getLatest(video.videoId);
    // Keep the older sighting until it is old enough to give a meaningful delta.
    const tooClose = previous && d.now() - Date.parse(previous.at) < MIN_DELTA_MINUTES * 60_000;
    if (!tooClose && video.views !== null && !video.isLive && !video.isUpcoming) {
      await d.store.record(video.videoId, { views: video.views, at: nowIso });
    }
  } catch {
    // Local storage is an optimisation; without it VPH falls back to the since-upload average.
  }

  // Show this video's own numbers at once; ×N follows when the channel feed arrives.
  const pending = buildScorecard({ video, previous, baseline: { ok: false, reason: 'loading' }, now: nowIso, checklist });
  show({ kind: 'ok', card: pending, outlierPending: true });

  const baseline = await getBaseline(video.channelId, { fetch: d.fetch, now: d.now, cache: d.cache });
  if (!d.guard.isCurrent(seq, d.currentUrl())) return;
  show({ kind: 'ok', card: buildScorecard({ video, previous, baseline, now: nowIso, checklist }) });
}
