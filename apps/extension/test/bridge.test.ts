import { describe, expect, test } from 'vitest';
import { MSG, NavigationGuard, isPlayerMessage } from '../src/bridge';

const win = {} as Window;
const ev = (data: unknown, over: Partial<{ source: unknown; origin: string }> = {}) =>
  ({ data, source: win, origin: 'https://www.youtube.com', ...over }) as unknown as MessageEvent;
const good = { type: MSG, seq: 1, url: 'https://www.youtube.com/watch?v=A', payload: {} };

describe('isPlayerMessage', () => {
  test('accepts only same-window messages of the right shape', () => {
    expect(isPlayerMessage(ev(good), win, 'https://www.youtube.com')).toBe(true);
    expect(isPlayerMessage(ev(good, { source: {} }), win, 'https://www.youtube.com')).toBe(false);
    expect(isPlayerMessage(ev(good, { origin: 'https://evil.example' }), win, 'https://www.youtube.com')).toBe(false);
    expect(isPlayerMessage(ev({ ...good, type: 'other' }), win, 'https://www.youtube.com')).toBe(false);
    expect(isPlayerMessage(ev({ ...good, seq: 'x' }), win, 'https://www.youtube.com')).toBe(false);
    expect(isPlayerMessage(ev(null), win, 'https://www.youtube.com')).toBe(false);
  });
});

describe('NavigationGuard', () => {
  test('ignores stale player data after navigation', () => {
    const g = new NavigationGuard();
    const a = g.next('https://www.youtube.com/watch?v=A');
    const b = g.next('https://www.youtube.com/watch?v=B');
    expect(a).toBe(1);
    expect(b).toBe(2);
    expect(g.isCurrent(a, 'https://www.youtube.com/watch?v=A')).toBe(false);
    expect(g.isCurrent(b, 'https://www.youtube.com/watch?v=B')).toBe(true);
    expect(g.isCurrent(b, 'https://www.youtube.com/watch?v=C')).toBe(false);
  });
});
