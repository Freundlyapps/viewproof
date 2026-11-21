/**
 * Rewrite every non-ASCII character as a \uXXXX escape (astral ones as surrogate pairs).
 * Chrome refuses to load a content script containing a Unicode noncharacter (e.g. U+EFFFF from a
 * bundled XML-name regex: "It isn't UTF-8 encoded"); escapes mean the same in strings, regexes and comments.
 */
export function toAscii(code: string): string {
  let out = '';
  for (let i = 0; i < code.length; i++) {
    const c = code.charCodeAt(i);
    out += c < 0x80 ? code[i] : `\\u${c.toString(16).padStart(4, '0')}`;
  }
  return out;
}
