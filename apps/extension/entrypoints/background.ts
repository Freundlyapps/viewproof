import { handleSuggestMessage } from '../src/background-handler';
import { poolStore } from '../src/pool';
import { suggester } from '../src/suggest';
import { videoLookup } from '../src/tools';

const FLUSH_ALARM = 'pool-flush';

/**
 * Fetches YouTube's own autocomplete and video pages (Tools) for the ViewProof web app (content scripts can't make those cross-origin requests),
 * and sends opted-in pool observations to the linked ViewProof server every 5 minutes.
 */
export default defineBackground(() => {
  const s = suggester({ area: browser.storage.local, fetch: (i, init) => fetch(i, init), now: () => Date.now() });
  const pool = poolStore(browser.storage.local);
  const videos = videoLookup({ area: browser.storage.local, fetch: (i, init) => fetch(i, init), now: () => Date.now() });
  const flush = () => pool.flush((i, init) => fetch(i, init), Date.now()).catch((e: unknown) => console.warn('[ViewProof] pool', e));

  // Create once: re-creating on every service-worker wake-up would keep pushing the next send back.
  void browser.alarms.get(FLUSH_ALARM).then((a) => { if (!a) void browser.alarms.create(FLUSH_ALARM, { periodInMinutes: 5 }); });
  browser.alarms.onAlarm.addListener((a) => { if (a.name === FLUSH_ALARM) void flush(); });

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id) return false;
    const kind = (msg as { kind?: string } | null)?.kind;
    if (kind === 'pool-flush') { void flush(); return false; }
    if (kind === 'open-options') { void browser.runtime.openOptionsPage(); return false; }
    if (kind === 'video-lookup') {
      const videoId = (msg as { videoId?: unknown }).videoId;
      if (typeof videoId !== 'string') return false;
      void videos.lookup(videoId).then(sendResponse, (e: unknown) => sendResponse({ ok: false, reason: e instanceof Error ? e.message : 'Lookup failed' }));
      return true;
    }
    return handleSuggestMessage(msg, sender, sendResponse as (r: unknown) => void, { id: browser.runtime.id, suggest: (q) => s.suggest(q) });
  });
});
