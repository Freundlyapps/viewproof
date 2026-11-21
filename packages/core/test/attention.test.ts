import { describe, expect, test } from 'vitest';
import { needsAttention } from '../src/attention';

const base = { status: 'active' as const, statusReason: null, lastUploadAt: '2026-11-18T10:00:00Z', todayIso: '2026-11-21', dataThrough: '2026-11-19', revenue: 'granted' as const };

describe('needsAttention', () => {
  test('a healthy channel: one ok line about the last upload', () => {
    expect(needsAttention(base)).toEqual([{ level: 'ok', title: 'Last upload 3 days ago', detail: 'Published 2026-11-18.' }]);
  });
  test('singular day', () => {
    expect(needsAttention({ ...base, lastUploadAt: '2026-11-20T23:00:00Z' })[0]!.title).toBe('Last upload 1 day ago');
  });
  test('reconnect comes first with its reason and action', () => {
    expect(needsAttention({ ...base, status: 'reconnect', statusReason: 'Google access was removed or expired' })[0]).toEqual({
      level: 'warn', title: 'Reconnect needed', detail: 'Google access was removed or expired', action: { label: 'Reconnect', href: '/auth/google/start?choose=1' },
    });
  });
  test('gone channel', () => {
    expect(needsAttention({ ...base, status: 'gone', statusReason: null })[0]).toEqual({
      level: 'warn', title: 'Channel no longer exists', detail: 'YouTube no longer returns this channel.', action: { label: 'Remove it', href: '/account' },
    });
  });
  test('no uploads', () => {
    expect(needsAttention({ ...base, lastUploadAt: null })).toContainEqual({ level: 'info', title: 'No uploads yet', detail: 'Your first video will show up here.' });
  });
  test('30 days or more without an upload is a warning', () => {
    expect(needsAttention({ ...base, lastUploadAt: '2026-10-22T10:00:00Z' })[0]).toEqual({ level: 'warn', title: 'No upload in 30 days', detail: 'Last published 2026-10-22.' });
  });
  test('YouTube data older than 4 days', () => {
    expect(needsAttention({ ...base, dataThrough: '2026-11-16' })).toContainEqual({ level: 'info', title: 'YouTube data is delayed', detail: 'Latest day YouTube returned: 2026-11-16.' });
    expect(needsAttention({ ...base, dataThrough: '2026-11-17' }).map((i) => i.title)).not.toContain('YouTube data is delayed');
  });
  test('revenue not connected', () => {
    expect(needsAttention({ ...base, revenue: 'not_granted' })).toContainEqual({
      level: 'info', title: 'Revenue not shown', detail: 'You connected without revenue access.', action: { label: 'Add revenue access', href: '/auth/google/start?choose=1&revenue=1' },
    });
  });
});
