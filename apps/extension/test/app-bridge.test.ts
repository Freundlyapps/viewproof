import { describe, expect, test } from 'vitest';
import { answer, isPageMessage } from '../src/app-bridge';

const self = {} as Window;
const ev = (data: unknown, over: Partial<MessageEvent> = {}) => ({ source: self, origin: 'http://localhost:8787', data, ...over }) as unknown as MessageEvent;

describe('app bridge', () => {
  test('ignores other windows and other origins', () => {
    const msg = { type: 'viewproof:kw-request', id: '1', q: 'x' };
    expect(isPageMessage(ev(msg), self, 'http://localhost:8787')).toBe(true);
    expect(isPageMessage(ev(msg, { origin: 'https://evil.example' }), self, 'http://localhost:8787')).toBe(false);
    expect(isPageMessage(ev(msg, { source: {} as Window }), self, 'http://localhost:8787')).toBe(false);
    expect(isPageMessage(ev({ type: 'viewproof:kw-request', id: 1 }), self, 'http://localhost:8787')).toBe(false);
    expect(isPageMessage(ev({ type: 'viewproof:hello' }), self, 'http://localhost:8787')).toBe(true);
    expect(isPageMessage(ev({ type: 'viewproof:kw-response', id: '1' }), self, 'http://localhost:8787')).toBe(false);
  });

  test('answers kw-request with snapshot and suggestions', async () => {
    const snapshot = { query: 'x', capturedAt: 't', page: { query: 'x', results: [], shortsShelves: 0, estimatedResults: null } };
    const r = await answer({ type: 'viewproof:kw-request', id: '7', q: 'X' }, {
      version: '0.2.0', getSnapshot: async (q) => (q === 'X' ? snapshot : null), suggest: async () => ({ ok: false, reason: 'paused' }),
    });
    expect(r).toEqual({ type: 'viewproof:kw-response', id: '7', version: '0.2.0', snapshot, suggestions: null, suggestionsError: 'paused' });
    expect(await answer({ type: 'viewproof:hello' }, { version: '0.2.0', getSnapshot: async () => null, suggest: async () => ({ ok: false, reason: '' }) })).toEqual({ type: 'viewproof:here', version: '0.2.0' });
  });
});
