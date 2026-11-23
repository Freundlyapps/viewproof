import { describe, expect, test } from 'vitest';
import { avgViewDuration, engagementRate, extractPlayerResponse, parseTimestamp, transcriptText, videoIdFromInput, watchTime } from '../src/tools';

describe('videoIdFromInput', () => {
  test.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=10', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/live/dQw4w9WgXcQ?feature=share', 'dQw4w9WgXcQ'],
    ['  dQw4w9WgXcQ ', 'dQw4w9WgXcQ'],
    ['www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('%s', (input, id) => expect(videoIdFromInput(input)).toBe(id));

  test.each(['', 'hello', 'https://example.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/@handle', 'dQw4w9WgXc', 'https://www.youtube.com/watch?v=short'])('rejects %s', (input) => {
    expect(videoIdFromInput(input)).toBeNull();
  });
});

describe('extractPlayerResponse', () => {
  test('reads the object after the variable, braces inside strings included', () => {
    const html = '<script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"abc","title":"a } { \\" b"},"n":[1,{"x":2}]};var meta = {};</script>';
    expect(extractPlayerResponse(html)).toEqual({ videoDetails: { videoId: 'abc', title: 'a } { " b' }, n: [1, { x: 2 }] });
  });

  test('also the window["…"] form', () => {
    expect(extractPlayerResponse('window["ytInitialPlayerResponse"] = {"a":1};')).toEqual({ a: 1 });
  });

  test('null when absent, unterminated or not JSON', () => {
    expect(extractPlayerResponse('<html>consent</html>')).toBeNull();
    expect(extractPlayerResponse('var ytInitialPlayerResponse = {"a":1')).toBeNull();
    expect(extractPlayerResponse('var ytInitialPlayerResponse = {a:1};')).toBeNull();
    expect(extractPlayerResponse('var ytInitialPlayerResponse = null;')).toBeNull();
  });
});

describe('calculators', () => {
  test('engagement rate = (likes + comments) / views × 100', () => {
    expect(engagementRate({ views: 2000, likes: 90, comments: 10 })).toEqual({ ok: true, percent: 5 });
  });

  test('zero views, negatives, fractions and blanks are refused with a reason', () => {
    expect(engagementRate({ views: 0, likes: 1, comments: 0 })).toEqual({ ok: false, reason: 'Views must be more than 0.' });
    expect(engagementRate({ views: 10, likes: -1, comments: 0 })).toEqual({ ok: false, reason: 'Likes must be a whole number, 0 or more.' });
    expect(engagementRate({ views: 10.5, likes: 1, comments: 0 })).toEqual({ ok: false, reason: 'Views must be a whole number, 0 or more.' });
    expect(engagementRate({ views: Number.NaN, likes: 1, comments: 0 })).toEqual({ ok: false, reason: 'Views must be a whole number, 0 or more.' });
  });

  test('watch time in hours from views × average view duration', () => {
    expect(watchTime({ views: 1200, avgSec: 180 })).toEqual({ ok: true, hours: 60 });
    expect(watchTime({ views: 0, avgSec: 180 })).toEqual({ ok: true, hours: 0 });
    expect(watchTime({ views: 10, avgSec: -1 })).toEqual({ ok: false, reason: 'Average view duration must be 0 seconds or more.' });
  });

  test('average view duration in seconds from watch hours ÷ views', () => {
    expect(avgViewDuration({ views: 1200, hours: 60 })).toEqual({ ok: true, seconds: 180 });
    expect(avgViewDuration({ views: 0, hours: 60 })).toEqual({ ok: false, reason: 'Views must be more than 0.' });
    expect(avgViewDuration({ views: 5, hours: Number.POSITIVE_INFINITY })).toEqual({ ok: false, reason: 'Watch time must be 0 hours or more.' });
  });
});

describe('transcripts', () => {
  test('parseTimestamp reads m:ss and h:mm:ss', () => {
    expect(parseTimestamp('0:00')).toBe(0);
    expect(parseTimestamp(' 4:05 ')).toBe(245);
    expect(parseTimestamp('1:02:03')).toBe(3723);
    expect(parseTimestamp('4:65')).toBeNull();
    expect(parseTimestamp('abc')).toBeNull();
  });

  test('transcriptText with and without times', () => {
    const s = [{ startSec: 0, text: 'Hello' }, { startSec: 3725, text: 'Bye  now' }];
    expect(transcriptText(s, false)).toBe('Hello\nBye now');
    expect(transcriptText(s, true)).toBe('0:00 Hello\n1:02:05 Bye now');
  });
});
