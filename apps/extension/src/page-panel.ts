import css from './panel.css?raw';

/** A card for channel and search pages: a few numbers, plain sentences, and optional linked rows. */
export interface CardModel {
  title: string;
  subtitle?: string;
  stats: { label: string; value: string; note?: string }[];
  lines: string[];
  rows?: { text: string; href: string; badge: string; note: string }[];
  /** Shown instead of the numbers when the page couldn't be read. */
  error?: string;
}

function el(tag: string, cls: string | null, ...kids: (Node | string | null)[]): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k !== null) e.append(k);
  return e;
}

/** Render into the host's shadow root (text only, never HTML). */
export function renderPagePanel(host: HTMLElement, m: CardModel): void {
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  const body: HTMLElement[] = [];
  if (m.error) {
    body.push(el('div', 'err', "Couldn't read this page."), el('div', 'reason', m.error));
  } else {
    if (m.stats.length) {
      body.push(el('div', 'tiles wide', ...m.stats.map((s) => el('div', 'tile', el('div', 'k', s.label), el('div', 'v', s.value, s.note ? el('span', 'sfx', s.note) : null)))));
    }
    for (const l of m.lines) body.push(el('div', 'why', l));
    if (m.rows?.length) {
      body.push(el('ol', 'rows', ...m.rows.map((r) => {
        const a = el('a', null, r.text) as HTMLAnchorElement;
        a.href = r.href;
        return el('li', null, el('span', 'xn', r.badge), ' ', a, el('span', 'reason', r.note));
      })));
    }
  }
  const box = el('div', 'vp page',
    el('div', 'head', 'ViewProof', el('span', 'sfx', m.title + (m.subtitle ? ` · ${m.subtitle}` : ''))),
    el('div', 'body', ...body));
  box.setAttribute('data-theme', document.documentElement.hasAttribute('dark') ? 'dark' : 'light');
  root.replaceChildren(el('style', null, css), box);
}

const MOUNT_WAIT_MS = 10_000;

/**
 * Find or create a panel host where `place` says (it returns false until the page has the spot).
 * Waits up to 10 s for YouTube to build the page.
 */
export function mountHost(id: string, place: (host: HTMLElement) => boolean): Promise<HTMLElement | null> {
  const host = document.getElementById(id) ?? Object.assign(document.createElement('div'), { id });
  const attach = () => { if (place(host)) { host.style.display = ''; return true; } return false; };
  if (attach()) return Promise.resolve(host);
  return new Promise((resolve) => {
    const obs = new MutationObserver(() => { if (attach()) { obs.disconnect(); resolve(host); } });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { obs.disconnect(); resolve(null); }, MOUNT_WAIT_MS);
  });
}

/** Insert `host` right before `target` (once). */
export function placeBefore(host: HTMLElement, target: Element | null): boolean {
  if (!target?.parentElement) return false;
  if (host.nextElementSibling !== target) target.parentElement.insertBefore(host, target);
  return true;
}

export function removeHost(id: string): void {
  document.getElementById(id)?.remove();
}
