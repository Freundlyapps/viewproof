import { isPlayerMessage, NavigationGuard } from '../src/bridge';
import { handlePlayer } from '../src/flow';
import { type PanelState, renderPanel } from '../src/panel';
import { chromeStore } from '../src/store';
import { isSearchMessage, searchStore } from '../src/search';

const HOST_ID = 'viewproof-panel';
const MOUNT_WAIT_MS = 10_000;

/** Isolated world: turns the page's player data into the ViewProof panel. Talks only to youtube.com. */
export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  runAt: 'document_idle',
  main() {
    const deps = {
      guard: new NavigationGuard(),
      store: chromeStore(browser.storage.local),
      cache: new Map(),
      fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
      now: () => Date.now(),
      currentUrl: () => location.href,
      render: (state: PanelState) => void mount().then((host) => host && renderPanel(host, state)),
    };

    // Searches the user makes on YouTube are kept in this browser so the ViewProof web app can show their facts.
    const searches = searchStore(browser.storage.local);
    window.addEventListener('message', (e) => {
      if (!isSearchMessage(e, window, location.origin)) return;
      void searches.save(e.data.url, e.data.response, Date.now()).then((r) => {
        if (typeof r === 'object') console.warn('[ViewProof]', r.error);
      });
    });

    window.addEventListener('message', (e) => {
      if (!isPlayerMessage(e, window, location.origin)) return;
      void handlePlayer(e.data, deps); // handles its own errors, and only for the current video
    });

    // The moment navigation starts, the old video's numbers must go.
    document.addEventListener('yt-navigate-start', () => {
      const host = document.getElementById(HOST_ID);
      if (host) renderPanel(host, { kind: 'loading' });
    });

    // Hide the panel on pages that are not videos.
    document.addEventListener('yt-navigate-finish', () => {
      const host = document.getElementById(HOST_ID);
      if (host) host.style.display = location.pathname === '/watch' ? '' : 'none';
    });
  },
});

/** Find or create the panel host at the top of the right-hand column. */
function mount(): Promise<HTMLElement | null> {
  const attach = (): HTMLElement | null => {
    const column = document.querySelector('#secondary');
    if (!column) return null;
    let host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = HOST_ID;
    }
    if (host.parentElement !== column) column.prepend(host);
    host.style.display = '';
    return host;
  };
  const now = attach();
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const obs = new MutationObserver(() => {
      const h = attach();
      if (h) { obs.disconnect(); resolve(h); }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { obs.disconnect(); resolve(null); }, MOUNT_WAIT_MS);
  });
}
