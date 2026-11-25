import { describe, expect, test } from 'vitest';
import { type DayViews, addDays, describeMetric, historyStart, measureChange, pickCandidates } from '../src/agent';

/** `n` days from `start`, views from fn(i), search views half of that. */
const days = (start: string, n: number, fn: (i: number) => number): DayViews[] =>
  Array.from({ length: n }, (_, i) => ({ date: addDays(start, i), views: fn(i), searchViews: Math.floor(fn(i) / 2) }));

const APPLIED = '2026-10-01';
const base = { applied: APPLIED, days: 7 as const, dataThrough: '2026-10-20', published: '2026-01-01' };

describe('measureChange', () => {
  test('waits until YouTube has every day of the after period', () => {
    expect(measureChange([], { ...base, dataThrough: '2026-10-06' })).toEqual({ state: 'waiting', readyOn: '2026-10-07' });
    expect(measureChange([], { ...base, dataThrough: null })).toEqual({ state: 'waiting', readyOn: '2026-10-07' });
    expect(measureChange([], { ...base, dataThrough: '2026-10-07' }).state).toBe('measured');
  });

  test('flat history, big jump after: above its usual swing', () => {
    // 8 weeks before at 100/day ±0, then 200/day.
    const d = [...days(historyStart(APPLIED, 7), 56, () => 100), ...days(APPLIED, 7, () => 200)];
    const m = measureChange(d, base);
    if (m.state !== 'measured') throw new Error('not measured');
    expect(m.views).toMatchObject({ before: 700, after: 1400, changePct: 100, usualSwingPct: 0, swingCount: 7, verdict: 'above_swing' });
    expect(m.searchViews).toMatchObject({ before: 350, after: 700, verdict: 'above_swing' });
  });

  test('noisy history: the same jump is within its usual swing', () => {
    // Weeks alternate 50/day and 150/day: swings of +200% / -66.7%.
    const d = [...days(historyStart(APPLIED, 7), 56, (i) => (Math.floor(i / 7) % 2 ? 150 : 50)), ...days(APPLIED, 7, () => 300)];
    const m = measureChange(d, base);
    if (m.state !== 'measured') throw new Error('not measured');
    expect(m.views.before).toBe(1050);
    expect(m.views.changePct).toBe(100);
    expect(m.views.usualSwingPct).toBe(200);
    expect(m.views.verdict).toBe('within_swing');
  });

  test('drop beyond the swing is below_swing', () => {
    const d = [...days(historyStart(APPLIED, 7), 56, () => 100), ...days(APPLIED, 7, () => 40)];
    const m = measureChange(d, base);
    if (m.state !== 'measured') throw new Error('not measured');
    expect(m.views).toMatchObject({ changePct: -60, verdict: 'below_swing' });
  });

  test('missing days count as zero views', () => {
    const d = days(historyStart(APPLIED, 7), 56, () => 100).filter((x) => x.date !== addDays(APPLIED, -1));
    const m = measureChange(d, base);
    if (m.state !== 'measured') throw new Error('not measured');
    expect(m.views.before).toBe(600);
    expect(m.views.after).toBe(0);
  });

  test('fewer than one view a day before: too few to tell', () => {
    const d = days(historyStart(APPLIED, 7), 63, (i) => (i % 2 ? 1 : 0));
    const m = measureChange(d, base);
    if (m.state !== 'measured') throw new Error('not measured');
    expect(m.views.verdict).toBe('too_few');
  });

  test('periods before publication are not used; with under two swings there is no history', () => {
    const published = addDays(APPLIED, -14); // only 2 full weeks before → 1 swing
    const d = days(published, 21, () => 100);
    const m = measureChange(d, { ...base, published });
    if (m.state !== 'measured') throw new Error('not measured');
    expect(m.views).toMatchObject({ before: 700, swingCount: 1, usualSwingPct: null, verdict: 'no_history' });
  });

  test('28-day check uses 4 earlier periods', () => {
    expect(historyStart(APPLIED, 28)).toBe(addDays(APPLIED, -112));
    const d = [...days(historyStart(APPLIED, 28), 112, () => 10), ...days(APPLIED, 28, () => 10)];
    const m = measureChange(d, { ...base, days: 28, dataThrough: '2026-11-30' });
    if (m.state !== 'measured') throw new Error('not measured');
    expect(m.views).toMatchObject({ before: 280, after: 280, changePct: 0, swingCount: 3, verdict: 'within_swing' });
  });
});

describe('pickCandidates', () => {
  const v = (id: string, published: string, views28: number | null) => ({ videoId: id, title: id, publishedAt: `${published}T10:00:00Z`, views28 });
  const TODAY = '2026-11-25';
  test('below the median, settled, at least one view a day, lowest first', () => {
    const out = pickCandidates([
      v('a', '2026-09-01', 900), v('b', '2026-08-01', 100), v('c', '2026-07-01', 50), v('d', '2026-06-01', 2000),
      v('young', '2026-11-10', 5), v('old', '2025-01-01', 1), v('few', '2026-05-01', 10), v('hidden', '2026-05-01', null),
    ], TODAY);
    // pool: a 900, b 100, c 50, d 2000, few 10 → median 100; below: c 50, few 10 (b is not below); few < 28 views.
    expect(out.median).toBe(100);
    expect(out.videos.map((x) => x.videoId)).toEqual(['c']);
  });
  test('fewer than 3 settled videos: no candidates (no usual to compare with)', () => {
    expect(pickCandidates([v('a', '2026-09-01', 900), v('b', '2026-08-01', 100)], TODAY)).toEqual({ median: null, videos: [] });
  });
});

describe('describeMetric', () => {
  test('says when it cannot tell, with the numbers', () => {
    expect(describeMetric('Views', { before: 700, after: 770, changePct: 10, usualSwingPct: 25, swingCount: 7, verdict: 'within_swing' }, 7))
      .toBe("Views: 770 in the 7 days after, 700 in the 7 days before (+10%). That's within its usual ups and downs (up to ±25% between earlier periods), so we can't tell if the change did anything.");
  });
  test('never claims the change caused a move', () => {
    const s = describeMetric('Views', { before: 700, after: 1400, changePct: 100, usualSwingPct: 0, swingCount: 7, verdict: 'above_swing' }, 7);
    expect(s).toContain('Other things can cause this too');
    expect(s).not.toMatch(/because of|caused by the change|worked/i);
  });
});
