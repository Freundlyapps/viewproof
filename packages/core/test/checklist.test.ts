// player-watch-full.json: a long video's player data (description, captions, end screen), captured 2026-11-22.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { DEFAULT_CHECKLIST, normalizeChecklist, parseChapters, runChecklist } from '../src/checklist';
import { parsePlayerResponse, type WatchVideo } from '../src/player';
import { buildScorecard } from '../src/scorecard';

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));
const video = (n: string): WatchVideo => {
  const r = parsePlayerResponse(fx(n));
  if (!r.ok) throw new Error(r.reason);
  return r.value;
};

describe('player data for the checklist', () => {
  test('description, captions and end screen are read', () => {
    const v = video('player-watch-full.json');
    expect(v.description.length).toBe(4293);
    expect(v.captions).toEqual({ manual: 1, auto: 1 });
    expect(v.endScreenElements).toBe(3);
  });
  test('missing keys mean none, not unknown', () => {
    const v = video('player-watch.json');
    expect(v.description).toBe('');
    expect(v.captions).toEqual({ manual: 0, auto: 0 });
    expect(v.endScreenElements).toBe(0);
  });
});

describe('parseChapters', () => {
  test('chapters from a real description', () => {
    const v = video('player-watch-full.json');
    const r = parseChapters(v.description, v.lengthSeconds);
    if (!r.ok) throw new Error(r.reason);
    expect(r.chapters).toHaveLength(13);
    expect(r.chapters[0]).toEqual({ startSec: 0, title: 'The "Impossible" Liquid' });
    expect(r.chapters[12]).toEqual({ startSec: 3718, title: 'The takeaway' });
  });
  test.each([
    ['0:05 Intro\n1:00 Middle\n2:00 End', 300, 'First timestamp must be 0:00'],
    ['0:00 Intro\n1:00 End', 300, 'at least 3'],
    ['0:00 Intro\n0:05 Too short\n1:00 End', 300, 'at least 10 seconds'],
    ['0:00 Intro\n2:00 B\n1:00 C', 300, 'ascending'],
    ['0:00 Intro\n1:00 B\n4:55 C', 300, 'at least 10 seconds'],
    ['No chapters here at all', 300, 'No timestamps'],
  ])('%j is rejected', (desc, len, reason) => {
    const r = parseChapters(desc, len);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(reason);
  });
  test('a timestamp inside a sentence is not a chapter', () => {
    const r = parseChapters('Skip to 0:30 for the demo\n0:00 Intro\n1:00 Demo\n1:01:58 End', 4000);
    if (!r.ok) throw new Error(r.reason);
    expect(r.chapters.map((c) => c.startSec)).toEqual([0, 60, 3718]);
  });
  test('separators after the time are dropped', () => {
    const r = parseChapters('00:00 - Intro\n01:00 – Demo\n02:00: End', 300);
    if (!r.ok) throw new Error(r.reason);
    expect(r.chapters.map((c) => c.title)).toEqual(['Intro', 'Demo', 'End']);
  });
});

describe('runChecklist', () => {
  test('real long video with the default rules', () => {
    const items = runChecklist(video('player-watch-full.json'), DEFAULT_CHECKLIST);
    const by = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(by.title).toMatchObject({ status: 'fail', detail: '81 characters (aim for 20–70)' });
    expect(by.description).toMatchObject({ status: 'pass', detail: '4,293 characters' });
    expect(by.tags).toMatchObject({ status: 'pass', detail: '31 tags' });
    expect(by.chapters).toMatchObject({ status: 'pass', detail: '13 chapters' });
    expect(by.endScreen).toMatchObject({ status: 'pass', detail: '3 elements' });
    expect(by.captions).toMatchObject({ status: 'pass' });
    for (const i of items) expect(i.rule.length).toBeGreaterThan(0);
  });
  test('Shorts skip chapters and end screen', () => {
    const items = runChecklist(video('player-short.json'), DEFAULT_CHECKLIST);
    const by = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(by.chapters?.status).toBe('skip');
    expect(by.endScreen?.status).toBe('skip');
  });
  test('rules that are off are left out; thresholds come from settings', () => {
    const s = normalizeChecklist({ ...DEFAULT_CHECKLIST, title: { on: true, min: 10, max: 90 }, captions: { on: false } });
    const items = runChecklist(video('player-watch-full.json'), s);
    expect(items.find((i) => i.id === 'captions')).toBeUndefined();
    expect(items.find((i) => i.id === 'title')).toMatchObject({ status: 'pass', rule: 'Title between 10 and 90 characters' });
  });
  test('missing captions and end screen fail with a plain reason', () => {
    const items = runChecklist(video('player-watch.json'), DEFAULT_CHECKLIST);
    const by = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(by.endScreen).toMatchObject({ status: 'fail', detail: "No end screen in YouTube's player data" });
    expect(by.captions).toMatchObject({ status: 'fail' });
  });
});

describe('normalizeChecklist', () => {
  test('junk gives defaults', () => {
    expect(normalizeChecklist('junk')).toEqual(DEFAULT_CHECKLIST);
    expect(normalizeChecklist(null)).toEqual(DEFAULT_CHECKLIST);
  });
  test('values are clamped to what YouTube allows', () => {
    const s = normalizeChecklist({ title: { on: true, min: 80, max: 500 }, tags: { on: true, min: -2 }, description: { on: 'yes', min: 1.5 } });
    expect(s.title).toEqual({ on: true, min: 80, max: 100 });
    expect(s.tags).toEqual({ on: true, min: DEFAULT_CHECKLIST.tags.min });
    expect(s.description).toEqual(DEFAULT_CHECKLIST.description);
  });
  test('min above max falls back to the default pair', () => {
    expect(normalizeChecklist({ title: { on: true, min: 60, max: 30 } }).title).toEqual(DEFAULT_CHECKLIST.title);
  });
});

test('the scorecard carries the checklist', () => {
  const v = video('player-watch-full.json');
  const card = buildScorecard({ video: v, previous: null, baseline: { ok: false, reason: 'x' }, now: '2026-11-22T00:00:00Z' });
  expect(card.checklist.map((i) => i.id)).toEqual(['title', 'description', 'tags', 'chapters', 'endScreen', 'captions']);
  const off = buildScorecard({ video: v, previous: null, baseline: { ok: false, reason: 'x' }, now: '2026-11-22T00:00:00Z', checklist: normalizeChecklist({ tags: { on: false } }) });
  expect(off.checklist.map((i) => i.id)).not.toContain('tags');
});

test('no fixture carries stream URLs (they hold the capturing IP address)', () => {
  const dir = new URL('./fixtures/', import.meta.url);
  for (const f of readdirSync(dir)) expect(readFileSync(new URL(f, dir), 'utf8'), f).not.toContain('googlevideo.com');
});
