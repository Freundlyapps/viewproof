import { describe, expect, test } from 'vitest';
import { toAscii } from '../src/ascii';

describe('toAscii (Chrome refuses content scripts containing Unicode noncharacters)', () => {
  test('escapes every non-ASCII character, astral ones as surrogate pairs', () => {
    expect(toAscii('a—b')).toBe('a\\u2014b');
    expect(toAscii('x\u{EFFFF}y')).toBe('x\\udb7f\\udfffy');
    expect(toAscii('plain ascii')).toBe('plain ascii');
  });

  test('the escaped code means the same thing', () => {
    const src = 'const s = "Florian — 1.234 Aufrufe"; const r = /[\u{10000}-\u{EFFFF}]/u; [s, r.test("\u{10400}"), r.test("a")]';
    // eslint-disable-next-line no-eval
    expect((0, eval)(toAscii(src))).toEqual((0, eval)(src));
    expect([...toAscii(src)].every((c) => c.charCodeAt(0) < 128)).toBe(true);
  });
});
