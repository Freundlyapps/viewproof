// @vitest-environment happy-dom
import { beforeEach, describe, expect, test } from 'vitest';
import { applyBadges, type Badge, videoIdOfTile } from '../src/badges';

const tile = (href: string, tag = 'ytd-rich-item-renderer') => {
  const t = document.createElement(tag);
  t.innerHTML = `<a href="${href}"><img></a><div id="details"><h3><a href="${href}">Title</a></h3></div>`;
  document.body.append(t);
  return t;
};
const b = (text: string): Badge => ({ text, title: `why ${text}`, tone: 'plain' });
const badges = (t: Element) => t.querySelectorAll('[data-viewproof-badge]');

describe('applyBadges', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  test('video ids from watch and shorts links', () => {
    expect(videoIdOfTile(tile('/watch?v=aaaaaaaaaaa&t=3'))).toBe('aaaaaaaaaaa');
    expect(videoIdOfTile(tile('/shorts/bbbbbbbbbbb'))).toBe('bbbbbbbbbbb');
    expect(videoIdOfTile(tile('/@channel'))).toBeNull();
  });

  test('one badge per tile; re-running does not duplicate', () => {
    const a = tile('/watch?v=aaaaaaaaaaa');
    const c = tile('/watch?v=ccccccccccc');
    const map = new Map([['aaaaaaaaaaa', b('×3')]]);
    expect(applyBadges(document, map)).toBe(1);
    expect(applyBadges(document, map)).toBe(1);
    expect(badges(a)).toHaveLength(1);
    expect(badges(a)[0]!.textContent).toBe('×3');
    expect(badges(a)[0]!.getAttribute('title')).toBe('why ×3');
    expect(badges(c)).toHaveLength(0);
  });

  test('a recycled tile showing another video loses the old badge', () => {
    const a = tile('/watch?v=aaaaaaaaaaa');
    applyBadges(document, new Map([['aaaaaaaaaaa', b('×3')], ['ddddddddddd', b('×0.2')]]));
    a.querySelectorAll('a').forEach((x) => x.setAttribute('href', '/watch?v=ddddddddddd'));
    applyBadges(document, new Map([['aaaaaaaaaaa', b('×3')], ['ddddddddddd', b('×0.2')]]));
    expect(badges(a)).toHaveLength(1);
    expect(badges(a)[0]!.textContent).toBe('×0.2');
    a.querySelectorAll('a').forEach((x) => x.setAttribute('href', '/watch?v=eeeeeeeeeee'));
    applyBadges(document, new Map([['aaaaaaaaaaa', b('×3')]]));
    expect(badges(a)).toHaveLength(0);
  });

  test('an empty map clears every badge', () => {
    const a = tile('/watch?v=aaaaaaaaaaa');
    applyBadges(document, new Map([['aaaaaaaaaaa', b('×3')]]));
    applyBadges(document, new Map());
    expect(badges(a)).toHaveLength(0);
  });

  test('nested tile elements get one badge, on the outer tile', () => {
    const outer = tile('/watch?v=aaaaaaaaaaa');
    const inner = document.createElement('yt-lockup-view-model');
    inner.innerHTML = '<a href="/watch?v=aaaaaaaaaaa">x</a>';
    outer.append(inner);
    applyBadges(document, new Map([['aaaaaaaaaaa', b('×3')]]));
    expect(document.querySelectorAll('[data-viewproof-badge]')).toHaveLength(1);
  });

  test('badge text is text', () => {
    const a = tile('/watch?v=aaaaaaaaaaa');
    applyBadges(document, new Map([['aaaaaaaaaaa', { text: '<img src=x>', title: '<b>', tone: 'hi' }]]));
    expect(a.querySelectorAll('img')).toHaveLength(1); // only the thumbnail
  });
});
