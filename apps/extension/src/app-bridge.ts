import type { KeywordSuggestions } from '@viewproof/core';
import type { Snapshot } from './search';
import type { SuggestResult } from './suggest';

/** Window messages between the ViewProof web app and the extension's content script on ViewProof's own origins. */
export type PageMessage = { type: 'viewproof:hello' } | { type: 'viewproof:kw-request'; id: string; q: string };
export type ExtensionMessage =
  | { type: 'viewproof:here'; version: string }
  | { type: 'viewproof:kw-response'; id: string; version: string; snapshot: Snapshot | null; suggestions: KeywordSuggestions | null; suggestionsError: string | null }
  | { type: 'viewproof:kw-updated'; q: string };

/** Only requests from this very page (same window, same origin) are answered. */
export function isPageMessage(e: MessageEvent, self: Window, origin: string): e is MessageEvent<PageMessage> {
  if (e.source !== self || e.origin !== origin) return false;
  const d = e.data as Record<string, unknown> | null;
  if (!d || typeof d !== 'object') return false;
  if (d.type === 'viewproof:hello') return true;
  return d.type === 'viewproof:kw-request' && typeof d.id === 'string' && typeof d.q === 'string' && d.q.length <= 200;
}

export async function answer(
  msg: PageMessage,
  deps: { version: string; getSnapshot: (q: string) => Promise<Snapshot | null>; suggest: (q: string) => Promise<SuggestResult> },
): Promise<ExtensionMessage> {
  if (msg.type === 'viewproof:hello') return { type: 'viewproof:here', version: deps.version };
  const [snapshot, s] = await Promise.all([deps.getSnapshot(msg.q), deps.suggest(msg.q)]);
  return { type: 'viewproof:kw-response', id: msg.id, version: deps.version, snapshot, suggestions: s.ok ? s.suggestions : null, suggestionsError: s.ok ? null : s.reason };
}
