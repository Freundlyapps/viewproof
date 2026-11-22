import { readFileSync } from 'node:fs';
import { DEFAULT_CHECKLIST, normalizeChecklist, type Scorecard } from '@viewproof/core';
import { describe, expect, test, vi } from 'vitest';
import { getBaseline } from '../src/baseline';
import { idleRenderer, withChecklist } from '../src/flow';
import type { PanelState } from '../src/panel';

const player = JSON.parse(readFileSync(new URL('../../../packages/core/test/fixtures/player-watch-full.json', import.meta.url), 'utf8'));

describe('C1: a settings change re-draws, never re-records', () => {
  test('withChecklist rebuilds only the checklist of the shown card', () => {
    const card = { videoId: player.videoDetails.videoId, vph: { kind: 'value', value: 5 }, checklist: [] } as unknown as Scorecard;
    const next = withChecklist({ kind: 'ok', card }, player, normalizeChecklist({ ...DEFAULT_CHECKLIST, captions: { on: false } }));
    expect(next?.kind).toBe('ok');
    if (next?.kind === 'ok') {
      expect(next.card.vph).toBe(card.vph);
      expect(next.card.checklist.map((i) => i.id)).toEqual(['title', 'description', 'tags', 'chapters', 'endScreen']);
    }
  });
  test('a card for another video is not touched', () => {
    const card = { videoId: 'othervideo1', checklist: [] } as unknown as Scorecard;
    expect(withChecklist({ kind: 'ok', card }, player, DEFAULT_CHECKLIST)).toBeNull();
    expect(withChecklist({ kind: 'loading' }, player, DEFAULT_CHECKLIST)).toBeNull();
  });
});

describe('I1: a deferred paint is dropped after navigation or switching off', () => {
  const setup = () => {
    const jobs: (() => void)[] = [];
    let url = 'https://www.youtube.com/watch?v=aaaaaaaaaaa';
    let on = true;
    const paint = vi.fn();
    const mount = vi.fn(async () => ({}) as HTMLElement);
    const r = idleRenderer({
      whenIdle: <T>(fn: () => T | Promise<T>) => new Promise<T>((res) => jobs.push(() => res(fn()))),
      mount, paint, currentUrl: () => url, enabled: () => on,
    });
    return { r, jobs, paint, mount, nav: (u: string) => { url = u; r.invalidate(); }, off: () => { on = false; } };
  };
  const state: PanelState = { kind: 'loading' };
  test('paints when nothing changed', async () => {
    const s = setup();
    s.r.render(state);
    s.jobs.shift()!();
    await vi.waitFor(() => expect(s.paint).toHaveBeenCalledTimes(1));
  });
  test('navigation before idle: no paint, no mount', async () => {
    const s = setup();
    s.r.render(state);
    s.nav('https://www.youtube.com/watch?v=bbbbbbbbbbb');
    s.jobs.shift()!();
    await new Promise((r) => setTimeout(r, 10));
    expect(s.paint).not.toHaveBeenCalled();
    expect(s.mount).not.toHaveBeenCalled();
  });
  test('switched off before idle: no paint', async () => {
    const s = setup();
    s.r.render(state);
    s.off();
    s.jobs.shift()!();
    await new Promise((r) => setTimeout(r, 10));
    expect(s.paint).not.toHaveBeenCalled();
  });
});

test('I4: one 429 pauses every feed request from this page for an hour', async () => {
  const fetch = vi.fn(async () => new Response('', { status: 429 }));
  const cache = new Map();
  let t = 0;
  const deps = { fetch, now: () => t, cache };
  expect(await getBaseline('UCaaa', deps)).toEqual({ ok: false, reason: 'HTTP 429' });
  const other = await getBaseline('UCbbb', deps);
  expect(other.ok).toBe(false);
  if (!other.ok) expect(other.reason).toContain('HTTP 429');
  expect(fetch).toHaveBeenCalledTimes(1);
  t = 3_600_001;
  await getBaseline('UCbbb', deps);
  expect(fetch).toHaveBeenCalledTimes(2);
});
