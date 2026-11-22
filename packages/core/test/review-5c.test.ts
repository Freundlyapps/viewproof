import { describe, expect, test } from 'vitest';
import { parseRoundedCount } from '../src/channel-page';
import { DEFAULT_CHECKLIST, parseChapters, runChecklist } from '../src/checklist';
import type { WatchVideo } from '../src/player';

describe('I2: chapter lines YouTube accepts', () => {
  test.each([
    ['[0:00] Intro\n[1:00] A\n[2:00] B'],
    ['(0:00) Intro\n(1:00) A\n(2:00) B'],
    ['- 0:00 Intro\n- 1:00 A\n- 2:00 B'],
    ['0:00-Intro\n1:00-A\n2:00-B'],
    ['Intro 0:00\nA 1:00\nB - 2:00'],
  ])('%j', (desc) => {
    const r = parseChapters(desc, 300);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok) expect(r.chapters.map((c) => [c.startSec, c.title])).toEqual([[0, 'Intro'], [60, 'A'], [120, 'B']]);
  });
  test('unknown length (live) skips the last-chapter check', () => {
    expect(parseChapters('0:00 Intro\n1:00 A\n2:00 B', 0).ok).toBe(true);
  });
});

test('M5: live and upcoming videos skip the rules that need a finished video', () => {
  const v: WatchVideo = { platform: 'youtube', videoId: 'x'.repeat(11), channelId: 'UCx', title: 'A title long enough here', views: null, lengthSeconds: 0, publishedAt: '2026-11-22T00:00:00Z', tags: [], isLive: false, isUpcoming: true, format: 'long', description: '', captions: { manual: 0, auto: 0 }, endScreenElements: 0 };
  const by = Object.fromEntries(runChecklist(v, DEFAULT_CHECKLIST).map((i) => [i.id, i]));
  for (const id of ['chapters', 'endScreen', 'captions']) expect(by[id]).toMatchObject({ status: 'skip', detail: 'Live or upcoming video' });
});

test('I3: a one-digit shortened count has no hidden decimal', () => {
  expect(parseRoundedCount('1M')).toEqual({ lo: 950000, hi: 1099999, mid: 1000000, exact: false });
  expect(parseRoundedCount('5K views')).toEqual({ lo: 4950, hi: 5099, mid: 5000, exact: false });
  expect(parseRoundedCount('1 Mio. Aufrufe')).toEqual({ lo: 950000, hi: 1099999, mid: 1000000, exact: false });
  expect(parseRoundedCount('21M')).toEqual({ lo: 20500000, hi: 21999999, mid: 21000000, exact: false });
});
