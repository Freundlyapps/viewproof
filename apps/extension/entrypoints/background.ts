import { handleSuggestMessage } from '../src/background-handler';
import { suggester } from '../src/suggest';

/** Fetches YouTube's own autocomplete for the ViewProof web app (content scripts can't make that cross-origin request). */
export default defineBackground(() => {
  const s = suggester({ area: browser.storage.local, fetch: (i, init) => fetch(i, init), now: () => Date.now() });
  browser.runtime.onMessage.addListener((msg, sender, sendResponse) =>
    handleSuggestMessage(msg, sender, sendResponse as (r: unknown) => void, { id: browser.runtime.id, suggest: (q) => s.suggest(q) }));
});
