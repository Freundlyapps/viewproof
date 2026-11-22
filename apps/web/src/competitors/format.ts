const HOUR_MS = 3_600_000;

/** "3 h ago", "2 days ago" from an ISO time. */
export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return '—';
  const h = (now - Date.parse(iso)) / HOUR_MS;
  if (!Number.isFinite(h)) return '—';
  if (h < 1) return 'under an hour ago';
  if (h < 48) return `${Math.floor(h)} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}

export const dateOnly = (iso: string) => new Date(iso).toLocaleDateString();
