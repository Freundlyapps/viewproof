import type { KeywordSuggestions } from '@viewproof/core';
import type { Snapshot } from './search';
import type { SuggestResult } from './suggest';
import type { StoredTranscript, VideoLookupResult } from './tools';

/** Window messages between the ViewProof web app and the extension's content script on ViewProof's own origins. */
export type PageMessage =
  | { type: 'viewproof:hello' }
  | { type: 'viewproof:kw-request'; id: string; q: string }
  /** Link this browser to the account signed in on this page (plan 5b). The server is the page's own origin. */
  | { type: 'viewproof:link'; id: string; token: string }
  /** Tools page (plan 8): tags and description of a video; transcripts this browser read on YouTube. */
  | { type: 'viewproof:video-request'; id: string; videoId: string }
  | { type: 'viewproof:transcripts-request'; id: string };
export type ExtensionMessage =
  | { type: 'viewproof:here'; version: string }
  | { type: 'viewproof:kw-response'; id: string; version: string; snapshot: Snapshot | null; suggestions: KeywordSuggestions | null; suggestionsError: string | null }
  | { type: 'viewproof:kw-updated'; q: string }
  | { type: 'viewproof:linked'; id: string }
  | { type: 'viewproof:video-response'; id: string; result: VideoLookupResult }
  | { type: 'viewproof:transcripts-response'; id: string; items: StoredTranscript[] };

/** Only requests from this very page (same window, same origin) are answered. */
export function isPageMessage(e: MessageEvent, self: Window, origin: string): e is MessageEvent<PageMessage> {
  if (e.source !== self || e.origin !== origin) return false;
  const d = e.data as Record<string, unknown> | null;
  if (!d || typeof d !== 'object') return false;
  if (d.type === 'viewproof:hello') return true;
  if (d.type === 'viewproof:video-request') return typeof d.id === 'string' && typeof d.videoId === 'string' && d.videoId.length <= 20;
  if (d.type === 'viewproof:transcripts-request') return typeof d.id === 'string';
  if (d.type === 'viewproof:link') return typeof d.id === 'string' && typeof d.token === 'string' && /^[\w-]{20,100}$/.test(d.token);
  return d.type === 'viewproof:kw-request' && typeof d.id === 'string' && typeof d.q === 'string' && d.q.length <= 200;
}

export async function answer(
  msg: PageMessage,
  deps: {
    version: string; getSnapshot: (q: string) => Promise<Snapshot | null>; suggest: (q: string) => Promise<SuggestResult>;
    origin?: string; link?: (token: string, server: string) => Promise<void>;
    lookupVideo?: (videoId: string) => Promise<VideoLookupResult>; transcripts?: () => Promise<StoredTranscript[]>;
  },
): Promise<ExtensionMessage> {
  if (msg.type === 'viewproof:hello') return { type: 'viewproof:here', version: deps.version };
  if (msg.type === 'viewproof:link') {
    // Never a server named in the message: only the origin of the ViewProof page that asked.
    if (!deps.link || !deps.origin) throw new Error('linking not available here');
    await deps.link(msg.token, deps.origin);
    return { type: 'viewproof:linked', id: msg.id };
  }
  if (msg.type === 'viewproof:video-request') {
    const result = deps.lookupVideo ? await deps.lookupVideo(msg.videoId) : { ok: false as const, reason: 'Update the ViewProof extension to use this tool.' };
    return { type: 'viewproof:video-response', id: msg.id, result };
  }
  if (msg.type === 'viewproof:transcripts-request') return { type: 'viewproof:transcripts-response', id: msg.id, items: deps.transcripts ? await deps.transcripts() : [] };
  const [snapshot, s] = await Promise.all([deps.getSnapshot(msg.q), deps.suggest(msg.q)]);
  return { type: 'viewproof:kw-response', id: msg.id, version: deps.version, snapshot, suggestions: s.ok ? s.suggestions : null, suggestionsError: s.ok ? null : s.reason };
}
