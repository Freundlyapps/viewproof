import type { SuggestResult } from './suggest';

/**
 * runtime.onMessage handler for `suggest`: answers through sendResponse and returns true to keep the channel open
 * (works on every MV3 browser, unlike returning a Promise). Messages from other extensions are ignored.
 */
export function handleSuggestMessage(
  msg: unknown, sender: { id?: string }, sendResponse: (r: SuggestResult) => void,
  deps: { id: string; suggest: (q: string) => Promise<SuggestResult> },
): boolean {
  if (sender.id !== deps.id) return false;
  const m = msg as { kind?: string; q?: unknown } | null;
  if (m?.kind !== 'suggest' || typeof m.q !== 'string') return false;
  void deps.suggest(m.q).then(sendResponse, (e: unknown) => sendResponse({ ok: false, reason: e instanceof Error ? e.message : 'Suggestion lookup failed' }));
  return true;
}
