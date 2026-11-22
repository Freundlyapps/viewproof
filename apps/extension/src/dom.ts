/** Where things go on YouTube's page. YouTube keeps earlier pages in the DOM, hidden, so always pick the visible one. */

/** The right-hand column of the visible watch page. */
export function watchColumn(root: ParentNode): Element | null {
  if (root.querySelector('ytd-watch-flexy')) return root.querySelector('ytd-watch-flexy:not([hidden]) #secondary');
  return root.querySelector('#secondary');
}

/** The visible channel or search page, so badges never land on hidden pages' tiles. */
export function pageScope(kind: 'channel' | 'search'): ParentNode {
  const sel = kind === 'channel' ? 'ytd-browse:not([hidden])' : 'ytd-search:not([hidden])';
  return document.querySelector(sel) ?? document;
}
