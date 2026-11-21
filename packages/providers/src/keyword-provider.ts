import type { KeywordEstimate } from '@viewproof/core';

/** A source of keyword estimates (spec D2). Vendors plug in behind this; none is YouTube data. */
export interface KeywordProvider {
  name: string;
  estimate(keyword: string, country: { code: string; locationCode: number }): Promise<KeywordEstimate>;
}

/** Shown next to every vendor number (spec §6 S5, policy III.E.4.h disclosure). */
export const ESTIMATE_LABEL = 'Estimate — clickstream panel, not YouTube data';

/** No vendor configured or allowed: every estimate is "off" with the reason. */
export function noProvider(reason: string): KeywordProvider {
  return { name: 'none', estimate: async () => ({ status: 'off', reason }) };
}
