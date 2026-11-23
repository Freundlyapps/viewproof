// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { answer, isPageMessage } from '../src/app-bridge';
import { LOOKUPS_PER_HOUR, readTranscriptPanel, transcriptCapture, transcriptStore, videoLookup } from '../src/tools';

const player = JSON.parse(readFileSync(resolve(process.cwd(), '../../packages/core/test/fixtures/player-watch.json'), 'utf8'));
const ID = player.videoDetails.videoId as string;
const page = (p: unknown = player) => `<html><script>var ytInitialPlayerResponse = ${JSON.stringify(p)};var meta = 1;</script></html>`;
const H = 3_600_000;

function fakeArea() {
  const data: Record<string, unknown> = {};
  return {
    async get(key: string) { return key in data ? { [key]: structuredClone(data[key]) } : {}; },
    async set(items: Record<string, unknown>) { Object.assign(data, structuredClone(items)); },
  } as unknown as chrome.storage.StorageArea;
}

function setup(answerFn: (url: string) => Response | Promise<Response> = () => new Response(page())) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let t = Date.parse('2026-11-23T12:00:00Z');
  const l = videoLookup({ area: fakeArea(), fetch: (async (u: string, init?: RequestInit) => (calls.push({ url: u, init }), answerFn(u))) as unknown as typeof fetch, now: () => t });
  return { l, calls, tick: (ms: number) => { t += ms; } };
}

describe('videoLookup', () => {
  test('fetches the watch page without cookies and returns title, tags and description; cached 6 hours', async () => {
    const { l, calls, tick } = setup();
    const r = await l.lookup(ID);
    if (!r.ok) throw new Error(r.reason);
    expect(calls[0]!.url).toBe(`https://www.youtube.com/watch?v=${ID}&hl=en`);
    expect(calls[0]!.init?.credentials).toBe('omit');
    expect(r.video).toMatchObject({ videoId: ID, title: player.videoDetails.title, tags: player.videoDetails.keywords ?? [] });
    expect(typeof r.video.description).toBe('string');
    await l.lookup(ID);
    expect(calls).toHaveLength(1);
    tick(7 * H);
    await l.lookup(ID);
    expect(calls).toHaveLength(2);
  });

  test('a page without player data says why and does not pause', async () => {
    const { l, calls } = setup(() => new Response('<html>Before you continue to YouTube</html>'));
    expect(await l.lookup(ID)).toEqual({ ok: false, reason: "YouTube's page had no video data (it may have shown a consent or robot check). Open the video on YouTube once, then try again." });
    await l.lookup(ID);
    expect(calls).toHaveLength(2);
  });

  test('a refusal pauses lookups for 24 hours; a network error does not', async () => {
    const refused = setup(() => new Response('', { status: 429 }));
    const r = await refused.l.lookup(ID);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/^YouTube refused the request \(HTTP 429\); paused until /);
    await refused.l.lookup('aaaaaaaaaaa');
    expect(refused.calls).toHaveLength(1);
    refused.tick(25 * H);
    await refused.l.lookup('aaaaaaaaaaa');
    expect(refused.calls).toHaveLength(2);

    const offline = setup(() => { throw new TypeError('Failed to fetch'); });
    expect(await offline.l.lookup(ID)).toEqual({ ok: false, reason: "Couldn't reach YouTube (network error); try again." });
    await offline.l.lookup(ID);
    expect(offline.calls).toHaveLength(2);
  });

  test(`at most ${LOOKUPS_PER_HOUR} lookups an hour`, async () => {
    const { l, calls, tick } = setup();
    for (let i = 0; i < LOOKUPS_PER_HOUR; i++) await l.lookup(`v${String(i).padStart(10, '0')}`);
    const over = await l.lookup('zzzzzzzzzzz');
    expect(over.ok).toBe(false);
    expect(!over.ok && over.reason).toMatch(/^Lookup limit reached \(30 per hour\); try again in \d+ minutes?\.$/);
    expect(calls).toHaveLength(LOOKUPS_PER_HOUR);
    tick(H + 1);
    expect((await l.lookup('zzzzzzzzzzz')).ok).toBe(true);
  });

  test('an invalid id is refused without a request', async () => {
    const { l, calls } = setup();
    expect(await l.lookup('../x')).toEqual({ ok: false, reason: 'Not a YouTube video id.' });
    expect(calls).toHaveLength(0);
  });
});

