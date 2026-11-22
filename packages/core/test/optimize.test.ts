import { describe, expect, test } from 'vitest';
import { checkDescription, checkTags, checkTitle, termCoverage, titleFacts } from '../src/optimize';

const by = (xs: { id: string }[]) => Object.fromEntries(xs.map((x) => [x.id, x])) as Record<string, any>;

describe('checkTitle', () => {
  test('length counts code points, so emoji count once', () => {
    const c = by(checkTitle('🔥 Why OK means okay!', null));
    expect(c.length).toMatchObject({ status: 'pass', rule: 'Title between 20 and 70 characters', detail: '20 characters' });
  });
  test('too short and over the limit', () => {
    expect(by(checkTitle('Short', null)).length).toMatchObject({ status: 'fail', detail: '5 characters' });
    const long = 'x'.repeat(101);
    expect(by(checkTitle(long, null)).limit).toMatchObject({ status: 'fail', rule: "At most 100 characters (YouTube's limit)", detail: "101 characters — YouTube won't accept it" });
    expect(by(checkTitle('x'.repeat(100), null)).limit.status).toBe('pass');
  });
  test('no keyword → keyword rules skipped', () => {
    const c = by(checkTitle('A perfectly fine video title', ''));
    expect(c.keyword).toMatchObject({ status: 'skip', detail: 'No keyword given' });
    expect(c.keywordEarly.status).toBe('skip');
  });
  test('keyword matching ignores case and spacing', () => {
    const c = by(checkTitle('Why OK means okay, explained', '  ok   MEANS '));
    expect(c.keyword).toMatchObject({ status: 'pass', rule: 'Contains "ok means"' });
    expect(c.keywordEarly).toMatchObject({ status: 'pass', rule: 'Keyword starts within the first 40 characters', detail: 'Starts at character 5' });
  });
  test('keyword missing', () => {
    const c = by(checkTitle('A video about something else', 'etymology'));
    expect(c.keyword).toMatchObject({ status: 'fail', detail: 'Not in the title' });
    expect(c.keywordEarly.status).toBe('skip');
  });
  test('keyword position counts characters of the original title', () => {
    expect(by(checkTitle('My trip — Etymology of OK', 'etymology')).keywordEarly.detail).toBe('Starts at character 11');
    const late = `${'word '.repeat(9)}and finally etymology`;
    expect(by(checkTitle(late, 'etymology')).keywordEarly).toMatchObject({ status: 'fail', detail: 'Starts at character 58' });
  });
});

describe('checkDescription', () => {
  const chapters = '0:00 Intro\n1:00 Middle\n2:00 End';
  test('empty description', () => {
    expect(by(checkDescription('', null, 600)).length).toMatchObject({ status: 'fail', rule: 'Description at least 250 characters', detail: 'No description' });
  });
  test('keyword in the first 150 characters', () => {
    const d = `${'x'.repeat(140)} okay meaning ${'y'.repeat(200)}`;
    expect(by(checkDescription(d, 'okay meaning', 600)).keywordSnippet).toMatchObject({ status: 'fail', rule: '"okay meaning" in the first 150 characters' });
    expect(by(checkDescription(`okay meaning ${d}`, 'okay meaning', 600)).keywordSnippet.status).toBe('pass');
    expect(by(checkDescription(d, null, 600)).keywordSnippet.status).toBe('skip');
  });
  test('chapters use the checklist parser', () => {
    expect(by(checkDescription(chapters, null, 600)).chapters).toMatchObject({ status: 'pass', rule: 'Chapters (timestamps starting at 0:00)', detail: '3 chapters' });
    expect(by(checkDescription('no stamps', null, 600)).chapters.status).toBe('fail');
    expect(by(checkDescription(chapters, null, 45)).chapters).toMatchObject({ status: 'skip', detail: 'Short video' });
  });
});

describe('checkTags', () => {
  test('count and the 500-character limit (quotes around tags with spaces)', () => {
    expect(by(checkTags([])).count).toMatchObject({ status: 'fail', rule: 'At least 3 tags', detail: 'No tags' });
    expect(by(checkTags(['a b', 'c'])).limit).toMatchObject({ status: 'pass', rule: 'Tags within 500 characters together', detail: '7 characters' });
    const many = Array.from({ length: 60 }, (_, i) => `tag${String(i).padStart(5, '0')}`);
    expect(by(checkTags(many)).limit.status).toBe('fail');
  });
});

test('termCoverage marks where each real term appears', () => {
  const r = termCoverage([{ term: 'okay meaning', views: 30 }, { term: 'ok origin', views: 10 }, { term: 'word history', views: 5 }],
    { title: 'What OK really means', description: 'The origin of OK.', tags: ['word history', 'etymology'] });
  expect(r).toEqual([
    { term: 'okay meaning', views: 30, inTitle: false, inDescription: false, inTags: false },
    { term: 'ok origin', views: 10, inTitle: false, inDescription: true, inTags: false },
    { term: 'word history', views: 5, inTitle: false, inDescription: false, inTags: true },
  ]);
});

describe('titleFacts', () => {
  test('fewer than 5 titles → no data with the count', () => {
    expect(titleFacts(['a', 'b', 'c', 'd'], 'x')).toEqual({ ok: false, reason: 'Only 4 outlier titles for this keyword; need 5 to compare' });
  });
  test('counts, not percentages', () => {
    const titles = [
      'Etymology of 10 words',                 // number, early
      'Why etymology matters?',                // question, early
      'How words change',                      // question
      'A very long title about many things before etymology appears late here', // late
      'Etymology',                              // early
      'Top 5 etymology facts',                 // number, early
    ];
    expect(titleFacts(titles, 'etymology')).toEqual({ ok: true, facts: { n: 6, medianLength: 21, withNumber: 2, question: 2, keywordEarly: 4 } });
  });
});
