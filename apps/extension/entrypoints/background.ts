import { handleSuggestMessage } from '../src/background-handler';
import { poolStore } from '../src/pool';
import { suggester } from '../src/suggest';

const FLUSH_ALARM = 'pool-flush';

/**
 * Fetches YouTube's own autocomplete for the ViewProof web app (content scripts can't make that cross-origin request),
 * and sends opted-in pool observations to the linked ViewProof server every 5 minutes.
 */
export default defineBackground(() => {
  const s = suggester({ area: browser.storage.local, fetch: (i, init) => fetch(i, init), now: () => Date.now() });
  const pool = poolStore(browser.storage.local);
  const flush = () => pool.flush((i, init) => fetch(i, init), Date.now()).catch((e: unknown) => console.warn('[ViewProof] pool', e));

  browser.alarms.create(FLUSH_ALARM, { periodInMinutes: 5 });
  browser.alarms.onAlarm.addListener((a) => { if (a.name === FLUSH_ALARM) void flush(); });

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id) return false;
    const kind = (msg as { kind?: string } | null)?.kind;
    if (kind === 'pool-flush') { void flush(); return false; }
    if (kind === 'open-options') { void browser.runtime.openOptionsPage(); return false; }
    return handleSuggestMessage(msg, sender, sendResponse as (r: unknown) => void, { id: browser.runtime.id, suggest: (q) => s.suggest(q) });
  });
});
