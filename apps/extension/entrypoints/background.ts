import { suggester } from '../src/suggest';

/**
 * Fetches YouTube's own autocomplete for the ViewProof web app (content scripts can't make that cross-origin request).
 * Only `suggest` messages from this extension's own content scripts are handled.
 */
export default defineBackground(() => {
  const s = suggester({ area: browser.storage.local, fetch: (i, init) => fetch(i, init), now: () => Date.now() });
  browser.runtime.onMessage.addListener((msg: unknown, sender) => {
    if (sender.id !== browser.runtime.id) return undefined;
    const m = msg as { kind?: string; q?: unknown };
    if (m?.kind !== 'suggest' || typeof m.q !== 'string') return undefined;
    return s.suggest(m.q);
  });
});
