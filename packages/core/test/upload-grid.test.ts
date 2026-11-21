import { describe, expect, test } from 'vitest';
import { uploadGrid } from '../src/upload-grid';

describe('uploadGrid', () => {
  test('counts uploads per weekday and 4-hour block in the viewer’s time zone', () => {
    const g = uploadGrid([{ publishedAt: '2026-11-22T23:30:00Z' }, { publishedAt: '2026-11-17T09:00:00Z' }, { publishedAt: '2026-11-17T10:00:00Z' }], 'Europe/Berlin');
    expect(g.days).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(g.blocks).toEqual(['0–4h', '4–8h', '8–12h', '12–16h', '16–20h', '20–24h']);
    expect(g.counts[0]![0]).toBe(1); // Sun 23:30 UTC = Mon 00:30 Berlin
    expect(g.counts[1]![2]).toBe(2); // Tue 10:00 and 11:00 Berlin
    expect(g.counts.flat().reduce((a, b) => a + b, 0)).toBe(3);
  });
  test('unparseable dates are skipped', () => {
    expect(uploadGrid([{ publishedAt: '' }], 'UTC').counts.flat().reduce((a, b) => a + b, 0)).toBe(0);
  });
});
