import { describe, expect, test } from 'vitest';
import { outlierScore } from '../src/outlier';
import type { FeedVideo, Format } from '../src/types';

const day = (n: number) => new Date(Date.UTC(2026, 10, n)).toISOString();
const feed = (views: number[], format: Format = 'long', startDay = 1): FeedVideo[] =>
  views.map((v, i) => ({ platform: 'youtube', videoId: `b${i}`, title: `t${i}`, publishedAt: day(startDay + i), views: v, format }));
const video = (views: number, extra: Partial<Parameters<typeof outlierScore>[0]['video']> = {}) => ({
  videoId: 'vid', views, format: 'long' as Format, publishedAt: day(25), isLive: false, isUpcoming: false, ...extra,
});

describe('outlierScore', () => {
  test('basic', () => {
    const r = outlierScore({ video: video(90000), baseline: feed([10000, 20000, 30000, 40000, 50000]) });
    expect(r).toMatchObject({ kind: 'value', value: 3, inputs: { baselineMedian: 30000, baselineCount: 5, views: 90000 } });
  });

  test('too few', () => {
    const r = outlierScore({ video: video(90000), baseline: feed([1, 2, 3, 4]) });
    expect(r).toEqual({ kind: 'no_data', reason: 'Needs 5 earlier videos of the same type; found 4' });
  });

  test('excludes itself and other format', () => {
    const base = [
      ...feed([10000, 20000, 30000, 40000, 50000]),
      ...feed([1, 1, 1], 'short', 10).map((v, i) => ({ ...v, videoId: `s${i}` })),
      { ...feed([999999])[0]!, videoId: 'vid' },
    ];
    const r = outlierScore({ video: video(90000), baseline: base });
    expect(r).toMatchObject({ kind: 'value', value: 3, inputs: { baselineCount: 5, mixedFormats: false } });
  });

  test('unknown format entries count and are flagged', () => {
    const r = outlierScore({ video: video(90000), baseline: feed([10000, 20000, 30000, 40000, 50000], 'unknown') });
    expect(r).toMatchObject({ kind: 'value', value: 3, inputs: { mixedFormats: true } });
  });

  test('negative', () => {
    const r = outlierScore({ video: video(6000), baseline: feed([10000, 20000, 30000, 40000, 50000]) });
    expect(r).toMatchObject({ kind: 'value', value: 0.2, inputs: { negative: true } });
  });

  test('live video yields no_data', () => {
    expect(outlierScore({ video: video(9, { isLive: true }), baseline: feed([1, 2, 3, 4, 5]) })).toEqual({ kind: 'no_data', reason: 'Live or upcoming video' });
    expect(outlierScore({ video: video(9, { isUpcoming: true }), baseline: feed([1, 2, 3, 4, 5]) }).kind).toBe('no_data');
  });

  test('takes at most 15 newest', () => {
    const r = outlierScore({ video: video(90000), baseline: feed(Array.from({ length: 20 }, () => 30000)) });
    expect(r).toMatchObject({ kind: 'value', inputs: { baselineCount: 15 } });
  });

  test('uses only videos published before the video when any exist', () => {
    const before = feed([10000, 20000, 30000, 40000, 50000], 'long', 1);
    const after = feed([900000, 900000], 'long', 26).map((v, i) => ({ ...v, videoId: `a${i}` }));
    const r = outlierScore({ video: video(90000), baseline: [...before, ...after] });
    expect(r).toMatchObject({ kind: 'value', value: 3, inputs: { baselineCount: 5 } });
  });

  test('null views are skipped', () => {
    const base = [...feed([10000, 20000, 30000, 40000]), { ...feed([0])[0]!, videoId: 'n', views: null }];
    expect(outlierScore({ video: video(90000), baseline: base }).kind).toBe('no_data');
  });

  test('zero median', () => {
    expect(outlierScore({ video: video(90000), baseline: feed([0, 0, 0, 0, 0]) }).kind).toBe('no_data');
  });

  test('old video with no earlier feed entries is no_data, not compared to newer uploads', () => {
    const newer = feed([60000, 60000, 60000, 60000, 60000, 60000], 'long', 1);
    const r = outlierScore({ video: { ...video(3000000), publishedAt: '2022-01-01T00:00:00Z' }, baseline: newer });
    expect(r).toEqual({ kind: 'no_data', reason: "No earlier videos in the channel's public feed (it lists only the latest 15 uploads)" });
  });

  test('unknown video type is named as the reason', () => {
    const r = outlierScore({ video: video(90000, { format: 'unknown' }), baseline: feed([10000, 20000, 30000, 40000, 50000]) });
    expect(r).toEqual({ kind: 'no_data', reason: 'Video type (Short or long) unknown' });
  });

  test('tiny ratios keep two significant figures instead of rounding to 0', () => {
    const r = outlierScore({ video: video(900), baseline: feed([1e6, 1e6, 1e6, 1e6, 1e6]) });
    expect(r).toMatchObject({ kind: 'value', value: 0.0009 });
  });
});
