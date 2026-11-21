const KEY = 'vp-keywords';
const MAX = 10;

export function recentKeywords(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function rememberKeyword(q: string): void {
  localStorage.setItem(KEY, JSON.stringify([q, ...recentKeywords().filter((x) => x !== q)].slice(0, MAX)));
}
