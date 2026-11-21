import { answer, isPageMessage, type ExtensionMessage } from '../src/app-bridge';
import { SEARCH_KEY, changedQueries, searchStore } from '../src/search';
import type { SuggestResult } from '../src/suggest';
import { appMatches } from '../src/app-origins';

/**
 * Runs only on ViewProof's own pages. Hands the web app the keyword snapshots this browser read on YouTube
 * and YouTube's suggestions. Nothing is sent anywhere else.
 */
export default defineContentScript({
  matches: appMatches(import.meta.env.DEV),
  runAt: 'document_start',
  main() {
    const store = searchStore(browser.storage.local);
    const version = browser.runtime.getManifest().version;
    const post = (m: ExtensionMessage) => window.postMessage(m, location.origin);
    const deps = {
      version,
      getSnapshot: (q: string) => store.get(q, Date.now()),
      suggest: async (q: string): Promise<SuggestResult> => {
        try {
          return ((await browser.runtime.sendMessage({ kind: 'suggest', q })) as SuggestResult | undefined) ?? { ok: false, reason: 'The extension did not answer' };
        } catch (e) {
          return { ok: false, reason: e instanceof Error ? e.message : 'The extension did not answer' };
        }
      },
    };
    window.addEventListener('message', (e) => {
      if (!isPageMessage(e, window, location.origin)) return;
      void answer(e.data, deps).then(post);
    });
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[SEARCH_KEY]) return;
      for (const q of changedQueries(changes[SEARCH_KEY].oldValue as never, changes[SEARCH_KEY].newValue as never)) post({ type: 'viewproof:kw-updated', q });
    });
  },
});
