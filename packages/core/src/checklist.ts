import type { WatchVideo } from './player';

export type ChecklistRuleId = 'title' | 'description' | 'tags' | 'chapters' | 'endScreen' | 'captions';

export interface ChecklistSettings {
  title: { on: boolean; min: number; max: number };
  description: { on: boolean; min: number };
  tags: { on: boolean; min: number };
  chapters: { on: boolean };
  endScreen: { on: boolean };
  captions: { on: boolean };
}

export interface ChecklistItem {
  id: ChecklistRuleId;
  label: string;
  /** The rule as applied, with its thresholds. */
  rule: string;
  status: 'pass' | 'fail' | 'skip';
  /** What was measured. */
  detail: string;
}

/** YouTube's own limits. */
export const TITLE_LIMIT = 100;
export const DESCRIPTION_LIMIT = 5000;
const CHAPTER_MIN = 3;
const CHAPTER_MIN_SEC = 10;

/** ViewProof's defaults; every threshold is editable in the extension's settings. */
export const DEFAULT_CHECKLIST: ChecklistSettings = {
  title: { on: true, min: 20, max: 70 },
  description: { on: true, min: 250 },
  tags: { on: true, min: 3 },
  chapters: { on: true },
  endScreen: { on: true },
  captions: { on: true },
};

export const CHECKLIST_LABELS: Record<ChecklistRuleId, string> = {
  title: 'Title length',
  description: 'Description length',
  tags: 'Tags',
  chapters: 'Chapters',
  endScreen: 'End screen',
  captions: 'Captions',
};

const num = new Intl.NumberFormat('en-US');
const plural = (n: number, one: string, many = `${one}s`) => `${num.format(n)} ${n === 1 ? one : many}`;
/** Characters as people count them (code points), not UTF-16 units. */
const chars = (s: string) => [...s].length;

function toSec(t: string): number {
  return t.split(':').reduce((acc, p) => acc * 60 + Number(p), 0);
}

const TIME = '[\\[(]?((?:\\d{1,2}:)?\\d{1,2}:\\d{2})[\\])]?';
/** "0:00 Intro", "[0:00] Intro", "- 0:00 Intro", "0:00-Intro"… */
const STAMP_FIRST = new RegExp(`^\\s*(?:[-•*·]\\s*)?${TIME}\\s*[-–—:|]?\\s*(\\S.*?)\\s*$`);
/** "Intro 0:00", "Intro - 0:00"… */
const STAMP_LAST = new RegExp(`^\\s*(?:[-•*·]\\s*)?(\\S.*?)\\s*[-–—:|]?\\s*${TIME}\\s*$`);

/** Chapters per YouTube's rules: listed at line starts, first at 0:00, at least 3, ascending, each at least 10 seconds. */
export function parseChapters(description: string, lengthSec: number):
  { ok: true; chapters: { startSec: number; title: string }[] } | { ok: false; reason: string } {
  const chapters: { startSec: number; title: string }[] = [];
  for (const line of description.split(/\r?\n/)) {
    const first = STAMP_FIRST.exec(line);
    const last = first ? null : STAMP_LAST.exec(line);
    if (first) chapters.push({ startSec: toSec(first[1]!), title: first[2]! });
    else if (last) chapters.push({ startSec: toSec(last[2]!), title: last[1]! });
  }
  if (chapters.length === 0) return { ok: false, reason: 'No timestamps at the start of description lines' };
  if (chapters[0]!.startSec !== 0) return { ok: false, reason: 'First timestamp must be 0:00' };
  if (chapters.length < CHAPTER_MIN) return { ok: false, reason: `YouTube needs at least ${CHAPTER_MIN} timestamps; found ${chapters.length}` };
  for (let i = 1; i < chapters.length; i++) {
    if (chapters[i]!.startSec <= chapters[i - 1]!.startSec) return { ok: false, reason: `Timestamps must be ascending (${chapters[i]!.title})` };
  }
  for (let i = 0; i < chapters.length; i++) {
    // Length 0 means unknown (a live stream): the last chapter can't be checked.
    if (i + 1 === chapters.length && lengthSec <= 0) break;
    const end = i + 1 < chapters.length ? chapters[i + 1]!.startSec : lengthSec;
    if (end - chapters[i]!.startSec < CHAPTER_MIN_SEC) return { ok: false, reason: `Each chapter must be at least ${CHAPTER_MIN_SEC} seconds ("${chapters[i]!.title}")` };
  }
  return { ok: true, chapters };
}

