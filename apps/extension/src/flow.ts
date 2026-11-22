import { type ChecklistSettings, DEFAULT_CHECKLIST, MIN_DELTA_MINUTES, type ViewObservation, buildScorecard, parsePlayerResponse, runChecklist } from '@viewproof/core';
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

/**
 * After a rules change: the shown card with only its checklist rebuilt from the same player data.
 * Never re-runs the flow, so no view count is recorded again. Null when the card is for another video.
 */
export function withChecklist(state: PanelState, payload: unknown, settings: ChecklistSettings): PanelState | null {
  if (state.kind !== 'ok') return null;
  const parsed = parsePlayerResponse(payload);
  if (!parsed.ok || parsed.value.videoId !== state.card.videoId) return null;
  return { ...state, card: { ...state.card, checklist: runChecklist(parsed.value, settings) } };
}

/**
 * Paint after the page is idle, but only if the user is still on the same page and the panel is still on:
 * a paint that waited through a navigation would show the previous video's numbers.
 */
export function idleRenderer(d: {
  whenIdle: <T>(fn: () => T | Promise<T>) => Promise<T>;
  mount: () => Promise<HTMLElement | null>;
  paint: (host: HTMLElement, state: PanelState) => void;
  currentUrl: () => string;
  enabled: () => boolean;
}): { render(state: PanelState): void; invalidate(): void } {
  let gen = 0;
  return {
    invalidate() { gen++; },
    render(state) {
      if (!d.enabled()) return;
      const mine = gen;
      const url = d.currentUrl();
      const still = () => mine === gen && d.currentUrl() === url && d.enabled();
      void d.whenIdle(async () => {
        if (!still()) return;
        const host = await d.mount();
        if (host && still()) d.paint(host, state);
      });
    },
  };
}
