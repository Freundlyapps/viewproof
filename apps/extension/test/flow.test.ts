import { readFileSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import { NavigationGuard } from '../src/bridge';
import { handlePlayer } from '../src/flow';
import { memoryStore } from '../src/store';

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
    expect(d.render).toHaveBeenCalledTimes(1);
    expect(vi.mocked(d.render).mock.calls[0]![0]).toMatchObject({ kind: 'ok', card: { videoId: ID } });
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
    expect(d.render).not.toHaveBeenCalled();
  });

  test('keeps the older observation when visits are under 10 minutes apart', async () => {
    let t = Date.parse('2026-11-20T12:00:00Z');
    const d = deps({ now: () => t });
    await handlePlayer({ url: URL_A, payload: player }, d);
    t += 5 * 60_000;
    await handlePlayer({ url: URL_A, payload: player }, d);
    expect(await d.store.getLatest(ID)).toEqual({ views: Number(player.videoDetails.viewCount), at: '2026-11-20T12:00:00.000Z' });
    t += 10 * 60_000;
    await handlePlayer({ url: URL_A, payload: player }, d);
    expect((await d.store.getLatest(ID))!.at).toBe('2026-11-20T12:15:00.000Z');
  });

  test('a storage failure still renders', async () => {
    const d = deps({ store: { getLatest: async () => { throw new Error('quota'); }, record: async () => { throw new Error('quota'); } } });
    await handlePlayer({ url: URL_A, payload: player }, d);
    expect(vi.mocked(d.render).mock.calls[0]![0]).toMatchObject({ kind: 'ok' });
  });
});
