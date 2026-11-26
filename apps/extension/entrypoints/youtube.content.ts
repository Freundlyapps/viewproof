import { isPlayerMessage, NavigationGuard, type PlayerMessage } from '../src/bridge';
import { handlePlayer, idleRenderer, withChecklist } from '../src/flow';
import { type PanelState, renderPanel } from '../src/panel';
import { chromeStore } from '../src/store';
import { isSearchMessage, searchQueryOf, searchStore } from '../src/search';
import { fromSearch, fromWatch, parsePlayerResponse, parseSearchPage, type PoolObservation } from '@viewproof/core';
import { poolStore } from '../src/pool';
import { whenIdle } from '../src/idle';
import { pageScope, watchColumn } from '../src/dom';
import { applyBadges, type Badge, badgeWatcher, clearBadges } from '../src/badges';
import { channelBadges, channelCard, isChannelMessage, isChannelPath } from '../src/channel';
import { type CardModel, mountHost, placeBefore, removeHost, renderPagePanel } from '../src/page-panel';
import { factsSummary, gridOutliers, parseChannelPage, topResultsFacts } from '@viewproof/core';
import { getBaseline } from '../src/baseline';
import { searchCard, searchFeedOutliers } from '../src/search-panel';
import { badgeFor } from '../src/channel';
import { readTranscriptPanel, transcriptCapture } from '../src/tools';
import { videoIdFromUrl } from '../src/bridge';
import { DEFAULT_TOGGLES, type PanelToggles, settingsChanged, settingsStore } from '../src/settings';

/** Ask the background script to send once this many observations are queued. */
const FLUSH_AT = 50;

const HOST_ID = 'viewproof-panel';
const PAGE_HOST = 'viewproof-page-panel';
const MOUNT_WAIT_MS = 10_000;

