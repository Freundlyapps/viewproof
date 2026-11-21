import type { ApiError } from '@viewproof/core';
import { useEffect, useState } from 'react';
import { getJson, isApiError } from './api';

/** Fired with the path whenever one of our endpoints answers successfully. */
export const API_OK = 'vp-api-ok';

export type Loaded<T> = { state: 'loading' } | { state: 'error'; error: ApiError } | { state: 'ok'; data: T };

/** Fetch one of our JSON endpoints; refetches when the path changes. A null path fetches nothing (stays loading). */
export function useApi<T>(path: string | null): Loaded<T> {
  const [s, set] = useState<{ path: string | null; v: Loaded<T> }>({ path, v: { state: 'loading' } });
  useEffect(() => {
    let live = true;
    set({ path, v: { state: 'loading' } });
    if (path === null) return undefined;
    void getJson<T>(path).then((r) => {
      if (!isApiError(r)) window.dispatchEvent(new CustomEvent(API_OK, { detail: path }));
      if (live) set({ path, v: isApiError(r) ? { state: 'error', error: r } : { state: 'ok', data: r } });
    });
    return () => { live = false; };
  }, [path]);
  return s.path === path ? s.v : { state: 'loading' };
}
