import { describe, expect, test } from 'vitest';
import { viewsPerHour } from '../src/vph';

const PUB = '2026-11-18T12:00:00Z';

describe('viewsPerHour', () => {
  test('delta mode', () => {
    const r = viewsPerHour({
      previous: { views: 1000, at: '2026-11-20T10:00:00Z' },
      current: { views: 3400, at: '2026-11-20T12:00:00Z' },
      publishedAt: PUB,
    });
    expect(r.kind).toBe('value');
    if (r.kind !== 'value') return;
    expect(r.value).toBe(1200);
    expect(r.inputs.mode).toBe('delta');
    expect(r.formula).toContain('÷');
  });

  test('since upload', () => {
    const r = viewsPerHour({ previous: null, current: { views: 48000, at: '2026-11-20T12:00:00Z' }, publishedAt: PUB });
    expect(r).toMatchObject({ kind: 'value', value: 1000, inputs: { mode: 'since_upload' } });
  });

  test('short interval falls back', () => {
    const r = viewsPerHour({
      previous: { views: 47900, at: '2026-11-20T11:55:00Z' },
      current: { views: 48000, at: '2026-11-20T12:00:00Z' },
      publishedAt: PUB,
    });
    expect(r).toMatchObject({ kind: 'value', value: 1000, inputs: { mode: 'since_upload' } });
  });

  test('decreasing views falls back', () => {
    const r = viewsPerHour({
      previous: { views: 50000, at: '2026-11-20T10:00:00Z' },
      current: { views: 48000, at: '2026-11-20T12:00:00Z' },
      publishedAt: PUB,
    });
    expect(r).toMatchObject({ kind: 'value', value: 1000, inputs: { mode: 'since_upload' } });
  });

  test('too new', () => {
    const r = viewsPerHour({ previous: null, current: { views: 500, at: '2026-11-20T12:00:00Z' }, publishedAt: '2026-11-20T11:40:00Z' });
    expect(r.kind).toBe('no_data');
  });
});