const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;
const obj = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {});
const onOf = (r: Record<string, unknown>, d: boolean) => (typeof r.on === 'boolean' ? r.on : d);

/** Stored settings → valid settings; anything invalid falls back to the default for that field. */
export function normalizeChecklist(raw: unknown): ChecklistSettings {
  const r = obj(raw);
  const d = DEFAULT_CHECKLIST;
  const t = obj(r.title);
  let min = isCount(t.min) ? Math.min(t.min, TITLE_LIMIT) : d.title.min;
  let max = isCount(t.max) ? Math.min(t.max, TITLE_LIMIT) : d.title.max;
  if (min > max) [min, max] = [d.title.min, d.title.max];
  const desc = obj(r.description);
  const tags = obj(r.tags);
  return {
    title: { on: onOf(t, d.title.on), min, max },
    description: { on: onOf(desc, d.description.on), min: isCount(desc.min) ? Math.min(desc.min, DESCRIPTION_LIMIT) : d.description.min },
    tags: { on: onOf(tags, d.tags.on), min: isCount(tags.min) ? tags.min : d.tags.min },
    chapters: { on: onOf(obj(r.chapters), d.chapters.on) },
    endScreen: { on: onOf(obj(r.endScreen), d.endScreen.on) },
    captions: { on: onOf(obj(r.captions), d.captions.on) },
  };
}

/** Rule texts as shown next to each result and on the settings page. */
export function ruleText(id: ChecklistRuleId, s: ChecklistSettings): string {
  switch (id) {
    case 'title': return `Title between ${s.title.min} and ${s.title.max} characters`;
    case 'description': return `Description of at least ${num.format(s.description.min)} characters`;
    case 'tags': return `At least ${s.tags.min} tags`;
    case 'chapters': return `Chapters by YouTube's rules: first at 0:00, at least ${CHAPTER_MIN}, each at least ${CHAPTER_MIN_SEC} seconds (long videos)`;
    case 'endScreen': return 'An end screen with at least one element (long videos)';
    case 'captions': return 'Captions that are not only auto-generated';
  }
}

/** Run the switched-on rules over one video's public facts. */
export function runChecklist(v: WatchVideo, s: ChecklistSettings): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  const add = (id: ChecklistRuleId, status: ChecklistItem['status'], detail: string) =>
    out.push({ id, label: CHECKLIST_LABELS[id], rule: ruleText(id, s), status, detail });
  const short = v.format === 'short';
  const notFinished = v.isLive || v.isUpcoming;
  const LIVE = 'Live or upcoming video';

  if (s.title.on) {
    const n = chars(v.title);
    add('title', n >= s.title.min && n <= s.title.max ? 'pass' : 'fail', `${plural(n, 'character')} (aim for ${s.title.min}–${s.title.max})`);
  }
  if (s.description.on) {
    const n = chars(v.description);
    add('description', n >= s.description.min ? 'pass' : 'fail', n === 0 ? 'No description' : plural(n, 'character'));
  }
  if (s.tags.on) {
    const n = v.tags.length;
    add('tags', n >= s.tags.min ? 'pass' : 'fail', n === 0 ? 'No tags' : plural(n, 'tag'));
  }
  if (s.chapters.on) {
    if (notFinished) add('chapters', 'skip', LIVE);
    else if (short) add('chapters', 'skip', 'Shorts have no chapters');
    else {
      const c = parseChapters(v.description, v.lengthSeconds);
      add('chapters', c.ok ? 'pass' : 'fail', c.ok ? plural(c.chapters.length, 'chapter') : c.reason);
    }
  }
  if (s.endScreen.on) {
    if (notFinished) add('endScreen', 'skip', LIVE);
    else if (short) add('endScreen', 'skip', 'Shorts have no end screens');
    else add('endScreen', v.endScreenElements > 0 ? 'pass' : 'fail', v.endScreenElements > 0 ? plural(v.endScreenElements, 'element') : "No end screen in YouTube's player data");
  }
  if (s.captions.on) {
    const { manual, auto } = v.captions;
    if (notFinished) add('captions', 'skip', LIVE);
    else add('captions', manual > 0 ? 'pass' : 'fail',
      manual > 0 ? plural(manual, 'caption track') : auto > 0 ? 'Auto-generated captions only' : 'No captions');
  }
  return out;
}
