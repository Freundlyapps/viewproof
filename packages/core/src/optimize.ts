// Optimize video (spec §8 item 9a): rule-based checks of a title, description and tags.
// Every rule states its threshold; no score. Same input → same output.
import { DEFAULT_CHECKLIST, TITLE_LIMIT, parseChapters } from './checklist';
import { median } from './measured';
import { normalizeKeyword } from './keywords';

export interface OptimizeCheck { id: string; status: 'pass' | 'fail' | 'skip'; rule: string; detail: string }
export const KEYWORD_WITHIN = 40;
export const SNIPPET_CHARS = 150;
export const TAGS_LIMIT = 500;

const WORD = /[\p{L}\p{N}]+/gu;
const chars = (s: string) => [...s].length;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
/** Words of a text, normalised like keywords (NFKC, lower case); punctuation splits words. */
const words = (s: string) => normalizeKeyword(s).match(WORD) ?? [];
const kw = (k: string | null) => (k ? words(k) : []);

/** All keyword words appear as words in the text. */
function hasWords(text: string, keyword: string[]): boolean {
  if (!keyword.length) return false;
  const have = new Set(words(text));
  return keyword.every((w) => have.has(w));
}

/** 1-based character (code point) position where the keyword's first word first appears as a word, or null. */
function wordPosition(text: string, first: string): number | null {
  for (const m of text.matchAll(WORD)) {
    if (normalizeKeyword(m[0]) === first) return chars(text.slice(0, m.index)) + 1;
  }
  return null;
}

export function checkTitle(title: string, keyword: string | null): OptimizeCheck[] {
  const n = chars(title);
  const { min, max } = DEFAULT_CHECKLIST.title;
  const k = kw(keyword);
  const label = k.join(' ');
  const out: OptimizeCheck[] = [
    { id: 'length', status: n >= min && n <= max ? 'pass' : 'fail', rule: `Title between ${min} and ${max} characters`, detail: plural(n, 'character') },
    { id: 'limit', status: n <= TITLE_LIMIT ? 'pass' : 'fail', rule: `At most ${TITLE_LIMIT} characters (YouTube's limit)`, detail: n <= TITLE_LIMIT ? plural(n, 'character') : `${plural(n, 'character')} — YouTube won't accept it` },
  ];
  const early = `Keyword starts within the first ${KEYWORD_WITHIN} characters`;
  if (!k.length) {
    out.push({ id: 'keyword', status: 'skip', rule: 'Contains the keyword', detail: 'No keyword given' });
    out.push({ id: 'keywordEarly', status: 'skip', rule: early, detail: 'No keyword given' });
    return out;
  }
  const found = hasWords(title, k);
  out.push({ id: 'keyword', status: found ? 'pass' : 'fail', rule: `Contains "${label}"`, detail: found ? 'In the title' : 'Not in the title' });
  const pos = found ? wordPosition(title, k[0]!) : null;
  out.push(pos === null
    ? { id: 'keywordEarly', status: 'skip', rule: early, detail: 'The keyword is not in the title' }
    : { id: 'keywordEarly', status: pos <= KEYWORD_WITHIN ? 'pass' : 'fail', rule: early, detail: `Starts at character ${pos}` });
  return out;
}

export function checkDescription(description: string, keyword: string | null, lengthSec: number): OptimizeCheck[] {
  const n = chars(description.trim());
  const min = DEFAULT_CHECKLIST.description.min;
  const k = kw(keyword);
  const out: OptimizeCheck[] = [
    { id: 'length', status: n >= min ? 'pass' : 'fail', rule: `Description at least ${min} characters`, detail: n ? plural(n, 'character') : 'No description' },
  ];
  if (!k.length) out.push({ id: 'keywordSnippet', status: 'skip', rule: `Keyword in the first ${SNIPPET_CHARS} characters`, detail: 'No keyword given' });
  else {
    const head = [...description].slice(0, SNIPPET_CHARS).join('');
    const ok = hasWords(head, k);
    out.push({ id: 'keywordSnippet', status: ok ? 'pass' : 'fail', rule: `"${k.join(' ')}" in the first ${SNIPPET_CHARS} characters`, detail: ok ? 'Yes' : 'Not in the first two lines' });
  }
  const rule = 'Chapters (timestamps starting at 0:00)';
  if (lengthSec > 0 && lengthSec <= 60) out.push({ id: 'chapters', status: 'skip', rule, detail: 'Short video' });
  else {
    const c = parseChapters(description, lengthSec);
    out.push(c.ok ? { id: 'chapters', status: 'pass', rule, detail: plural(c.chapters.length, 'chapter') } : { id: 'chapters', status: 'fail', rule, detail: c.reason });
  }
  return out;
}

/** Characters YouTube counts for tags: each tag, a separator between tags, quotes around tags with spaces. */
export function tagChars(tags: string[]): number {
  return tags.reduce((sum, t, i) => sum + chars(t) + (i ? 1 : 0) + (/\s/.test(t) ? 2 : 0), 0);
}

export function checkTags(tags: string[]): OptimizeCheck[] {
  const min = DEFAULT_CHECKLIST.tags.min;
  const total = tagChars(tags);
  return [
    { id: 'count', status: tags.length >= min ? 'pass' : 'fail', rule: `At least ${min} tags`, detail: tags.length ? plural(tags.length, 'tag') : 'No tags' },
    { id: 'limit', status: total <= TAGS_LIMIT ? 'pass' : 'fail', rule: `Tags within ${TAGS_LIMIT} characters together`, detail: plural(total, 'character') },
  ];
}

export interface TermPlace { term: string; views: number; inTitle: boolean; inDescription: boolean; inTags: boolean }

export function termCoverage(terms: { term: string; views: number }[], v: { title: string; description: string; tags: string[] }): TermPlace[] {
  return terms.map(({ term, views }) => {
    const k = words(term);
    return { term, views, inTitle: hasWords(v.title, k), inDescription: hasWords(v.description, k), inTags: v.tags.some((t) => hasWords(t, k)) };
  });
}

export interface TitleFacts { n: number; medianLength: number; withNumber: number; question: number; keywordEarly: number }
const QUESTION_START = /^(how|what|why|when|who|which|can|do|does|is|are)\b/i;

export function titleFacts(titles: string[], keyword: string): { ok: true; facts: TitleFacts } | { ok: false; reason: string } {
  if (titles.length < 5) return { ok: false, reason: `Only ${titles.length} outlier ${titles.length === 1 ? 'title' : 'titles'} for this keyword; need 5 to compare` };
  const first = kw(keyword)[0];
  return {
    ok: true,
    facts: {
      n: titles.length,
      medianLength: median(titles.map(chars))!,
      withNumber: titles.filter((t) => /\p{N}/u.test(t)).length,
      question: titles.filter((t) => t.trim().endsWith('?') || QUESTION_START.test(t.trim())).length,
      keywordEarly: first ? titles.filter((t) => { const p = wordPosition(t, first); return p !== null && p <= KEYWORD_WITHIN; }).length : 0,
    },
  };
}
