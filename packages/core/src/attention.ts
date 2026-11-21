/** "Needs attention" on My channel: plain facts about the creator's own channel, no derived scores (III.E.4.h). */
export interface AttentionItem { level: 'warn' | 'ok' | 'info'; title: string; detail: string; action?: { label: string; href: string } }

const DAY_MS = 86_400_000;
const STALE_UPLOAD_DAYS = 30;
const DATA_DELAY_DAYS = 4;
const dayOf = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

export function needsAttention(i: {
  status: 'active' | 'reconnect' | 'gone';
  statusReason: string | null;
  lastUploadAt: string | null;
  todayIso: string;
  dataThrough: string | null;
  revenue: 'granted' | 'not_granted';
}): AttentionItem[] {
  const out: AttentionItem[] = [];
  const today = dayOf(i.todayIso);
  if (i.status === 'reconnect') {
    out.push({ level: 'warn', title: 'Reconnect needed', detail: i.statusReason ?? 'Google access needs renewing.', action: { label: 'Reconnect', href: '/auth/google/start?choose=1' } });
  }
  if (i.status === 'gone') {
    out.push({ level: 'warn', title: 'Channel no longer exists', detail: i.statusReason ?? 'YouTube no longer returns this channel.', action: { label: 'Remove it', href: '/account' } });
  }
  if (i.lastUploadAt === null) {
    out.push({ level: 'info', title: 'No uploads yet', detail: 'Your first video will show up here.' });
  } else {
    const ago = Math.floor((today - dayOf(i.lastUploadAt)) / DAY_MS);
    const date = i.lastUploadAt.slice(0, 10);
    out.push(ago >= STALE_UPLOAD_DAYS
      ? { level: 'warn', title: `No upload in ${days(ago)}`, detail: `Last published ${date}.` }
      : { level: 'ok', title: `Last upload ${days(ago)} ago`, detail: `Published ${date}.` });
  }
  if (i.dataThrough && (today - dayOf(i.dataThrough)) / DAY_MS > DATA_DELAY_DAYS) {
    out.push({ level: 'info', title: 'YouTube data is delayed', detail: `Latest day YouTube returned: ${i.dataThrough}.` });
  }
  if (i.revenue === 'not_granted') {
    out.push({ level: 'info', title: 'Revenue not shown', detail: 'You connected without revenue access.', action: { label: 'Add revenue access', href: '/auth/google/start?choose=1&revenue=1' } });
  }
  return out;
}
