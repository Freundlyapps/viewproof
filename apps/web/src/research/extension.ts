import type { KeywordSnapshot, KeywordSuggestions } from '@viewproof/core';

export type ExtensionAnswer =
  | { installed: false }
  | { installed: true; version: string; snapshot: KeywordSnapshot | null; suggestions: KeywordSuggestions | null; suggestionsError: string | null };

const fromExtension = (e: MessageEvent) => e.origin === location.origin && !!e.data && typeof e.data === 'object';
let seq = 0;

/**
 * Ask the ViewProof extension (its content script on this page) for what this browser read on YouTube for a keyword.
 * No answer within the timeout means the extension isn't installed (or not enabled for this site).
 */
export function askExtension(q: string, timeoutMs = 1500): Promise<ExtensionAnswer> {
  const id = `kw${++seq}-${Date.now()}`;
  return new Promise((resolve) => {
    const done = (a: ExtensionAnswer) => { window.removeEventListener('message', onMsg); clearTimeout(timer); resolve(a); };
    const onMsg = (e: MessageEvent) => {
      if (!fromExtension(e) || e.data.type !== 'viewproof:kw-response' || e.data.id !== id) return;
      const d = e.data as Extract<ExtensionAnswer, { installed: true }>;
      done({ installed: true, version: d.version, snapshot: d.snapshot ?? null, suggestions: d.suggestions ?? null, suggestionsError: d.suggestionsError ?? null });
    };
    const timer = setTimeout(() => done({ installed: false }), timeoutMs);
    window.addEventListener('message', onMsg);
    window.postMessage({ type: 'viewproof:kw-request', id, q }, location.origin);
  });
}

/** Called when the extension reads a new YouTube search (the user searched in another tab). */
export function onKeywordUpdated(cb: (q: string) => void): () => void {
  const onMsg = (e: MessageEvent) => {
    if (fromExtension(e) && e.data.type === 'viewproof:kw-updated' && typeof e.data.q === 'string') cb(e.data.q);
  };
  window.addEventListener('message', onMsg);
  return () => window.removeEventListener('message', onMsg);
}
