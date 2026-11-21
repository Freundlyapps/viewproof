import type { GoogleClient } from '../src/google';

/** Test double: records calls; each method can be overridden per test. Filled out in task 3. */
export function fakeGoogle(over: Partial<GoogleClient> = {}): GoogleClient & { calls: string[] } {
  const calls: string[] = [];
  const base: GoogleClient = {
    authUrl: (a) => `https://accounts.google.com/o/oauth2/v2/auth?state=${a.state}&consent=${a.consent ? 1 : 0}`,
    exchangeCode: async () => ({ kind: 'failed', reason: 'not configured in this test' }),
    refresh: async () => ({ kind: 'failed', reason: 'not configured in this test' }),
    myChannels: async () => ({ kind: 'failed', reason: 'not configured in this test' }),
    revoke: async () => {},
  };
  const merged = { ...base, ...over };
  const wrap = <K extends keyof GoogleClient>(k: K) =>
    ((...args: unknown[]) => {
      calls.push(k);
      return (merged[k] as (...a: unknown[]) => unknown)(...args);
    }) as GoogleClient[K];
  return { authUrl: wrap('authUrl'), exchangeCode: wrap('exchangeCode'), refresh: wrap('refresh'), myChannels: wrap('myChannels'), revoke: wrap('revoke'), calls };
}
