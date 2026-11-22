import { readFileSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import { NavigationGuard } from '../src/bridge';
import { handlePlayer } from '../src/flow';
import { memoryStore } from '../src/store';
import { DEFAULT_CHECKLIST, normalizeChecklist } from '@viewproof/core';

const fx = (n: string) => JSON.parse(readFileSync(new URL(`../../../packages/core/test/fixtures/${n}`, import.meta.url), 'utf8'));
const player = fx('player-watch.json');
const ID = player.videoDetails.videoId as string;
const URL_A = `https://www.youtube.com/watch?v=${ID}`;
const feedXml = readFileSync(new URL('../../../packages/core/test/fixtures/feed-long.xml', import.meta.url), 'utf8');

function deps(over: Partial<Parameters<typeof handlePlayer>[1]> = {}) {
  return {
    guard: new NavigationGuard(),
    store: memoryStore(),
    cache: new Map(),
    fetch: vi.fn(async () => new Response(feedXml)),
    now: () => Date.parse('2026-11-20T12:00:00Z'),
    currentUrl: () => URL_A,
    render: vi.fn(),
    ...over,
  };
}

describe('handlePlayer', () => {
  test('renders a scorecard for the current video', async () => {
    const d = deps();
    await handlePlayer({ url: URL_A, payload: player }, d);
    const last = vi.mocked(d.render).mock.calls.at(-1)![0];
    expect(last).toMatchObject({ kind: 'ok', card: { videoId: ID } });
    expect(last).not.toHaveProperty('outlierPending', true);
  });

  test('renders an error state for unreadable player data', async () => {
    const d = deps();
    await handlePlayer({ url: URL_A, payload: null }, d);
    expect(vi.mocked(d.render).mock.calls[0]![0]).toMatchObject({ kind: 'error' });
  });

  test('drops the result when the user navigated away meanwhile', async () => {
    let url = URL_A;
    const d = deps({ currentUrl: () => url, fetch: vi.fn(async () => { url = 'https://www.youtube.com/watch?v=OTHERVIDEO1'; return new Response(feedXml); }) });
    await handlePlayer({ url: URL_A, payload: player }, d);
    // Only the immediate (pre-feed) render happened; the late feed result was dropped.
    expect(vi.mocked(d.render).mock.calls.every((c) => c[0].kind === 'ok' && c[0].outlierPending === true)).toBe(true);
  });

  test('keeps the older observation when visits are under an hour apart', async () => {
    let t = Date.parse('2026-11-20T12:00:00Z');
    const d = deps({ now: () => t });
    await handlePlayer({ url: URL_A, payload: player }, d);
    t += 30 * 60_000;
    await handlePlayer({ url: URL_A, payload: player }, d);
    expect(await d.store.getLatest(ID)).toEqual({ views: Number(player.videoDetails.viewCount), at: '2026-11-20T12:00:00.000Z' });
    t += 40 * 60_000;
    await handlePlayer({ url: URL_A, payload: player }, d);
    expect((await d.store.getLatest(ID))!.at).toBe('2026-11-20T13:10:00.000Z');
  });

  test('shows the new video immediately, before the channel feed arrives', async () => {
    const d = deps({ fetch: vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch });
    void handlePlayer({ url: URL_A, payload: player }, d);
    await vi.waitFor(() => expect(d.render).toHaveBeenCalled());
    const first = vi.mocked(d.render).mock.calls.at(-1)![0];
    expect(first).toMatchObject({ kind: 'ok', outlierPending: true, card: { videoId: ID } });
  });

  test('the reason from the page script is shown when player data is missing', async () => {
    const d = deps();
    await handlePlayer({ url: URL_A, payload: null, reason: 'Player data did not update for this video' }, d);
    expect(vi.mocked(d.render).mock.calls[0]![0]).toEqual({ kind: 'error', reason: 'Player data did not update for this video' });
  });

  test('an unexpected failure for an old video does not overwrite the new one', async () => {
    let url = URL_A;
    const d = deps({
      currentUrl: () => url,
      fetch: vi.fn(async () => { url = 'https://www.youtube.com/watch?v=OTHERVIDEO1'; return new Response(feedXml); }),
      // Throws after the user has already moved on to another video.
      cache: { get: () => undefined, set: () => { throw new Error('boom'); } } as unknown as Map<string, never>,
    });
    await handlePlayer({ url: URL_A, payload: player }, d);
    const states = vi.mocked(d.render).mock.calls.map((c) => c[0].kind);
    expect(states).not.toContain('error');
  });

  test('a storage failure still renders', async () => {
    const d = deps({ store: { getLatest: async () => { throw new Error('quota'); }, record: async () => { throw new Error('quota'); } } });
    await handlePlayer({ url: URL_A, payload: player }, d);
    expect(vi.mocked(d.render).mock.calls.at(-1)![0]).toMatchObject({ kind: 'ok' });
  });
});

test('the stored checklist rules are applied', async () => {
  const d = deps({ checklist: async () => normalizeChecklist({ ...DEFAULT_CHECKLIST, title: { on: false, min: 20, max: 70 } }) });
  await handlePlayer({ url: URL_A, payload: player }, d);
  const last = vi.mocked(d.render).mock.calls.at(-1)![0] as { card: { checklist: { id: string }[] } };
  expect(last.card.checklist.map((i) => i.id)).not.toContain('title');
  expect(last.card.checklist.map((i) => i.id)).toContain('tags');
});
