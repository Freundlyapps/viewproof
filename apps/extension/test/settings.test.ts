import { DEFAULT_CHECKLIST } from '@viewproof/core';
import { describe, expect, test } from 'vitest';
import { DEFAULT_TOGGLES, settingsChanged, settingsStore } from '../src/settings';

function fakeArea() {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (k: string) => (k in data ? { [k]: structuredClone(data[k]) } : {}),
    set: async (o: Record<string, unknown>) => { Object.assign(data, structuredClone(o)); },
    remove: async (k: string) => { delete data[k]; },
  } as unknown as chrome.storage.StorageArea & { data: Record<string, unknown> };
}

describe('settings', () => {
  test('defaults when nothing is stored', async () => {
    const s = settingsStore(fakeArea());
    expect(await s.getToggles()).toEqual({ watch: true, channel: true, search: true });
    expect(await s.getChecklist()).toEqual(DEFAULT_CHECKLIST);
  });
  test('round trip', async () => {
    const s = settingsStore(fakeArea());
    await s.setToggle('channel', false);
    expect(await s.getToggles()).toEqual({ ...DEFAULT_TOGGLES, channel: false });
    await s.setChecklist({ ...DEFAULT_CHECKLIST, tags: { on: false, min: 5 } });
    expect((await s.getChecklist()).tags).toEqual({ on: false, min: 5 });
    await s.resetChecklist();
    expect(await s.getChecklist()).toEqual(DEFAULT_CHECKLIST);
  });
  test('corrupt stored values give defaults', async () => {
    const area = fakeArea();
    area.data.panels = { watch: 'no', search: false };
    area.data.checklist = 'junk';
    const s = settingsStore(area);
    expect(await s.getToggles()).toEqual({ watch: true, channel: true, search: false });
    expect(await s.getChecklist()).toEqual(DEFAULT_CHECKLIST);
  });
  test('settingsChanged flags only its own keys', () => {
    expect(settingsChanged({ panels: {} as chrome.storage.StorageChange })).toEqual({ toggles: true, checklist: false });
    expect(settingsChanged({ checklist: {} as chrome.storage.StorageChange })).toEqual({ toggles: false, checklist: true });
    expect(settingsChanged({ pool: {} as chrome.storage.StorageChange })).toEqual({ toggles: false, checklist: false });
  });
});
