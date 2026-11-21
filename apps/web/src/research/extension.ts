import type { KeywordSnapshot, KeywordSuggestions } from '@viewproof/core';

export type ExtensionAnswer =
  | { installed: false }
  | { installed: true; version: string; snapshot: KeywordSnapshot | null; suggestions: KeywordSuggestions | null; suggestionsError: string | null };

const fromExtension = (e: MessageEvent) => e.origin === location.origin && !!e.data && typeof e.data === 'object';
let seq = 0;

/** Wait for one message from the extension matching `want`, or null after the timeout. */
function waitFor<T>(want: (d: any) => boolean, timeoutMs: number, send: () => void): Promise<T | null> {
  return new Promise((resolve) => {
    const done = (v: T | null) => { window.removeEventListener('message', onMsg); clearTimeout(timer); resolve(v); };
    const onMsg = (e: MessageEvent) => { if (fromExtension(e) && want(e.data)) done(e.data as T); };
    const timer = setTimeout(() => done(null), timeoutMs);
    window.addEventListener('message', onMsg);
    send();
  });
}

/**
 * Ask the ViewProof extension (its content script on this page) for what this browser read on YouTube for a keyword.
 * "Installed" is decided by a quick hello; the keyword answer may take longer (YouTube's suggestions are fetched first).
 */
export async function askExtension(q: string, helloMs = 1500, answerMs = 20_000): Promise<ExtensionAnswer> {
  const here = await waitFor<{ version: string }>((d) => d.type === 'viewproof:here', helloMs, () => window.postMessage({ type: 'viewproof:hello' }, location.origin));
  if (!here) return { installed: false };
  const id = `kw${++seq}-${Date.now()}`;
  const d = await waitFor<Extract<ExtensionAnswer, { installed: true }>>((m) => m.type === 'viewproof:kw-response' && m.id === id, answerMs,
    () => window.postMessage({ type: 'viewproof:kw-request', id, q }, location.origin));
  if (!d) return { installed: true, version: here.version, snapshot: null, suggestions: null, suggestionsError: 'The extension did not answer in time; reload the page to try again.' };
  return { installed: true, version: d.version, snapshot: d.snapshot ?? null, suggestions: d.suggestions ?? null, suggestionsError: d.suggestionsError ?? null };
}

/** Called when the extension reads a new YouTube search (the user searched in another tab). */
export function onKeywordUpdated(cb: (q: string) => void): () => void {
  const onMsg = (e: MessageEvent) => {
    if (fromExtension(e) && e.data.type === 'viewproof:kw-updated' && typeof e.data.q === 'string') cb(e.data.q);
  };
  window.addEventListener('message', onMsg);
  return () => window.removeEventListener('message', onMsg);
}