/** Isolated world: turns the page's player data into the ViewProof panel. Talks only to youtube.com. */
export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  runAt: 'document_idle',
  main() {
    const settings = settingsStore(browser.storage.local);
    let toggles: PanelToggles = DEFAULT_TOGGLES;
    const ready = settings.getToggles().then((t) => { toggles = t; }, () => undefined);
    let lastPlayer: PlayerMessage | null = null;
    /** What the watch panel shows now; re-drawn (never re-computed) when settings change. */
    let lastState: PanelState | null = null;
    const painter = idleRenderer({ whenIdle, mount, paint: renderPanel, currentUrl: () => location.href, enabled: () => toggles.watch });

    const deps = {
      guard: new NavigationGuard(),
      store: chromeStore(browser.storage.local),
      cache: new Map(),
      fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
      now: () => Date.now(),
      currentUrl: () => location.href,
      render: (state: PanelState) => { lastState = state; painter.render(state); },
      checklist: () => settings.getChecklist(),
    };

    // Channel and search pages: one card above YouTube's list, plus ×N badges on its tiles.
    let pageSeq = 0;
    let watcher: { stop(): void } | null = null;
    let currentBadges = new Map<string, Badge>();
    let lastPage: { kind: 'channel' | 'search'; run: () => void } | null = null;
    const resetPage = () => {
      pageSeq++;
      watcher?.stop();
      watcher = null;
      currentBadges = new Map();
      clearBadges();
      removeHost(PAGE_HOST);
    };
    /** Show (or update) the card and badges, unless the user has navigated since `seq`. */
    const showPage = (seq: number, model: CardModel, badges: Map<string, Badge>, place: (h: HTMLElement) => boolean, kind: 'channel' | 'search') => {
      void whenIdle(() => (seq === pageSeq ? mountHost(PAGE_HOST, (h) => seq === pageSeq && place(h)) : null)).then((host) => {
        if (!host || seq !== pageSeq) return;
        renderPagePanel(host, model);
        currentBadges = badges;
        if (watcher) applyBadges(pageScope(kind), currentBadges);
        else watcher = badgeWatcher(() => applyBadges(pageScope(kind), currentBadges));
      });
    };
    const placeSearch = (h: HTMLElement) => placeBefore(h, document.querySelector('ytd-search:not([hidden]) ytd-section-list-renderer'));
    const placeChannel = (h: HTMLElement) => placeBefore(h, document.querySelector('ytd-browse:not([hidden]) ytd-rich-grid-renderer'));

    window.addEventListener('message', (e) => {
      if (!isChannelMessage(e, window, location.origin)) return;
      const { url, data } = e.data;
      const run = () => {
        if (!toggles.channel || new URL(url).pathname !== location.pathname || !isChannelPath(location.pathname)) return;
        const seq = pageSeq;
        const page = parseChannelPage(data);
        if ('error' in page) {
          if (page.error === 'Not a channel page') return;
          showPage(seq, { title: "This channel's videos", stats: [], lines: [], error: page.error }, new Map(), placeChannel, 'channel');
          return;
        }
        const outliers = gridOutliers(page);
        showPage(seq, channelCard(page, outliers), channelBadges(outliers), placeChannel, 'channel');
      };
      lastPage = { kind: 'channel', run };
      void ready.then(run);
    });

    // Settings changed on the options page: apply them without a reload.
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const c = settingsChanged(changes);
      if (c.toggles) {
        void settings.getToggles().then((t) => {
          const wasOn = toggles.watch;
          toggles = t;
          const host = document.getElementById(HOST_ID);
          if (!t.watch && host) host.style.display = 'none';
          if (t.watch && !wasOn && lastState && location.pathname === '/watch') painter.render(lastState);
          if (lastPage) {
            if (!t[lastPage.kind]) resetPage();
            else if (!document.getElementById(PAGE_HOST)) lastPage.run();
          }
        });
      }
      if (c.checklist && lastState && lastPlayer && location.pathname === '/watch') {
        const player = lastPlayer;
        void settings.getChecklist().then((rules) => {
          const next = lastState && withChecklist(lastState, player.payload, rules);
          if (next) deps.render(next);
        });
      }
    });

    // Opt-in pool (plan 5b): public facts of the videos on this page, queued only with consent and a linked server.
    const pool = poolStore(browser.storage.local);
    const share = (items: (PoolObservation | null)[]) => {
      const list = items.filter((x): x is PoolObservation => x !== null);
      void pool.enqueue(list).then((n) => { if (n >= FLUSH_AT) void browser.runtime.sendMessage({ kind: 'pool-flush' }).catch(() => undefined); });
    };

    // Searches the user makes on YouTube are kept in this browser so the ViewProof web app can show their facts.
    const searches = searchStore(browser.storage.local);
    window.addEventListener('message', (e) => {
      if (!isSearchMessage(e, window, location.origin)) return;
      void searches.save(e.data.url, e.data.response, Date.now()).then((r) => {
        if (typeof r === 'object') console.warn('[ViewProof]', r.error);
      });
      const q = searchQueryOf(e.data.url);
      const page = q ? parseSearchPage(e.data.response, q) : null;
      if (page && !('error' in page)) share(page.results.map((r) => fromSearch(r, new Date().toISOString())));
      const { url, response } = e.data;
      const run = () => {
        if (!toggles.search || url !== location.href) return;
        const query = searchQueryOf(url) ?? new URL(url).searchParams.get('search_query') ?? '';
        const p = parseSearchPage(response, query);
        const seq = pageSeq;
        if ('error' in p) {
          showPage(seq, { title: `What ranks for "${query}"`, stats: [], lines: [], error: p.error }, new Map(), placeSearch, 'search');
          return;
        }
        const facts = topResultsFacts(p);
        const summary = factsSummary(facts);
        showPage(seq, searchCard(p, facts, summary, null), new Map(), placeSearch, 'search');
        void searchFeedOutliers(p, {
          baseline: (ch) => getBaseline(ch, { fetch: deps.fetch, now: deps.now, cache: deps.cache }),
          isCurrent: () => seq === pageSeq,
        }).then((r) => {
          if (seq !== pageSeq) return;
          const badges = new Map<string, Badge>();
          for (const [id, m] of r.outliers) { const b = badgeFor(m); if (b) badges.set(id, b); }
          const rows = p.results
            .flatMap((x) => { const m = r.outliers.get(x.videoId); return m?.kind === 'value' ? [{ x, v: m.value }] : []; })
            .sort((a, b) => b.v - a.v)
            .slice(0, 5)
            .map(({ x, v }) => ({
              text: x.title || x.videoId,
              href: `https://www.youtube.com/watch?v=${x.videoId}`,
              badge: `×${v}`,
              note: `${x.views.kind === 'value' ? `${x.views.value.toLocaleString('en-US')} views` : ''}${x.ageLabel ? ` · ${x.ageLabel}` : ''} · ${x.channelName}`,
            }));
          showPage(seq, searchCard(p, facts, summary, { withXn: badges.size, total: p.results.length, stopped: r.stopped, rows }), badges, placeSearch, 'search');
        });
      };
      lastPage = { kind: 'search', run };
      void ready.then(run);
    });

    window.addEventListener('message', (e) => {
      if (!isPlayerMessage(e, window, location.origin)) return;
      lastPlayer = e.data;
      void ready.then(() => handlePlayer(e.data, deps)); // handles its own errors, and only for the current video
      const v = e.data.payload ? parsePlayerResponse(e.data.payload) : null;
      if (v?.ok) share([fromWatch(v.value, new Date().toISOString())]);
    });

    // Tools → Transcripts: when the user opens YouTube's transcript panel, keep its text in this browser only.
    // Saved by the background, the single writer: two YouTube tabs saving at once would otherwise lose one save.
    const saveTranscript = async (t: { videoId: string; title: string; segments: unknown[] }) => {
      const r = (await browser.runtime.sendMessage({ kind: 'transcript-save', ...t })) as { ok: boolean; reason?: string } | undefined;
      if (!r?.ok) throw new Error(r?.reason ?? 'the extension did not answer');
    };
    const capture = transcriptCapture();
    const watchedId = () => {
      const id = location.pathname === '/watch' ? videoIdFromUrl(location.href) : null;
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    };
    capture.reset(watchedId(), readTranscriptPanel(document));
    setInterval(() => {
      const videoId = watchedId();
      if (!videoId) return;
      const segments = capture.tick(videoId, readTranscriptPanel(document));
      if (segments) void saveTranscript({ videoId, title: document.title.replace(/^\(\d+\)\s*/, '').replace(/ - YouTube$/, ''), segments }).catch((e: unknown) => console.warn('[ViewProof] transcript not saved', e));
    }, 3000);

    // The moment navigation starts, the old video's numbers must go.
    document.addEventListener('yt-navigate-start', () => {
      capture.pause();
      painter.invalidate();
      lastState = null;
      resetPage();
      lastPage = null;
      const host = document.getElementById(HOST_ID);
      if (host) renderPanel(host, { kind: 'loading' });
    });

    // Hide the panel on pages that are not videos.
    document.addEventListener('yt-navigate-finish', () => {
      capture.reset(watchedId(), readTranscriptPanel(document));
      const host = document.getElementById(HOST_ID);
      if (host) host.style.display = location.pathname === '/watch' && toggles.watch ? '' : 'none';
    });
  },
});

/** Find or create the panel host at the top of the right-hand column. */
function mount(): Promise<HTMLElement | null> {
  const attach = (): HTMLElement | null => {
    const column = watchColumn(document);
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
