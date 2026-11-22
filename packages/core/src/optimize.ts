// Optimize video (spec §8 item 9a): rule-based checks of a title, description and tags.
// Every rule states its threshold; no score. Same input → same output.
import { DEFAULT_CHECKLIST, TITLE_LIMIT, parseChapters } from './checklist';
import { median } from './measured';
import { normalizeKeyword } from './keywords';

export interface OptimizeCheck { id: string; status: 'pass' | 'fail' | 'skip'; rule: string; detail: string }
export const KEYWORD_WITHIN = 40;
export const SNIPPET_CHARS = 150;
export const TAGS_LIMIT = 500;

const chars = (s: string) => [...s].length;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

// Words: letters, digits and combining marks (so Hindi vowel signs or decomposed accents don't split words).
const WORD = /[\p{L}\p{N}\p{M}]+/gu;
// Scripts written without spaces between words: match the keyword as a substring instead of as words.
const NO_SPACES = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

/** Text normalised once for every comparison: NFKC, lower case, accents composed, Turkish İ folded to i. */
const norm = (s: string) => normalizeKeyword(s).replace(/i\u0307/g, 'i').normalize('NFC');
const words = (s: string) => norm(s).match(WORD) ?? [];

interface Keyword { words: string[]; joined: string; noSpaces: boolean }
function kw(k: string | null): Keyword {
  const w = k ? words(k) : [];
  return { words: w, joined: w.join(' '), noSpaces: NO_SPACES.test(w.join('')) };
}

/** Whether the keyword is in the text, and the 1-based character where it starts. Both from the same normalised text. */
function find(text: string, k: Keyword): { found: boolean; pos: number | null } {
  if (!k.words.length) return { found: false, pos: null };
  const t = norm(text);
  if (k.noSpaces) {
    const at = t.indexOf(k.words.join(''));
    const atSpaced = at < 0 ? t.indexOf(k.joined) : at;
    return atSpaced < 0 ? { found: false, pos: null } : { found: true, pos: chars(t.slice(0, atSpaced)) + 1 };
  }
  const tokens = [...t.matchAll(WORD)];
  const have = new Set(tokens.map((m) => m[0]));
  if (!k.words.every((w) => have.has(w))) return { found: false, pos: null };
  const first = tokens.find((m) => m[0] === k.words[0])!;
  return { found: true, pos: chars(t.slice(0, first.index)) + 1 };
}
const hasWords = (text: string, k: Keyword) => find(text, k).found;

export function checkTitle(title: string, keyword: string | null): OptimizeCheck[] {
  const n = chars(title);
  const { min, max } = DEFAULT_CHECKLIST.title;
  const k = kw(keyword);
  const label = k.joined;
  const out: OptimizeCheck[] = [
    { id: 'length', status: n >= min && n <= max ? 'pass' : 'fail', rule: `Title between ${min} and ${max} characters`, detail: plural(n, 'character') },
    { id: 'limit', status: n <= TITLE_LIMIT ? 'pass' : 'fail', rule: `At most ${TITLE_LIMIT} characters (YouTube's limit)`, detail: n <= TITLE_LIMIT ? plural(n, 'character') : `${plural(n, 'character')} — YouTube won't accept it` },
  ];
  const early = `Keyword starts within the first ${KEYWORD_WITHIN} characters`;
  if (!k.words.length) {
    out.push({ id: 'keyword', status: 'skip', rule: 'Contains the keyword', detail: 'No keyword given' });
    out.push({ id: 'keywordEarly', status: 'skip', rule: early, detail: 'No keyword given' });
    return out;
  }
  const { found, pos } = find(title, k);
  out.push({ id: 'keyword', status: found ? 'pass' : 'fail', rule: `Contains "${label}"`, detail: found ? 'In the title' : 'Not in the title' });
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
  if (!k.words.length) out.push({ id: 'keywordSnippet', status: 'skip', rule: `Keyword in the first ${SNIPPET_CHARS} characters`, detail: 'No keyword given' });
  else {
    const head = [...description].slice(0, SNIPPET_CHARS).join('');
    const ok = hasWords(head, k);
    out.push({ id: 'keywordSnippet', status: ok ? 'pass' : 'fail', rule: `"${k.joined}" in the first ${SNIPPET_CHARS} characters`, detail: ok ? 'Yes' : 'Not in the first two lines' });
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
    const k = kw(term);
    return { term, views, inTitle: hasWords(v.title, k), inDescription: hasWords(v.description, k), inTags: v.tags.some((t) => hasWords(t, k)) };
  });
}

export interface TitleFacts { n: number; medianLength: number; withNumber: number; question: number; keywordEarly: number }
const QUESTION_START = /^(how|what|why|when|who|which|can|do|does|is|are)\b/i;

export function titleFacts(titles: string[], keyword: string): { ok: true; facts: TitleFacts } | { ok: false; reason: string } {
  if (!titles.length) return { ok: false, reason: 'No outlier titles for this keyword yet; need 5 to compare' };
  if (titles.length < 5) return { ok: false, reason: `Only ${titles.length} outlier ${titles.length === 1 ? 'title' : 'titles'} for this keyword; need 5 to compare` };
  const k = kw(keyword);
  if (!k.words.length) return { ok: false, reason: 'Enter a keyword with letters or numbers to compare' };
  return {
    ok: true,
    facts: {
      n: titles.length,
      medianLength: median(titles.map(chars))!,
      withNumber: titles.filter((t) => /\p{N}/u.test(t)).length,
      question: titles.filter((t) => t.trim().endsWith('?') || QUESTION_START.test(t.trim())).length,
      keywordEarly: titles.filter((t) => { const f = find(t, k); return f.pos !== null && f.pos <= KEYWORD_WITHIN; }).length,
    },
  };
}
