import type { PoolObservation } from '@viewproof/core';
import { describe, expect, test } from 'vitest';
import { MAX_QUEUE, POOL_KEY, poolStore } from '../src/pool';
import { answer, isPageMessage } from '../src/app-bridge';

function fakeArea() {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (k: string) => (k in data ? { [k]: structuredClone(data[k]) } : {}),
    set: async (o: Record<string, unknown>) => { Object.assign(data, structuredClone(o)); },
  } as unknown as chrome.storage.StorageArea & { data: Record<string, unknown> };
}
const NOW = Date.parse('2026-11-22T12:00:00Z');
const o = (id: string, views = 100): PoolObservation => ({
  videoId: id.padEnd(11, 'x'), channelId: 'UCpppppppppppppppppppppp', title: `T ${id}`, views, publishedAt: null, ageDays: 2, durationSec: null, format: 'unknown', source: 'search', observedAt: new Date(NOW).toISOString(),
});
const SERVER = 'http://localhost:8787';
function server(reply: (body: unknown) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return reply(JSON.parse(String(init.body))); }) as unknown as typeof fetch;
  return { calls, fetchFn };
}
const ok = (accepted: number, rejected = 0, reasons: string[] = []) => new Response(JSON.stringify({ accepted, rejected, reasons }), { status: 200 });

