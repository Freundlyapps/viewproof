import { describe, expect, test } from 'vitest';
import { buildScorecard } from '../src/scorecard';
import type { WatchVideo } from '../src/player';
import type { FeedVideo } from '../src/types';

const video: WatchVideo = {
  platform: 'youtube', videoId: 'vid00000001', channelId: 'UCx', title: 'T', views: 96000, lengthSeconds: 600,
  publishedAt: '2026-11-18T12:00:00Z', tags: ['a', 'b'], isLive: false, isUpcoming: false, format: 'long',
};
const baseline: FeedVideo[] = [10000, 20000, 30000, 40000, 50000].map((v, i) => ({
  platform: 'youtube', videoId: `b${i}`, title: '', publishedAt: `2026-11-0${i + 1}T00:00:00Z`, views: v, format: 'long',
}));
const NOW = '2026-11-20T12:00:00Z';

describe('buildScorecard', () => {
  test('combines scores', () => {
    const c = buildScorecard({ video, previous: null, baseline: { ok: true, value: baseline }, now: NOW });
    expect(c).toMatchObject({ platform: 'youtube', videoId: 'vid00000001', title: 'T', age: { kind: 'value', value: 48 }, tags: ['a', 'b'] });
    expect(c.vph).toMatchObject({ kind: 'value', value: 2000 });
    expect(c.outlier).toMatchObject({ kind: 'value', value: 3.2 });
  });

  test('feed failure leaves other stats intact', () => {
    const c = buildScorecard({ video, previous: null, baseline: { ok: false, reason: 'HTTP 404' }, now: NOW });
    expect(c.outlier.kind).toBe('no_data');
    if (c.outlier.kind === 'no_data') expect(c.outlier.reason).toContain('HTTP 404');
    expect(c.vph.kind).toBe('value');
  });

  test('uses the previous observation for VPH', () => {
    const c = buildScorecard({ video, previous: { views: 94000, at: '2026-11-20T11:00:00Z' }, baseline: { ok: true, value: baseline }, now: NOW });
    expect(c.vph).toMatchObject({ kind: 'value', value: 2000, inputs: { mode: 'delta' } });
  });

  test('live video: VPH and outlier say so', () => {
    const c = buildScorecard({ video: { ...video, isLive: true }, previous: null, baseline: { ok: true, value: baseline }, now: NOW });
    expect(c.vph).toEqual({ kind: 'no_data', reason: 'Live or upcoming video' });
    expect(c.outlier).toEqual({ kind: 'no_data', reason: 'Live or upcoming video' });
  });

  test('scheduled premiere: age says not published yet, never negative', () => {
    const c = buildScorecard({ video: { ...video, isUpcoming: true, views: null, publishedAt: '2026-11-21T08:00:00Z' }, previous: null, baseline: { ok: true, value: baseline }, now: NOW });
    expect(c.age).toEqual({ kind: 'no_data', reason: 'Not published yet' });
    expect(c.vph.kind).toBe('no_data');
  });

  test('missing view count on a published video never reaches the scores', () => {
    const c = buildScorecard({ video: { ...video, views: null }, previous: null, baseline: { ok: true, value: baseline }, now: NOW });
    expect(c.vph).toEqual({ kind: 'no_data', reason: 'View count not shown' });
    expect(c.outlier).toEqual({ kind: 'no_data', reason: 'View count not shown' });
  });
});
