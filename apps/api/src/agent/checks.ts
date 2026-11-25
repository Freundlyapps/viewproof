// The agent's background work (hourly job): notice when an approved title went live, measure it after 7 and 28 days
// from the creator's own YouTube Analytics, run weekly briefs for those who turned them on, and delete old agent data.
import { type DayViews, type Measurement, addDays, historyStart, measureChange } from '@viewproof/core';
import type { AgentChangeRow, ChannelRow } from '@viewproof/db';
import type { Deps } from '../app';
import { REVOKED_REASON, accessFor } from '../channel-data';
import { isErr, today } from '../routes/channel';
import { runBrief } from './brief';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** An approved title that never goes live is given up on after this long. */
export const APPROVED_EXPIRES_DAYS = 30;
/** YouTube Analytics usually lags 2–3 days; don't ask before afterEnd + this. */
const ANALYTICS_LAG_DAYS = 2;
/** After this many days past the after period, take YouTube's data as complete even if the last days had no views. */
const ASSUME_COMPLETE_DAYS = 7;
export const BRIEF_KEEP_DAYS = 30;
export const CHANGE_KEEP_DAYS = 60;
/** Weekly briefs started per hourly run (each makes several Analytics calls and one AI call). */
export const BRIEFS_PER_RUN = 2;
const CHECKS_PER_RUN = 10;

const iso = (ms: number) => new Date(ms).toISOString();

