/** A small ×N label on a video tile in YouTube's own grid or result list. */
export interface Badge { text: string; title: string; tone: 'hi' | 'lo' | 'plain' }

const TILES = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-reel-item-renderer, ytm-shorts-lockup-view-model, yt-lockup-view-model';
const ATTR = 'data-viewproof-badge';
const TONES: Record<Badge['tone'], string> = {
  hi: 'background:#b45309;color:#fff;',
  lo: 'background:transparent;color:inherit;opacity:.75;border:1px solid currentColor;',
  plain: 'background:#0f766e;color:#fff;',
};

/** The video a tile shows now, from its first watch or Shorts link (YouTube reuses tiles for other videos). */
export function videoIdOfTile(tile: Element): string | null {
  for (const a of tile.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') ?? '';
    const m = /[?&]v=([\w-]{11})/.exec(href) ?? /\/shorts\/([\w-]{11})/.exec(href);
    if (m) return m[1]!;
  }
  return null;
}

function makeBadge(id: string, b: Badge): HTMLElement {
  const s = document.createElement('span');
  s.setAttribute(ATTR, '');
  s.dataset.videoId = id;
  s.textContent = b.text;
  s.title = b.title;
  s.setAttribute('style', `display:inline-block;font:700 12px/1.6 Roboto,Arial,sans-serif;border-radius:6px;padding:0 6px;margin:4px 0;${TONES[b.tone]}`);
  return s;
}

/**
 * Put one badge on each tile whose video has one; remove badges from tiles that now show another video
 * or none. Idempotent. Returns how many tiles carry a badge.
 */
export function applyBadges(root: ParentNode, badges: Map<string, Badge>): number {
  let placed = 0;
  for (const tile of root.querySelectorAll(TILES)) {
    if (tile.parentElement?.closest(TILES)) continue; // the outer tile carries it
    const old = [...tile.querySelectorAll(`[${ATTR}]`)];
    const id = videoIdOfTile(tile);
    const b = id ? badges.get(id) : undefined;
    if (!id || !b) { old.forEach((o) => o.remove()); continue; }
    const keep = old.length === 1 && (old[0] as HTMLElement).dataset.videoId === id && old[0]!.textContent === b.text;
    if (!keep) {
      old.forEach((o) => o.remove());
      const title = tile.querySelector('h3');
      const badge = makeBadge(id, b);
      if (title?.parentElement) title.parentElement.insertBefore(badge, title);
      else tile.append(badge);
    }
    placed++;
  }
  return placed;
}

/** Re-apply as YouTube adds or recycles tiles (throttled); call stop() on navigation. */
export function badgeWatcher(apply: () => void, throttleMs = 300): { stop(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const obs = new MutationObserver(() => {
    if (timer) return;
    timer = setTimeout(() => { timer = null; apply(); }, throttleMs);
  });
  obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  apply();
  return { stop() { obs.disconnect(); if (timer) clearTimeout(timer); } };
}

export function clearBadges(): void {
  document.querySelectorAll(`[${ATTR}]`).forEach((b) => b.remove());
}
