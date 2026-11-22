import { type PoolState, poolStore } from '../../src/pool';

const pool = poolStore(browser.storage.local);
const app = document.getElementById('app')!;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}
const button = (label: string, onClick: () => Promise<void>, cls = '') => {
  const b = el('button', cls ? { class: cls, type: 'button' } : { type: 'button' }, label);
  b.addEventListener('click', () => void onClick().then(render));
  return b;
};

function render(): Promise<void> {
  return pool.get().then((s: PoolState) => {
    app.replaceChildren(consent(s), link(s), log(s));
  });
}

function consent(s: PoolState) {
  const box = el('div', { class: 'card' }, el('h2', {}, "Share public video facts with ViewProof's data pool"));
  box.append(el('ul', {},
    el('li', {}, 'What is sent: video and channel ids, title, view count, upload time or age, length, Short or long — from YouTube pages you open.'),
    el('li', {}, 'Never sent: who you are on YouTube, cookies, what you watch for how long, your searches.'),
    el('li', {}, 'Sent to: the ViewProof server this browser is linked to. You can see every item below and stop at any time.'),
  ));
  box.append(s.consent
    ? el('p', {}, el('strong', {}, 'Sharing is on. '), button('Stop sharing', () => pool.setConsent(false)))
    : el('p', {}, button('I agree — start sharing', () => pool.setConsent(true), 'pri')));
  return box;
}

function link(s: PoolState) {
  const box = el('div', { class: 'card' }, el('h2', {}, 'Linked account'));
  if (s.token && s.server) {
    box.append(el('p', {}, `Linked to ${s.server} since ${new Date(s.linkedAt ?? '').toLocaleString()}. `, button('Unlink', () => pool.unlink())));
    if (s.paused) box.append(el('p', { class: 'bad' }, s.statusNote ?? 'Paused.'));
    else if (!s.consent) box.append(el('p', { class: 'muted' }, 'Nothing is sent until you agree above.'));
    else box.append(el('p', { class: 'muted small' }, `${s.queue.length} waiting to be sent (every 5 minutes).`));
  } else {
    box.append(el('p', {}, 'Not linked. Open ViewProof → Settings → Extension & data and choose "Link this browser".'));
    if (s.statusNote) box.append(el('p', { class: 'bad' }, s.statusNote));
  }
  return box;
}

function log(s: PoolState) {
  const box = el('div', { class: 'card' }, el('h2', {}, 'What my browser shared'));
  if (s.log.length === 0) { box.append(el('p', { class: 'muted' }, 'Nothing yet.')); return box; }
  box.append(el('p', {}, button('Clear this list', () => pool.clearLog())));
  const rows = s.log.map((e) => el('tr', {},
    el('td', {}, new Date(e.at).toLocaleString()),
    el('td', {}, e.error ? el('span', { class: 'bad' }, e.error) : `${e.accepted} accepted, ${e.rejected} rejected${e.reasons.length ? ` (${e.reasons.join('; ')})` : ''}`),
    el('td', {}, e.sent ? el('details', {}, el('summary', {}, `${e.sent} videos`), el('ul', {}, ...e.videos.map((v) => el('li', {}, `${v.title} — ${v.views.toLocaleString()} views (${v.source}, ${v.videoId})`)))) : '—'),
  ));
  box.append(el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'When'), el('th', {}, 'Result'), el('th', {}, 'What was sent'))), el('tbody', {}, ...rows)));
  return box;
}

browser.storage.onChanged.addListener((_c, area) => { if (area === 'local') void render(); });
void render();
