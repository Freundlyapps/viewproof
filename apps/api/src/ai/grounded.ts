// Numbers in an AI answer that the data sent to it doesn't back (used live by the weekly brief and by the eval).

const NUM = /×?\d[\d,]*(?:\.\d+)?(?:\s?[kKmM](?![a-zA-Z]))?(?:%|x(?![a-zA-Z]))?/g;
const parse = (tok: string): number => {
  const t = tok.replace(/[,%\s×]/g, '').replace(/x$/, '');
  const mult = /k$/i.test(t) ? 1e3 : /m$/i.test(t) ? 1e6 : 1;
  return Number.parseFloat(t.replace(/[kKmM]$/, '')) * mult;
};
const tokens = (s: string) => [...s.replace(/\[?S\d{1,2}\]?/g, ' ').matchAll(NUM)].map((m) => ({ tok: m[0].replace(/,+$/, '').trim(), at: m.index ?? 0, s })).filter((x) => x.tok);
/** A plain count ("5 titles"): no ×, x, %, decimal point or k/M — those are measurements and always checked. */
const bareSmall = (tok: string, n: number) => n <= 10 && /^\d+$/.test(tok);
/** A year used as a year: "in 2026", "since 2025", or part of a date like 2026-08-14 — not "2050 views". */
const isYear = (tok: string, n: number, text: string, at: number) =>
  /^\d{4}$/.test(tok) && n >= 2000 && n <= 2099 && (/\b(in|since|of|from|by|until|during|early|late|mid)\s+$/i.test(text.slice(Math.max(0, at - 8), at)) || /^-\d{2}-\d{2}/.test(text.slice(at + 4, at + 10)));

/**
 * Numbers in the answer that the sources don't back. Grounded: a bare count ≤ 10, a year used as a year,
 * written in the topic/question, or within ±5% of a source number (so "12.5K" for "12,480" is fine).
 */
export function groundedNumbers(answer: string, sourceText: string, extra: string): { ungrounded: string[] } {
  const known = tokens(sourceText).map((x) => parse(x.tok)).filter(Number.isFinite);
  const extraTokens = new Set(tokens(extra).map((x) => parse(x.tok)));
  const ungrounded: string[] = [];
  for (const { tok, at, s: text } of tokens(answer)) {
    const n = parse(tok);
    if (!Number.isFinite(n) || bareSmall(tok, n) || isYear(tok, n, text, at) || extraTokens.has(n)) continue;
    if (known.some((k) => Math.abs(n - k) <= 0.05 * k)) continue;
    if (!ungrounded.includes(tok)) ungrounded.push(tok);
  }
  return { ungrounded };
}