/** Daily views and search views for one video, from one traffic-source report. */
async function dailyViews(deps: Deps, token: string, videoId: string, start: string, end: string): Promise<{ daily: DayViews[]; last: string | null } | { reason: string; revoked?: boolean }> {
  const r = await deps.youtube.report(token, { startDate: start, endDate: end, metrics: ['views'], dimensions: ['day', 'insightTrafficSourceType'], filters: `video==${videoId}`, sort: 'day' });
  if (isErr(r)) return { reason: r.kind === 'revoked' ? REVOKED_REASON : r.reason, revoked: r.kind === 'revoked' };
  const di = r.columns.indexOf('day');
  const ti = r.columns.indexOf('insightTrafficSourceType');
  const vi = r.columns.indexOf('views');
  if (di < 0 || ti < 0 || vi < 0) return { daily: [], last: null };
  const by = new Map<string, DayViews>();
  for (const row of r.rows) {
    const date = String(row[di]);
    const n = Number(row[vi]);
    if (!Number.isFinite(n)) continue;
    const d = by.get(date) ?? { date, views: 0, searchViews: 0 };
    d.views += n;
    if (String(row[ti]) === 'YT_SEARCH') d.searchViews += n;
    by.set(date, d);
  }
  const daily = [...by.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { daily, last: daily.at(-1)?.date ?? null };
}

/** One change: approved → applied when the live title differs; applied → measured at 7 and 28 days. */
export async function checkChange(deps: Deps, row: AgentChangeRow): Promise<void> {
  const now = deps.now();
  const day = today(deps);
  const touch = (extra = '', ...binds: unknown[]) =>
    deps.db.prepare(`UPDATE agent_changes SET last_checked_at = ?${extra} WHERE id = ?`).bind(iso(now), ...binds, row.id).run();
  const ch = await deps.db.prepare('SELECT * FROM channels WHERE id = ?').bind(row.channel_row_id).first<ChannelRow>();
  if (!ch) return;
  const a = await accessFor(deps, ch);
  if ('error' in a) {
    await touch();
    return;
  }

  if (row.status === 'approved') {
    const v = await deps.youtube.video(a.accessToken, row.video_id);
    if (isErr(v)) {
      if (v.kind === 'revoked') await deps.db.prepare("UPDATE channels SET status = 'reconnect', status_reason = ? WHERE id = ?").bind(REVOKED_REASON, ch.id).run();
      await touch();
      return;
    }
    if (!v) {
      await touch(", status = 'expired'");
      return;
    }
    if (v.title !== row.before_title) {
      await touch(", status = 'applied', applied_on = ?, applied_title = ?", day, v.title);
      return;
    }
    const expired = row.approved_at && Date.parse(row.approved_at) < now - APPROVED_EXPIRES_DAYS * DAY;
    await touch(expired ? ", status = 'expired'" : '');
    return;
  }

  if (row.status !== 'applied' || !row.applied_on) return;
  const updates: { col: 'check7' | 'check28'; m: Measurement }[] = [];
  for (const days of [7, 28] as const) {
    const col = days === 7 ? 'check7' : 'check28';
    if (row[col]) continue;
    const afterEnd = addDays(row.applied_on, days - 1);
    if (day < addDays(afterEnd, ANALYTICS_LAG_DAYS)) continue;
    const d = await dailyViews(deps, a.accessToken, row.video_id, historyStart(row.applied_on, days), afterEnd);
    if ('reason' in d) {
      if (d.revoked) await deps.db.prepare("UPDATE channels SET status = 'reconnect', status_reason = ? WHERE id = ?").bind(REVOKED_REASON, ch.id).run();
      break;
    }
    const dataThrough = d.last && d.last >= afterEnd ? d.last : day >= addDays(afterEnd, ASSUME_COMPLETE_DAYS) ? afterEnd : d.last;
    const m = measureChange(d.daily, { applied: row.applied_on, days, dataThrough, published: row.published_at });
    if (m.state === 'measured') updates.push({ col, m });
  }
  if (!updates.length) return void (await touch());
  await touch(updates.map((u) => `, ${u.col} = ?`).join(''), ...updates.map((u) => JSON.stringify(u.m)));
}

/** Hourly: prune, check open changes, start due weekly briefs. Each part is bounded per run. */
export async function runAgentCron(deps: Deps, at: Date): Promise<void> {
  const now = at.getTime();
  await deps.db.batch([
    deps.db.prepare('DELETE FROM agent_briefs WHERE created_at < ?').bind(iso(now - BRIEF_KEEP_DAYS * DAY)),
    deps.db.prepare("DELETE FROM agent_changes WHERE status IN ('proposed', 'dismissed', 'expired') AND created_at < ?").bind(iso(now - CHANGE_KEEP_DAYS * DAY)),
    deps.db.prepare("DELETE FROM agent_changes WHERE status = 'applied' AND check28 IS NOT NULL AND last_checked_at < ?").bind(iso(now - CHANGE_KEEP_DAYS * DAY)),
  ]);

  const open = await deps.db
    .prepare("SELECT * FROM agent_changes WHERE (status = 'approved' OR (status = 'applied' AND check28 IS NULL)) AND (last_checked_at IS NULL OR last_checked_at < ?) ORDER BY last_checked_at IS NOT NULL, last_checked_at LIMIT ?")
    .bind(iso(now - 20 * HOUR), CHECKS_PER_RUN)
    .all<AgentChangeRow>();
  for (const row of open.results) {
    try {
      await checkChange(deps, row);
    } catch {
      await deps.db.prepare('UPDATE agent_changes SET last_checked_at = ? WHERE id = ?').bind(iso(now), row.id).run();
    }
  }

  // Due: weekly on, a channel that isn't gone, no brief in 7 days, and no attempt in the last day (failures don't retry hourly).
  const due = await deps.db
    .prepare(`SELECT s.user_id FROM agent_settings s
      WHERE s.weekly = 1
        AND EXISTS (SELECT 1 FROM channels c WHERE c.user_id = s.user_id AND c.status != 'gone')
        AND NOT EXISTS (SELECT 1 FROM agent_briefs b WHERE b.user_id = s.user_id AND b.created_at > ?)
        AND (s.last_attempt_at IS NULL OR s.last_attempt_at < ?)
      ORDER BY s.last_attempt_at IS NOT NULL, s.last_attempt_at LIMIT ?`)
    .bind(iso(now - 7 * DAY), iso(now - DAY), BRIEFS_PER_RUN)
    .all<{ user_id: string }>();
  for (const { user_id } of due.results) {
    let error: string | null;
    try {
      const r = await runBrief(deps, user_id, 'weekly');
      error = r.ok ? null : r.message;
    } catch (e) {
      error = e instanceof Error ? e.message.slice(0, 200) : 'failed';
    }
    await deps.db.prepare('UPDATE agent_settings SET last_attempt_at = ?, last_error = ? WHERE user_id = ?').bind(iso(now), error, user_id).run();
  }
}
