import { describe, expect, test, vi } from 'vitest';
import { appMatches } from '../src/app-origins';
import { handleSuggestMessage } from '../src/background-handler';
import { suggester } from '../src/suggest';

function fakeArea() {
  const data: Record<string, unknown> = {};
  return {
    async get(key: string) { return key in data ? { [key]: structuredClone(data[key]) } : {}; },
    async set(items: Record<string, unknown>) { Object.assign(data, structuredClone(items)); },
  } as unknown as chrome.storage.StorageArea;
}

describe('review fixes', () => {
  test('localhost pages get the bridge only in development builds', () => {
    expect(appMatches(false)).toEqual(['https://viewproof.app/*']);
    expect(appMatches(true)).toEqual(['https://viewproof.app/*', 'http://localhost:8787/*', 'http://localhost:5173/*']);
  });

  test('background answers through sendResponse and keeps the channel open', async () => {
    const sendResponse = vi.fn();
    const keep = handleSuggestMessage({ kind: 'suggest', q: 'kiln' }, { id: 'me' }, sendResponse, { id: 'me', suggest: async () => ({ ok: false, reason: 'x' }) });
    expect(keep).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: false, reason: 'x' }));
    expect(handleSuggestMessage({ kind: 'suggest', q: 'kiln' }, { id: 'other' }, sendResponse, { id: 'me', suggest: async () => ({ ok: false, reason: 'x' }) })).toBe(false);
    expect(handleSuggestMessage({ kind: 'other' }, { id: 'me' }, sendResponse, { id: 'me', suggest: async () => ({ ok: false, reason: 'x' }) })).toBe(false);
  });

  test('a network error does not pause suggestions', async () => {
    let fail = true;
    const text = 'window.google.ac.h(["kiln",[["kiln firing",0,[512]]],{"k":1}])';
    const s = suggester({ area: fakeArea(), fetch: (async () => { if (fail) throw new TypeError('Failed to fetch'); return new Response(text); }) as unknown as typeof fetch, now: () => Date.parse('2026-11-21T12:00:00Z') });
    expect(await s.suggest('kiln')).toEqual({ ok: false, reason: "Couldn't reach YouTube's suggestions (network error); try again." });
    fail = false;
    expect((await s.suggest('kiln')).ok).toBe(true);
  });
});
