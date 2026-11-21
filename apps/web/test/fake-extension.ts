import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type KeywordSnapshot, type KeywordSuggestions, parseSearchPage } from '@viewproof/core';

/** The core fixture as the extension would store it. */
export function fixtureSnapshot(query = 'pottery wheel for beginners', capturedAt = new Date().toISOString()): KeywordSnapshot {
  const raw = JSON.parse(readFileSync(resolve(process.cwd(), '../../packages/core/test/fixtures/search-results-en.json'), 'utf8'));
  const page = parseSearchPage(raw, query);
  if ('error' in page) throw new Error(page.error);
  return { query, capturedAt, page };
}

/** Answers window messages exactly like the extension's content script on ViewProof pages. Returns a remover. */
export function fakeExtension(opts: { snapshots?: Record<string, KeywordSnapshot>; suggestions?: KeywordSuggestions | null; suggestionsError?: string | null; delayMs?: number } = {}) {
  const onMsg = (e: MessageEvent) => {
    const d = e.data as { type?: string; id?: string; q?: string };
    if (d?.type === 'viewproof:hello') window.postMessage({ type: 'viewproof:here', version: '0.2.0' }, '*');
    if (d?.type === 'viewproof:kw-request') {
      setTimeout(() => window.postMessage({
        type: 'viewproof:kw-response', id: d.id, version: '0.2.0', snapshot: opts.snapshots?.[d.q!.trim().toLowerCase().replace(/\s+/g, ' ')] ?? null,
        suggestions: opts.suggestions ?? null, suggestionsError: opts.suggestionsError ?? null,
      }, '*'), opts.delayMs ?? 0);
    }
  };
  window.addEventListener('message', onMsg);
  return { remove: () => window.removeEventListener('message', onMsg), updated: (q: string) => window.postMessage({ type: 'viewproof:kw-updated', q }, '*') };
}
