import { describe, expect, test } from 'vitest';
import { RANGES, parseRange, periodFor } from '../src/period';

describe('periodFor', () => {
  test('7 days ending today, previous 7 days before it', () => {
    expect(periodFor('7d', '2026-11-21')).toEqual({ start: '2026-11-15', end: '2026-11-21', prevStart: '2026-11-08', prevEnd: '2026-11-14' });
  });
  test('28 days', () => {
    expect(periodFor('28d', '2026-11-21')).toEqual({ start: '2026-10-25', end: '2026-11-21', prevStart: '2026-09-27', prevEnd: '2026-10-24' });
  });
  test('12 months crosses years', () => {
    expect(periodFor('365d', '2026-03-01')).toEqual({ start: '2025-03-02', end: '2026-03-01', prevStart: '2024-03-02', prevEnd: '2025-03-01' });
  });
});

describe('parseRange', () => {
  test('known values pass, anything else is 28 days', () => {
    for (const r of RANGES) expect(parseRange(r)).toBe(r);
    expect(RANGES).toEqual(['7d', '28d', '90d', '365d']);
    expect(parseRange('bogus')).toBe('28d');
    expect(parseRange(undefined)).toBe('28d');
  });
});

import { coverage, todayPacific } from '../src/period';

describe('coverage: compare only days YouTube has filled', () => {
  test('7 days with data through day 4 → 4 days against the 4 days before', () => {
    expect(coverage('7d', '2026-11-21', '2026-11-18')).toEqual({
      period: { start: '2026-11-15', end: '2026-11-18', prevStart: '2026-11-11', prevEnd: '2026-11-14' }, dataThrough: '2026-11-18', days: 4, rangeDays: 7,
    });
  });
  test('complete data keeps the full period', () => {
    expect(coverage('7d', '2026-11-21', '2026-11-21')).toMatchObject({ period: { start: '2026-11-15', end: '2026-11-21', prevStart: '2026-11-08', prevEnd: '2026-11-14' }, days: 7 });
  });
  test('no data at all: full period, zero days covered', () => {
    expect(coverage('28d', '2026-11-21', null)).toEqual({ period: { start: '2026-10-25', end: '2026-11-21', prevStart: '2026-09-27', prevEnd: '2026-10-24' }, dataThrough: null, days: 0, rangeDays: 28 });
  });
});

describe('todayPacific', () => {
  test("YouTube Analytics days are Pacific: 05:00 UTC is still yesterday", () => {
    expect(todayPacific(Date.parse('2026-11-21T05:00:00Z'))).toBe('2026-11-20');
    expect(todayPacific(Date.parse('2026-11-21T12:00:00Z'))).toBe('2026-11-21');
  });
});
