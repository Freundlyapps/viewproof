// Fixtures: trimmed ytInitialPlayerResponse from watch pages, captured 2026-11-20.
// player-watch.json = normal video, player-short.json = a Short (canonicalUrl has /shorts/),
// player-ended-stream.json = a past live stream (no longer live),
// player-live-now.synthetic.json = the ended stream with liveBroadcastDetails edited to isLiveNow:true
// (no stream was live at capture time). Server HTML omits videoDetails.isLive;
// microformat.playerMicroformatRenderer.liveBroadcastDetails.isLiveNow is the live signal.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parsePlayerResponse } from '../src/player';

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8'));

describe('parsePlayerResponse', () => {
  test('normal video', () => {
    const raw = fx('player-watch.json');
    const r = parsePlayerResponse(raw);
    if (!r.ok) throw new Error(r.reason);
    expect(r.value).toMatchObject({
      platform: 'youtube',
      videoId: raw.videoDetails.videoId,
      channelId: raw.videoDetails.channelId,
      views: Number(raw.videoDetails.viewCount),
      lengthSeconds: Number(raw.videoDetails.lengthSeconds),
      tags: raw.videoDetails.keywords ?? [],
      publishedAt: raw.microformat.playerMicroformatRenderer.publishDate,
      isLive: false,
      isUpcoming: false,
      format: 'long',
    });
  });

  test('short', () => {
    const r = parsePlayerResponse(fx('player-short.json'));
    expect(r).toMatchObject({ ok: true, value: { format: 'short' } });
  });

  test('ended stream is not live', () => {
    expect(parsePlayerResponse(fx('player-ended-stream.json'))).toMatchObject({ ok: true, value: { isLive: false, isUpcoming: false } });
  });

  test('live now', () => {
    expect(parsePlayerResponse(fx('player-live-now.synthetic.json'))).toMatchObject({ ok: true, value: { isLive: true } });
  });

  test('upcoming: videoDetails.isUpcoming', () => {
    const raw = fx('player-watch.json');
    raw.videoDetails.isUpcoming = true;
    expect(parsePlayerResponse(raw)).toMatchObject({ ok: true, value: { isUpcoming: true } });
  });

  test('unknown shape is a failure, not a throw', () => {
    for (const bad of [{}, null, undefined, 42, { videoDetails: {} }]) {
      const r = parsePlayerResponse(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/videoDetails|videoId|viewCount|publishDate/);
    }
  });

  test('missing publish date is a failure naming the field', () => {
    const raw = fx('player-watch.json');
    delete raw.microformat;
    const r = parsePlayerResponse(raw);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.reason).toContain('publishDate');
  });

  test('missing channel id is a failure, not an empty string', () => {
    const raw = fx('player-watch.json');
    delete raw.videoDetails.channelId;
    delete raw.microformat.playerMicroformatRenderer.externalChannelId;
    const r = parsePlayerResponse(raw);
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.reason).toContain('channelId');
  });

  test('format is unknown when the canonical URL is missing', () => {
    const raw = fx('player-watch.json');
    delete raw.microformat.playerMicroformatRenderer.canonicalUrl;
    expect(parsePlayerResponse(raw)).toMatchObject({ ok: true, value: { format: 'unknown' } });
  });
});