describe('pool contribution', () => {
  test('consent gates: nothing queued without consent and a link; switching off clears the queue', async () => {
    const area = fakeArea();
    const p = poolStore(area);
    expect(await p.enqueue([o('a')])).toBe(0);
    await p.link('tok', SERVER, NOW);
    expect(await p.enqueue([o('a')])).toBe(0); // linked, but no consent yet
    await p.setConsent(true);
    expect(await p.enqueue([o('a'), o('b')])).toBe(2);
    await p.setConsent(false);
    expect((await p.get()).queue).toEqual([]);
    expect(await p.enqueue([o('c')])).toBe(0);
    const s = server(() => ok(1));
    expect(await p.flush(s.fetchFn, NOW)).toBe('idle');
    expect(s.calls).toHaveLength(0);
  });

  test('flush sends one batch with the token and logs what was shared', async () => {
    const p = poolStore(fakeArea());
    await p.link('tok-123', SERVER, NOW);
    await p.setConsent(true);
    await p.enqueue([o('a', 5), o('b', 7)]);
    await p.enqueue([o('a', 5)]); // same video, same count: not queued twice
    const s = server(() => ok(2));
    expect(await p.flush(s.fetchFn, NOW)).toBe('sent');
    expect(s.calls[0]!.url).toBe(`${SERVER}/api/pool/contribute`);
    expect((s.calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer tok-123');
    expect(s.calls[0]!.init.credentials).toBe('omit');
    expect(JSON.parse(String(s.calls[0]!.init.body))).toMatchObject({ v: 1, observations: [{ videoId: 'axxxxxxxxxx' }, { videoId: 'bxxxxxxxxxx' }] });
    const st = await p.get();
    expect(st.queue).toEqual([]);
    expect(st.log[0]).toMatchObject({ at: new Date(NOW).toISOString(), sent: 2, accepted: 2, rejected: 0, error: null, videos: [{ videoId: 'axxxxxxxxxx', title: 'T a', views: 5, source: 'search' }, { videoId: 'bxxxxxxxxxx', title: 'T b', views: 7, source: 'search' }] });
  });

  test('401 unlinks and stops; 403 pauses', async () => {
    const p = poolStore(fakeArea());
    await p.link('tok', SERVER, NOW);
    await p.setConsent(true);
    await p.enqueue([o('a')]);
    const r = await p.flush(server(() => new Response(JSON.stringify({ error: 'signed_out', message: 'This browser is not linked.' }), { status: 401 })).fetchFn, NOW);
    expect(r).toBe('unlinked');
    const st = await p.get();
    expect(st).toMatchObject({ token: null, queue: [], statusNote: 'This browser is not linked.' });
    expect(await p.enqueue([o('b')])).toBe(0);

    const q = poolStore(fakeArea());
    await q.link('tok', SERVER, NOW);
    await q.setConsent(true);
    await q.enqueue([o('a')]);
    expect(await q.flush(server(() => new Response(JSON.stringify({ error: 'limit', message: 'Contribution paused: too much data was rejected.' }), { status: 403 })).fetchFn, NOW)).toBe('paused');
    expect(await q.get()).toMatchObject({ paused: true, queue: [], statusNote: 'Contribution paused: too much data was rejected.' });
    expect(await q.enqueue([o('b')])).toBe(0);
  });

  test('network error and 429 keep the queue', async () => {
    const p = poolStore(fakeArea());
    await p.link('tok', SERVER, NOW);
    await p.setConsent(true);
    await p.enqueue([o('a')]);
    expect(await p.flush((async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch, NOW)).toBe('error');
    expect((await p.get()).queue).toHaveLength(1);
    expect(await p.flush(server(() => new Response(JSON.stringify({ error: 'limit', message: 'More tomorrow.' }), { status: 429 })).fetchFn, NOW)).toBe('error');
    const st = await p.get();
    expect(st.queue).toHaveLength(1);
    expect(st.log[0]!.error).toBe('More tomorrow.');
  });

  test('queue cap drops the oldest; batches are at most 300', async () => {
    const p = poolStore(fakeArea());
    await p.link('tok', SERVER, NOW);
    await p.setConsent(true);
    await p.enqueue(Array.from({ length: MAX_QUEUE + 5 }, (_, i) => o(`v${i}`)));
    const st = await p.get();
    expect(st.queue).toHaveLength(MAX_QUEUE);
    expect(st.queue[0]!.videoId).toBe('v5'.padEnd(11, 'x'));
    const s = server((b) => ok((b as { observations: unknown[] }).observations.length));
    await p.flush(s.fetchFn, NOW);
    expect(JSON.parse(String(s.calls[0]!.init.body)).observations).toHaveLength(300);
    expect((await p.get()).queue).toHaveLength(MAX_QUEUE - 300);
  });

  test('unlink and clear log', async () => {
    const area = fakeArea();
    const p = poolStore(area);
    await p.link('tok', SERVER, NOW);
    await p.setConsent(true);
    await p.enqueue([o('a')]);
    await p.flush(server(() => ok(1)).fetchFn, NOW);
    await p.clearLog();
    expect((await p.get()).log).toEqual([]);
    await p.unlink();
    expect(await p.get()).toMatchObject({ token: null, server: null, queue: [] });
    expect(JSON.stringify(area.data[POOL_KEY])).not.toContain('"tok"');
  });
});

describe('link message from the web app', () => {
  const self = {} as Window;
  const ev = (data: unknown, origin = 'http://localhost:8787') => ({ source: self, origin, data }) as unknown as MessageEvent;
  test('accepted only from the page itself, with a token', () => {
    expect(isPageMessage(ev({ type: 'viewproof:link', id: '1', token: 'a'.repeat(43) }), self, 'http://localhost:8787')).toBe(true);
    expect(isPageMessage(ev({ type: 'viewproof:link', id: '1', token: 'a'.repeat(43) }, 'https://evil.example'), self, 'http://localhost:8787')).toBe(false);
    expect(isPageMessage(ev({ type: 'viewproof:link', id: '1', token: 5 }), self, 'http://localhost:8787')).toBe(false);
    expect(isPageMessage(ev({ type: 'viewproof:link', id: '1', token: 'short' }), self, 'http://localhost:8787')).toBe(false);
  });
  test('stores the token with the page origin as the server', async () => {
    const links: [string, string][] = [];
    const r = await answer({ type: 'viewproof:link', id: '9', token: 'a'.repeat(43) }, {
      version: '0.3.0', origin: 'http://localhost:8787', getSnapshot: async () => null, suggest: async () => ({ ok: false, reason: '' }),
      link: async (t, s) => { links.push([t, s]); },
    });
    expect(links).toEqual([['a'.repeat(43), 'http://localhost:8787']]);
    expect(r).toEqual({ type: 'viewproof:linked', id: '9' });
  });
});

describe('review fixes', () => {
  const slow = (reply: () => Response | Promise<Response>) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const fetchFn = (async () => { await gate; return reply(); }) as unknown as typeof fetch;
    return { fetchFn, release: () => release() };
  };

  test('I1: "Stop sharing" during a failing send stays stopped', async () => {
    const p = poolStore(fakeArea());
    await p.link('tok', SERVER, NOW);
    await p.setConsent(true);
    await p.enqueue([o('a')]);
    const s = slow(() => new Response('{"error":"x","message":"Server error"}', { status: 500 }));
    const running = p.flush(s.fetchFn, NOW);
    await new Promise((r) => setTimeout(r, 0));
    await p.setConsent(false);
    s.release();
    await running;
    expect(await p.get()).toMatchObject({ consent: false, queue: [] });
  });

  test('I1: "Unlink" during a send stays unlinked', async () => {
    const p = poolStore(fakeArea());
    await p.link('tok', SERVER, NOW);
    await p.setConsent(true);
    await p.enqueue([o('a')]);
    const s = slow(() => { throw new TypeError('Failed to fetch'); });
    const running = p.flush(s.fetchFn, NOW);
    await new Promise((r) => setTimeout(r, 0));
    await p.unlink();
    s.release();
    await running;
    expect(await p.get()).toMatchObject({ token: null, server: null, queue: [] });
  });

  test('two flushes at once send once and lose nothing', async () => {
    const p = poolStore(fakeArea());
    await p.link('tok', SERVER, NOW);
    await p.setConsent(true);
    await p.enqueue([o('a'), o('b')]);
    let calls = 0;
    const s = slow(() => { calls++; return ok(2); });
    const one = p.flush(s.fetchFn, NOW);
    const two = p.flush(s.fetchFn, NOW);
    await new Promise((r) => setTimeout(r, 0));
    await p.enqueue([o('c')]);
    s.release();
    expect(await two).toBe('idle');
    await one;
    expect(calls).toBe(1);
    expect((await p.get()).queue.map((q) => q.videoId)).toEqual(['cxxxxxxxxxx']);
  });
});
