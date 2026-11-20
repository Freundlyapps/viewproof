import type { ViewObservation } from '@viewproof/core';

/** The user's own past sightings of a video's view count, kept only in this browser. */
export interface ObservationStore {
  getLatest(videoId: string): Promise<ViewObservation | null>;
  record(videoId: string, obs: ViewObservation): Promise<void>;
}

/** Least-recently-recorded videos beyond this are dropped. */
export const MAX_VIDEOS = 2000;
const KEY = 'observations';

type Table = Record<string, ViewObservation>; // insertion order = recency

function put(table: Table, videoId: string, obs: ViewObservation): Table {
  const next: Table = { ...table };
  delete next[videoId];
  next[videoId] = obs;
  const ids = Object.keys(next);
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX_VIDEOS))) delete next[id];
  return next;
}

export function memoryStore(): ObservationStore {
  let table: Table = {};
  return {
    async getLatest(id) { return table[id] ?? null; },
    async record(id, obs) { table = put(table, id, obs); },
  };
}

export function chromeStore(area: chrome.storage.StorageArea): ObservationStore {
  const load = async (): Promise<Table> => ((await area.get(KEY))[KEY] as Table | undefined) ?? {};
  return {
    async getLatest(id) { return (await load())[id] ?? null; },
    async record(id, obs) { await area.set({ [KEY]: put(await load(), id, obs) }); },
  };
}
