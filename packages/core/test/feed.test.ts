// Fixtures captured 2026-11-20 from https://www.youtube.com/feeds/videos.xml?channel_id=…
// (Veritasium = feed-long.xml, MrBeast = feed-with-shorts.xml).
// Finding at capture: Shorts entries link to /shorts/<id>, long videos to /watch?v=<id>.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseChannelFeed } from '../src/feed';

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');

describe('parseChannelFeed', () => {
  test('parses every entry with views and dates', () => {
    const xml = fx('feed-long.xml');
    const r = parseChannelFeed(xml);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toHaveLength((xml.match(/<entry>/g) ?? []).length);
    const first = r.value[0]!;
    expect(first.platform).toBe('youtube');
    expect(first.videoId).toMatch(/^[\w-]{11}$/);
    expect(typeof first.views).toBe('number');
    expect(first.views).toBe(Number(/views="(\d+)"/.exec(xml)![1]));
    expect(Number.isNaN(Date.parse(first.publishedAt))).toBe(false);
    expect(r.value.every((v) => v.views !== null)).toBe(true);
  });

  test('format rule: /shorts/ links are short, /watch links are long', () => {
    const xml = fx('feed-with-shorts.xml');
    const r = parseChannelFeed(xml);
    if (!r.ok) throw new Error(r.reason);
    expect(r.value.filter((v) => v.format === 'short')).toHaveLength((xml.match(/href="https:\/\/www\.youtube\.com\/shorts\//g) ?? []).length);
    expect(r.value.filter((v) => v.format === 'long').length).toBeGreaterThan(0);
    expect(r.value.some((v) => v.format === 'unknown')).toBe(false);
  });

  test('not a feed', () => {
    const r = parseChannelFeed('<html>not a feed</html>');
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.reason).toContain('not a YouTube feed');
  });

  test('garbage does not throw', () => {
    expect(parseChannelFeed('<<<').ok).toBe(false);
    expect(parseChannelFeed('').ok).toBe(false);
  });

  test('feed without entries is empty, not an error', () => {
    const r = parseChannelFeed('<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>x</title></feed>');
    expect(r).toEqual({ ok: true, value: [] });
  });

  test('entry without statistics has null views', () => {
    const xml = '<feed xmlns="http://www.w3.org/2005/Atom"><entry><yt:videoId>abcdefghijk</yt:videoId><title>t</title><link rel="alternate" href="https://www.youtube.com/watch?v=abcdefghijk"/><published>2026-11-01T00:00:00+00:00</published></entry></feed>';
    const r = parseChannelFeed(xml);
    expect(r).toMatchObject({ ok: true, value: [{ videoId: 'abcdefghijk', views: null, format: 'long' }] });
  });
});
