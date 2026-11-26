// Every plan limit with today's or this month's use, for Settings → Plan & usage (plan 7).
import type { Deps } from './app';
import { type LimitKey, limitOf, planOf } from './plans';

export interface UsageRow { key: LimitKey; label: string; used: number; limit: number | null; per: 'total' | 'month' | 'day' }

const monthOf = (now: number) => new Date(now).toISOString().slice(0, 7);
const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10);

/** First day of the next UTC month, YYYY-MM-DD. */
function nextMonth(now: number): string {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

export async function usageSummary(deps: Deps, userId: string): Promise<{ plan: string; month: string; resetsOn: string; rows: UsageRow[] }> {
  const now = deps.now();
  const month = monthOf(now);
  const plan = await planOf(deps.db, userId);
  const r = await deps.db.prepare(
    `SELECT (SELECT COUNT(*) FROM channels WHERE user_id = ?1) AS channels,
            (SELECT COUNT(*) FROM user_competitors WHERE user_id = ?1) AS competitors,
            (SELECT COALESCE(SUM(count), 0) FROM usage_counts WHERE user_id = ?1 AND kind = 'keyword' AND period = ?2) AS keywords,
            (SELECT COUNT(*) FROM outlier_searches WHERE user_id = ?1 AND day = ?3) AS outliers,
            (SELECT COALESCE(SUM(quick), 0) FROM ai_usage WHERE user_id = ?1 AND month = ?2) AS quick,
            (SELECT COALESCE(SUM(coach), 0) FROM ai_usage WHERE user_id = ?1 AND month = ?2) AS coach,
            (SELECT COALESCE(SUM(brief), 0) FROM ai_usage WHERE user_id = ?1 AND month = ?2) AS brief`,
  ).bind(userId, month, dayOf(now)).first<Record<'channels' | 'competitors' | 'keywords' | 'outliers' | 'quick' | 'coach' | 'brief', number>>();
  const row = (key: LimitKey, label: string, used: number, per: UsageRow['per']): UsageRow => ({ key, label, used, limit: limitOf(plan, deps.config.selfHosted, key), per });
  return {
    plan, month, resetsOn: nextMonth(now),
    rows: [
      row('channels', 'Connected channels', r!.channels, 'total'),
      row('competitors', 'Competitor channels', r!.competitors, 'total'),
      row('keywordLookups', 'New keyword lookups', r!.keywords, 'month'),
      row('outlierSearches', 'Outlier searches', r!.outliers, 'day'),
      row('aiQuick', 'AI quick actions', r!.quick, 'month'),
      row('aiCoach', 'Ask AI messages', r!.coach, 'month'),
      row('aiBrief', 'Weekly briefs', r!.brief, 'month'),
    ],
  };
}
