/** Message posted by the MAIN-world script with the page's own player data. */
export const MSG = 'open-iq:player' as const;

export interface PlayerMessage {
  type: typeof MSG;
  seq: number;
  url: string;
  payload: unknown;
}

/** Same window, same origin, right shape — anything else on window.postMessage is ignored. */
export function isPlayerMessage(e: MessageEvent, self: Window, origin: string): e is MessageEvent<PlayerMessage> {
  if (e.source !== self || e.origin !== origin) return false;
  const d = e.data as Partial<PlayerMessage> | null;
  return !!d && d.type === MSG && typeof d.seq === 'number' && typeof d.url === 'string' && 'payload' in d;
}

export function videoIdFromUrl(url: string): string | null {
  try {
    return new URL(url).searchParams.get('v');
  } catch {
    return null;
  }
}

/** YouTube is a single-page app: results for an old video must never render on a new one. */
export class NavigationGuard {
  private seq = 0;
  private videoId: string | null = null;

  next(url: string): number {
    this.videoId = videoIdFromUrl(url);
    return ++this.seq;
  }

  isCurrent(seq: number, url: string): boolean {
    return seq === this.seq && this.videoId !== null && videoIdFromUrl(url) === this.videoId;
  }
}
