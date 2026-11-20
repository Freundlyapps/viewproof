import type { Measured, Scorecard } from '@open-iq/core';
import css from './panel.css?raw';

export type PanelState = { kind: 'ok'; card: Scorecard } | { kind: 'error'; reason: string };

const num = new Intl.NumberFormat('en-US');

/** Tiny element builder: text only, never HTML, so page titles and tags can't inject markup. */
function el(tag: string, cls: string | null, ...kids: (Node | string | null)[]): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k !== null) e.append(k);
  return e;
}

function tile(label: string, body: Node | string, sub: string | null): HTMLElement {
  return el('div', 'tile', el('div', 'k', label), el('div', 'v', body, sub ? el('span', 'sfx', sub) : null));
}

function measuredTile(label: string, m: Measured<number>, render: (v: number) => Node | string, sub: (m: Extract<Measured<number>, { kind: 'value' }>) => string | null): HTMLElement {
  if (m.kind === 'no_data') return el('div', 'tile', el('div', 'k', label), el('div', 'v', 'No data', el('span', 'reason', m.reason)));
  return tile(label, render(m.value), sub(m));
}

function age(hours: number): string {
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const d = Math.floor(hours / 24);
  return d < 60 ? `${d} days` : `${Math.floor(d / 30)} months`;
}

function content(state: PanelState): HTMLElement[] {
  if (state.kind === 'error') {
    return [el('div', 'err', "Couldn't read this page. YouTube may have changed something."), el('div', 'reason', state.reason)];
  }
  const { card } = state;
  const out: HTMLElement[] = [
    el('div', 'tiles',
      measuredTile('Views / hour', card.vph, (v) => num.format(v), (m) => (m.inputs.mode === 'since_upload' ? 'avg since upload' : 'since your last visit')),
      measuredTile('vs usual', card.outlier, (v) => el('span', 'xn', `×${v}`), () => null),
      tile('Age', age(card.ageHours), null),
      tile('Tags', String(card.tags.length), null),
    ),
  ];
  if (card.outlier.kind === 'value') {
    const i = card.outlier.inputs;
    const mixed = i.mixedFormats === true ? ' (Shorts and long videos mixed)' : '';
    out.push(el('div', 'why', `Why ×${card.outlier.value}? `,
      el('span', 'm', `${num.format(Number(i.views))} views; this channel usually gets ${num.format(Number(i.baselineMedian))}.${mixed}`)));
  }
  if (card.tags.length) out.push(el('div', 'tags', ...card.tags.map((t) => el('span', 'tag', t))));
  return out;
}

/** Render into the host's shadow root (created once, reused across navigations). */
export function renderPanel(host: HTMLElement, state: PanelState): void {
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  const box = el('div', 'oiq',
    el('div', 'head', 'open-IQ', state.kind === 'ok' ? el('span', 'sfx', state.card.title) : null),
    el('div', 'body', ...content(state)),
  );
  box.setAttribute('data-theme', document.documentElement.hasAttribute('dark') ? 'dark' : 'light');
  root.replaceChildren(el('style', null, css), box);
}
