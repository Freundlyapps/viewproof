/** Connected-channel limits per plan (spec §9). Self-hosted installs have no limits. */
const MAX_CHANNELS: Record<string, number> = { free: 1, pro: 3 };

export function maxChannels(plan: string, selfHosted: boolean): number {
  if (selfHosted) return Infinity;
  return MAX_CHANNELS[plan] ?? MAX_CHANNELS.free!;
}

export type AiTask = 'quick' | 'coach';
/** Included-AI uses per month (private note 09, update 2026-11-20). Own keys are never counted. */
const AI_LIMITS: Record<string, Record<AiTask, number>> = { free: { quick: 20, coach: 0 }, pro: { quick: 500, coach: 150 } };

export function aiLimit(plan: string, selfHosted: boolean, task: AiTask): number {
  if (selfHosted) return Infinity;
  return (AI_LIMITS[plan] ?? AI_LIMITS.free!)[task];
}

/** MCP tool calls per user per day on hosted servers (plan 6c). Self-hosted: no limit (null). */
export const MCP_DAILY_CALLS = 500;
export function mcpLimit(selfHosted: boolean): number | null {
  return selfHosted ? null : MCP_DAILY_CALLS;
}
