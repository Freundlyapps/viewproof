/** Connected-channel limits per plan (spec §9). Self-hosted installs have no limits. */
const MAX_CHANNELS: Record<string, number> = { free: 1, pro: 3 };

export function maxChannels(plan: string, selfHosted: boolean): number {
  if (selfHosted) return Infinity;
  return MAX_CHANNELS[plan] ?? MAX_CHANNELS.free!;
}
