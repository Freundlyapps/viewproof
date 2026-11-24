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
export function fakeExtension(opts: {
  snapshots?: Record<string, KeywordSnapshot>; suggestions?: KeywordSuggestions | null; suggestionsError?: string | null; delayMs?: number;
  /** Tools: answer for a video lookup, and the transcripts this browser keeps. */
  video?: (videoId: string) => unknown; transcripts?: unknown[];
} = {}) {
  const links: string[] = [];
  const lookups: string[] = [];
  const onMsg = (e: MessageEvent) => {
    const d = e.data as { type?: string; id?: string; q?: string; token?: string; videoId?: string };
    if (d?.type === 'viewproof:video-request') {
      lookups.push(d.videoId!);
      window.postMessage({ type: 'viewproof:video-response', id: d.id, result: opts.video?.(d.videoId!) ?? { ok: false, reason: 'no fake' } }, '*');
    }
    if (d?.type === 'viewproof:transcripts-request') window.postMessage({ type: 'viewproof:transcripts-response', id: d.id, items: opts.transcripts ?? [] }, '*');
    if (d?.type === 'viewproof:link') { links.push(d.token!); window.postMessage({ type: 'viewproof:linked', id: d.id }, '*'); }
    if (d?.type === 'viewproof:hello') window.postMessage({ type: 'viewproof:here', version: '0.2.0' }, '*');
    if (d?.type === 'viewproof:kw-request') {
      setTimeout(() => window.postMessage({
        type: 'viewproof:kw-response', id: d.id, version: '0.2.0', snapshot: opts.snapshots?.[d.q!.trim().toLowerCase().replace(/\s+/g, ' ')] ?? null,
        suggestions: opts.suggestions ?? null, suggestionsError: opts.suggestionsError ?? null,
      }, '*'), opts.delayMs ?? 0);
    }
  };
  window.addEventListener('message', onMsg);
  return { links, lookups, remove: () => window.removeEventListener('message', onMsg), updated: (q: string) => window.postMessage({ type: 'viewproof:kw-updated', q }, '*') };
}
