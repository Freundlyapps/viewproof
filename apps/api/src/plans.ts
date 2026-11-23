/** Plan limits (spec §9, private research 09 incl. the 2026-11-20 AI update). Self-hosted installs have no limits. */
export type Plan = 'free' | 'pro';
export type LimitKey = 'channels' | 'competitors' | 'keywordLookups' | 'outlierSearches' | 'aiQuick' | 'aiCoach';

/** null = no limit. keywordLookups and AI are per month, outlierSearches per UTC day, the rest in total. */
const LIMITS: Record<Plan, Record<LimitKey, number | null>> = {
  free: { channels: 1, competitors: 3, keywordLookups: 5, outlierSearches: 10, aiQuick: 20, aiCoach: 0 },
  pro: { channels: 3, competitors: 25, keywordLookups: 60, outlierSearches: null, aiQuick: 500, aiCoach: 150 },
};

export function limitOf(plan: string, selfHosted: boolean, key: LimitKey): number | null {
  if (selfHosted) return null;
  return (plan === 'pro' ? LIMITS.pro : LIMITS.free)[key];
}

export const UPGRADE_LINE = 'Upgrade to Pro in Settings → Plan & usage.';
/** Limit copy; free users on a server with billing get the way up. */
export function limitMessage(base: string, plan: string, billingOn: boolean): string {
  return plan !== 'pro' && billingOn ? `${base} ${UPGRADE_LINE}` : base;
}

export async function planOf(db: D1Database, userId: string): Promise<string> {
  return (await db.prepare('SELECT plan FROM users WHERE id = ?').bind(userId).first<{ plan: string }>())?.plan ?? 'free';
}

const orInfinity = (n: number | null) => (n === null ? Infinity : n);

export function maxChannels(plan: string, selfHosted: boolean): number {
  return orInfinity(limitOf(plan, selfHosted, 'channels'));
}

export type AiTask = 'quick' | 'coach';
/** Included-AI uses per month. Own keys are never counted. */
export function aiLimit(plan: string, selfHosted: boolean, task: AiTask): number {
  return orInfinity(limitOf(plan, selfHosted, task === 'quick' ? 'aiQuick' : 'aiCoach'));
}

/** MCP tool calls per user per day on hosted servers (plan 6c). Self-hosted: no limit (null). */
export const MCP_DAILY_CALLS = 500;
export function mcpLimit(selfHosted: boolean): number | null {
  return selfHosted ? null : MCP_DAILY_CALLS;
}