describe('readTranscriptPanel', () => {
  const seg = (t: string, s: string) => `<ytd-transcript-segment-renderer><div class="segment-timestamp"> ${t} </div><yt-formatted-string class="segment-text">${s}</yt-formatted-string></ytd-transcript-segment-renderer>`;

  test('reads each segment with its start time', () => {
    document.body.innerHTML = `<div>${seg('0:00', 'Hello there')}${seg('1:02:05', ' and  bye ')}</div>`;
    expect(readTranscriptPanel(document)).toEqual([{ startSec: 0, text: 'Hello there' }, { startSec: 3725, text: 'and bye' }]);
  });

  test('null when there are no segments or a time cannot be read', () => {
    document.body.innerHTML = '<div>nothing</div>';
    expect(readTranscriptPanel(document)).toBeNull();
    document.body.innerHTML = seg('soon', 'x');
    expect(readTranscriptPanel(document)).toBeNull();
  });
});

describe('transcriptStore', () => {
  const t0 = Date.parse('2026-11-23T12:00:00Z');
  const item = (n: number) => ({ videoId: `v${String(n).padStart(10, '0')}`, title: `T${n}`, segments: [{ startSec: 0, text: 'a' }] });

  test('newest first, one entry per video, at most 20', async () => {
    const s = transcriptStore(fakeArea());
    for (let i = 0; i < 22; i++) await s.put(item(i), t0 + i);
    await s.put({ ...item(21), title: 'again' }, t0 + 100);
    const list = await s.list(t0 + 200);
    expect(list).toHaveLength(20);
    expect(list[0]).toMatchObject({ videoId: item(21).videoId, title: 'again', savedAt: t0 + 100 });
    expect(list.some((x) => x.videoId === item(0).videoId)).toBe(false);
  });

  test('entries older than 30 days drop out', async () => {
    const s = transcriptStore(fakeArea());
    await s.put(item(1), t0);
    expect(await s.list(t0 + 31 * 24 * H)).toEqual([]);
  });
});

describe('bridge', () => {
  const self = {} as Window;
  const ev = (data: unknown) => ({ source: self, origin: 'http://localhost:8787', data }) as unknown as MessageEvent;
  const base = { version: '1', getSnapshot: async () => null, suggest: async () => ({ ok: false as const, reason: '' }) };

  test('accepts video and transcript requests of the right shape only', () => {
    expect(isPageMessage(ev({ type: 'viewproof:video-request', id: '1', videoId: ID }), self, 'http://localhost:8787')).toBe(true);
    expect(isPageMessage(ev({ type: 'viewproof:video-request', id: '1', videoId: 'x'.repeat(300) }), self, 'http://localhost:8787')).toBe(false);
    expect(isPageMessage(ev({ type: 'viewproof:transcripts-request', id: '2' }), self, 'http://localhost:8787')).toBe(true);
    expect(isPageMessage(ev({ type: 'viewproof:transcripts-request' }), self, 'http://localhost:8787')).toBe(false);
  });

  test('answers through the lookup and the store', async () => {
    const video = { ok: false as const, reason: 'nope' };
    const items = [{ videoId: ID, title: 't', savedAt: 1, segments: [] }];
    const deps = { ...base, lookupVideo: async () => video, transcripts: async () => items };
    expect(await answer({ type: 'viewproof:video-request', id: '1', videoId: ID }, deps)).toEqual({ type: 'viewproof:video-response', id: '1', result: video });
    expect(await answer({ type: 'viewproof:transcripts-request', id: '2' }, deps)).toEqual({ type: 'viewproof:transcripts-response', id: '2', items });
  });
});

describe('transcriptCapture', () => {
  const a = [{ startSec: 0, text: 'old' }, { startSec: 5, text: 'video' }];
  const b = [{ startSec: 0, text: 'new' }, { startSec: 4, text: 'one' }];

  test('saves once the content is new and stable for two checks; never twice', () => {
    const c = transcriptCapture();
    c.reset(null);
    expect(c.tick(null)).toBeNull();
    expect(c.tick(b)).toBeNull();
    expect(c.tick(b)).toEqual(b);
    expect(c.tick(b)).toBeNull();
  });

  test('a panel left over from the previous video is never saved', () => {
    const c = transcriptCapture();
    c.reset(a);
    expect(c.tick(a)).toBeNull();
    expect(c.tick(a)).toBeNull();
    expect(c.tick(b)).toBeNull();
    expect(c.tick(b)).toEqual(b);
  });

  test('still loading (content changes between checks) waits', () => {
    const c = transcriptCapture();
    c.reset(null);
    expect(c.tick(a.slice(0, 1))).toBeNull();
    expect(c.tick(a)).toBeNull();
    expect(c.tick(a)).toEqual(a);
  });
});
