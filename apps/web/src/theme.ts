export type Theme = 'light' | 'dark';
const KEY = 'vp-theme';

export function initialTheme(): Theme {
  const saved = localStorage.getItem(KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
export function applyTheme(t: Theme, remember = false): void {
  document.documentElement.setAttribute('data-theme', t);
  if (remember) localStorage.setItem(KEY, t);
}
