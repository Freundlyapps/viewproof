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
