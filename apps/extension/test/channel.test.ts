// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gridOutliers, parseChannelPage, type ChannelPage } from '@viewproof/core';
import { describe, expect, test } from 'vitest';
import { badgeFor, channelBadges, channelCard, isChannelPath } from '../src/channel';
import { renderPagePanel } from '../src/page-panel';

// happy-dom rewrites import.meta.url, so resolve fixtures from the package directory.
const fx = (n: string) => JSON.parse(readFileSync(resolve(process.cwd(), '../../packages/core/test/fixtures', n), 'utf8'));
const page = parseChannelPage(fx('channel-videos.json')) as ChannelPage;

test.each([
  ['/@veritasium/videos', 'videos'], ['/@veritasium/shorts', 'shorts'], ['/channel/UCHnyfMqiRRG1u-2MsSQLbXA/videos', 'videos'],
  ['/c/Name/videos', 'videos'], ['/user/name/shorts', 'shorts'], ['/@x/videos/', 'videos'],
  ['/@veritasium/featured', null], ['/@veritasium', null], ['/watch', null], ['/results', null], ['/@a/b/videos', null],
])('isChannelPath(%j)', (path, want) => expect(isChannelPath(path)).toBe(want));

describe('channelCard', () => {
  test('median, rounded counts, top 5 by ×N with links and ranges', () => {
    const m = channelCard(page, gridOutliers(page));
    expect(m.title).toBe("This channel's videos");
    const t = JSON.stringify(m);
    expect(t).toContain('rounded');
    expect(m.stats.find((s) => s.label === 'Subscribers')?.value).toBe('21.5M');
    expect(m.rows!.length).toBeLessThanOrEqual(5);
    expect(m.rows!.length).toBeGreaterThan(0);
    const xs = m.rows!.map((r) => Number(r.badge.slice(1)));
    expect([...xs].sort((a, b) => b - a)).toEqual(xs);
    expect(m.rows![0]!.href).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/);
    expect(m.rows![0]!.note).toMatch(/between ×[\d.]+ and ×[\d.]+/);
    expect(m.lines.join(' ')).toContain('×N for 25 of 30 videos');
    expect(m.lines.at(-1)).toBe('5 without ×N: Needs 5 earlier videos on this page.');
  });
  test('sorted by Popular says why there is no ×N', () => {
    const p = { ...page, sort: 'popular' as const };
    const m = channelCard(p, gridOutliers(p));
    expect(m.rows).toEqual([]);
    expect(m.lines.join(' ')).toContain('Latest order');
  });
  test('shorts link to /shorts/', () => {
    const s = parseChannelPage(fx('channel-shorts.json')) as ChannelPage;
    const m = channelCard(s, gridOutliers(s));
    expect(m.rows![0]!.href).toContain('/shorts/');
  });
});

test('badges: tone and explanation', () => {
  expect(badgeFor({ kind: 'value', value: 3.4, formula: '', inputs: { low: 3.2, high: 3.6, rounded: true } })).toMatchObject({ text: '×3.4', tone: 'hi' });
  expect(badgeFor({ kind: 'value', value: 0.2, formula: '', inputs: {} })?.tone).toBe('lo');
  expect(badgeFor({ kind: 'value', value: 1.1, formula: '', inputs: {} })?.tone).toBe('plain');
  expect(badgeFor({ kind: 'value', value: 3.4, formula: '', inputs: { low: 3.2, high: 3.6, rounded: true } })!.title).toContain('between ×3.2 and ×3.6');
  expect(badgeFor({ kind: 'no_data', reason: 'x' })).toBeNull();
  expect(channelBadges(gridOutliers(page)).size).toBe(25);
});

test('page panel renders text only, in a shadow root', () => {
  const host = document.createElement('div');
  document.body.append(host);
  renderPagePanel(host, { title: 'T <b>x</b>', stats: [{ label: 'L', value: '<img src=x>' }], lines: ['a'], rows: [{ text: '<img src=y>', href: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', badge: '×2', note: 'n' }] });
  expect(host.shadowRoot!.querySelector('img')).toBeNull();
  expect(host.shadowRoot!.querySelector('b')).toBeNull();
  expect(host.shadowRoot!.querySelector('a')!.getAttribute('href')).toBe('https://www.youtube.com/watch?v=aaaaaaaaaaa');
  renderPagePanel(host, { title: 'Second', stats: [], lines: [] });
  expect(host.shadowRoot!.querySelectorAll('.vp')).toHaveLength(1);
  renderPagePanel(host, { title: 'E', stats: [], lines: [], error: 'YouTube changed its channel page; no videos could be read' });
  expect(host.shadowRoot!.textContent).toContain('YouTube changed its channel page');
});
