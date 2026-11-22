import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { channelSummary, parseChannelInput, videoStats } from '../src/competitors';
import { parseChannelFeed, parseFeedChannel } from '../src/feed';
import { median } from '../src/measured';

const xml = readFileSync(new URL('./fixtures/feed-long.xml', import.meta.url), 'utf8');
const feed = () => { const r = parseChannelFeed(xml); if (!r.ok) throw new Error(r.reason); return r.value; };
const H = 3_600_000;

describe('parseChannelInput', () => {
  test('accepted forms', () => {
    expect(parseChannelInput('https://www.youtube.com/channel/UCHnyfMqiRRG1u-2MsSQLbXA')).toEqual({ kind: 'id', channelId: 'UCHnyfMqiRRG1u-2MsSQLbXA' });
    expect(parseChannelInput(' UCHnyfMqiRRG1u-2MsSQLbXA ')).toEqual({ kind: 'id', channelId: 'UCHnyfMqiRRG1u-2MsSQLbXA' });
    expect(parseChannelInput('youtube.com/channel/UCHnyfMqiRRG1u-2MsSQLbXA/videos')).toEqual({ kind: 'id', channelId: 'UCHnyfMqiRRG1u-2MsSQLbXA' });
    expect(parseChannelInput('@Veritasium')).toEqual({ kind: 'handle', handle: '@veritasium' });
    expect(parseChannelInput('https://www.youtube.com/@Veritasium/videos')).toEqual({ kind: 'handle', handle: '@veritasium' });
    expect(parseChannelInput('https://m.youtube.com/@some.name_1')).toEqual({ kind: 'handle', handle: '@some.name_1' });
  });
  test('garbage', () => {
    for (const s of ['', 'hello world', 'https://example.com/@x', 'https://www.youtube.com/watch?v=abc', 'UCshort'])
      expect(parseChannelInput(s)).toEqual({ kind: 'invalid', reason: 'Paste a channel link, its @handle or its UC… id.' });
  });
});

test('feed meta from fixture', () => {
  expect(parseFeedChannel(xml)).toEqual({ channelId: 'UCHnyfMqiRRG1u-2MsSQLbXA', title: 'Veritasium' });
  expect(parseFeedChannel('<html></html>')).toBeNull();
});

describe('videoStats', () => {
  const now = '2026-11-21T12:00:00.000Z';
  const base = { videoId: 'v1', title: 'T', publishedAt: '2026-11-20T12:00:00.000Z', format: 'long' as const, views: 5000 };
  test('two snapshots 2 h apart → delta mode', () => {
    const s = videoStats(base, [{ views: 4000, at: '2026-11-21T10:00:00.000Z' }, { views: 5000, at: '2026-11-21T12:00:00.000Z' }], feed(), now);
    expect(s.vph).toMatchObject({ kind: 'value', value: 500, inputs: { mode: 'delta' } });
    expect(s.views).toMatchObject({ kind: 'value', value: 5000 });
    expect(s.history).toHaveLength(2);
  });
  test('snapshots under an hour apart → average since upload', () => {
    const s = videoStats(base, [{ views: 4900, at: '2026-11-21T11:30:00.000Z' }, { views: 5000, at: '2026-11-21T12:00:00.000Z' }], feed(), now);
    expect(s.vph).toMatchObject({ kind: 'value', value: Math.round(5000 / 24), inputs: { mode: 'since_upload' } });
  });
  test('video stats edge cases', () => {
    const young = videoStats({ ...base, publishedAt: '2026-11-21T11:30:00.000Z' }, [{ views: 10, at: now }], feed(), now);
    expect(young.vph).toEqual({ kind: 'no_data', reason: 'Published less than an hour ago' });
    const hidden = videoStats({ ...base, views: null }, [], feed(), now);
    expect(hidden.views).toEqual({ kind: 'no_data', reason: 'The feed shows no view count for this video' });
    expect(hidden.vph.kind).toBe('no_data');
    expect(hidden.outlier.kind).toBe('no_data');
  });
  test('×N against the feed (core outlierScore)', () => {
    const f = feed();
    const oldest = [...f].sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
    const newestLong = [...f].filter((x) => x.format === 'long').sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0]!;
    const s = videoStats(newestLong, [{ views: newestLong.views!, at: now }], f, now);
    expect(['value', 'no_data']).toContain(s.outlier.kind);
    expect(oldest.length).toBe(f.length);
  });
});

test('channel summary from fixture', () => {
  const f = feed();
  const s = channelSummary(f, '2026-11-21T12:00:00.000Z');
  const longViews = f.filter((x) => x.format === 'long' && x.views !== null).map((x) => x.views!);
  const shortViews = f.filter((x) => x.format === 'short' && x.views !== null).map((x) => x.views!);
  if (longViews.length) expect(s.medianViewsLong).toMatchObject({ kind: 'value', value: median(longViews) });
  if (shortViews.length) expect(s.medianViewsShorts).toMatchObject({ kind: 'value', value: median(shortViews) });
  expect(s.latestUploadAt).toBe([...f].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0]!.publishedAt);
  expect(s.inLast30Days.ofFeed).toBe(f.length);
  expect(s.inLast30Days.count).toBe(f.filter((x) => Date.parse('2026-11-21T12:00:00Z') - Date.parse(x.publishedAt) <= 30 * 24 * H).length);
  expect(channelSummary([], '2026-11-21T12:00:00.000Z')).toMatchObject({ latestUploadAt: null, medianViewsLong: { kind: 'no_data' } });
});
