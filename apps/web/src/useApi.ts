import type { ApiError } from '@viewproof/core';
import { useEffect, useState } from 'react';
import { getJson, isApiError } from './api';

export type Loaded<T> = { state: 'loading' } | { state: 'error'; error: ApiError } | { state: 'ok'; data: T };

/** Fetch one of our JSON endpoints; refetches when the path changes. */
export function useApi<T>(path: string): Loaded<T> {
  const [s, set] = useState<{ path: string; v: Loaded<T> }>({ path, v: { state: 'loading' } });
  useEffect(() => {
    let live = true;
    set({ path, v: { state: 'loading' } });
    void getJson<T>(path).then((r) => {
      if (live) set({ path, v: isApiError(r) ? { state: 'error', error: r } : { state: 'ok', data: r } });
    });
    return () => { live = false; };
  }, [path]);
  return s.path === path ? s.v : { state: 'loading' };
}
