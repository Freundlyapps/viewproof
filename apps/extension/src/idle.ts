/** Run after the page is idle (at most 2 s later), so YouTube's own rendering goes first. */
export function whenIdle<T>(fn: () => T | Promise<T>, timeoutMs = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => { Promise.resolve().then(fn).then(resolve, reject); };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: timeoutMs });
    else setTimeout(run, 0);
  });
}
