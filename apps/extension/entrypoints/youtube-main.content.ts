import { MSG, type PlayerMessage, readPlayer } from '../src/bridge';
import { SEARCH_MSG, type SearchMessage } from '../src/search';

/**
 * Runs in the page's own JS world (MAIN) only to read the player and search-results data YouTube
 * already loaded for this page. Makes no requests; reads no cookies.
 */
export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  world: 'MAIN',
  runAt: 'document_idle',
  main() {
    let seq = 0;
    const RETRIES = 10;
    const DELAY_MS = 300;

    const get = (): unknown => {
      const player = document.getElementById('movie_player') as (HTMLElement & { getPlayerResponse?: () => unknown }) | null;
      return player?.getPlayerResponse?.();
    };

    const publish = (attempt = 0, mySeq = ++seq) => {
      if (location.pathname !== '/watch') return;
      const wanted = new URLSearchParams(location.search).get('v');
      const read = readPlayer(get, wanted);
      // Player data lags the URL after in-app navigation; wait for it to catch up.
      if (read.payload === null && attempt < RETRIES) {
        setTimeout(() => mySeq === seq && publish(attempt + 1, mySeq), DELAY_MS);
        return;
      }
      const msg: PlayerMessage = { type: MSG, seq: mySeq, url: location.href, ...read };
      window.postMessage(msg, location.origin);
    };

    document.addEventListener('yt-navigate-finish', () => publish());
    publish();

    // Search results: the first page load carries ytInitialData; in-app searches carry the response on the event.
    const postSearch = (response: unknown) => {
      if (location.pathname !== '/results' || !response) return;
      const msg: SearchMessage = { type: SEARCH_MSG, url: location.href, response };
      window.postMessage(msg, location.origin);
    };
    document.addEventListener('yt-navigate-finish', (e) => {
      const d = (e as CustomEvent<{ response?: { response?: unknown } }>).detail?.response;
      postSearch(d?.response ?? d);
    });
    postSearch((window as unknown as { ytInitialData?: unknown }).ytInitialData);
  },
});
