import { type ChecklistSettings, DEFAULT_CHECKLIST, normalizeChecklist } from '@viewproof/core';

export type PageKind = 'watch' | 'channel' | 'search';
export interface PanelToggles { watch: boolean; channel: boolean; search: boolean }
export const DEFAULT_TOGGLES: PanelToggles = { watch: true, channel: true, search: true };
export const TOGGLES_KEY = 'panels';
export const CHECKLIST_KEY = 'checklist';

function normalizeToggles(raw: unknown): PanelToggles {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const pick = (k: PageKind) => (typeof r[k] === 'boolean' ? (r[k] as boolean) : DEFAULT_TOGGLES[k]);
  return { watch: pick('watch'), channel: pick('channel'), search: pick('search') };
}

/** Which panels to show and the checklist rules; kept in this browser only. */
export function settingsStore(area: chrome.storage.StorageArea) {
  const read = async (k: string): Promise<unknown> => (await area.get(k))[k];
  return {
    async getToggles(): Promise<PanelToggles> { return normalizeToggles(await read(TOGGLES_KEY)); },
    async setToggle(kind: PageKind, on: boolean): Promise<void> {
      const t = normalizeToggles(await read(TOGGLES_KEY));
      await area.set({ [TOGGLES_KEY]: { ...t, [kind]: on } });
    },
    async getChecklist(): Promise<ChecklistSettings> { return normalizeChecklist(await read(CHECKLIST_KEY)); },
    async setChecklist(s: ChecklistSettings): Promise<void> { await area.set({ [CHECKLIST_KEY]: normalizeChecklist(s) }); },
    async resetChecklist(): Promise<void> { await area.set({ [CHECKLIST_KEY]: DEFAULT_CHECKLIST }); },
  };
}

/** Which of our settings a storage.onChanged event touched. */
export function settingsChanged(changes: Record<string, chrome.storage.StorageChange>): { toggles: boolean; checklist: boolean } {
  return { toggles: TOGGLES_KEY in changes, checklist: CHECKLIST_KEY in changes };
}
