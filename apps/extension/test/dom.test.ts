// @vitest-environment happy-dom
import { beforeEach, expect, test } from 'vitest';
import { applyBadges } from '../src/badges';
import { pageScope, watchColumn } from '../src/dom';

beforeEach(() => { document.body.innerHTML = ''; });

test('the watch panel goes in the watch page column, not a hidden search page column', () => {
  document.body.innerHTML = `<ytd-search><div id="secondary" class="search"></div></ytd-search>
    <ytd-watch-flexy><div id="secondary" class="watch"></div></ytd-watch-flexy>`;
  expect(watchColumn(document)?.className).toBe('watch');
  document.querySelector('ytd-watch-flexy')!.setAttribute('hidden', '');
  expect(watchColumn(document)).toBeNull();
});

test('pages without YouTube app elements (simple pages) still find #secondary', () => {
  document.body.innerHTML = '<div id="secondary"></div>';
  expect(watchColumn(document)).not.toBeNull();
});

test('badges go only on the visible page; hidden watch-page tiles get none', () => {
  document.body.innerHTML = `
    <ytd-watch-flexy hidden><yt-lockup-view-model><a href="/watch?v=aaaaaaaaaaa">x</a></yt-lockup-view-model></ytd-watch-flexy>
    <ytd-browse><ytd-rich-item-renderer><a href="/watch?v=aaaaaaaaaaa">x</a><h3>t</h3></ytd-rich-item-renderer></ytd-browse>`;
  const n = applyBadges(pageScope('channel'), new Map([['aaaaaaaaaaa', { text: '×3', title: 't', tone: 'hi' as const }]]));
  expect(n).toBe(1);
  expect(document.querySelector('ytd-watch-flexy [data-viewproof-badge]')).toBeNull();
});
