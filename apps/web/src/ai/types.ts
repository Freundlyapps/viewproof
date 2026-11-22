/** JSON shapes of /api/ai/* (apps/api/src/ai). */
export interface AiSource { id: string; kind: string; label: string; detail: string; provenance: 'real' | 'public' | 'pool'; lines: string[] }
export interface AiMissing { kind: string; label: string; reason: string }
export interface AiInfo { provider: string; label: string; model: string; via: 'own' | 'included' }
export interface UsageCount { used: number; limit: number | null }
export interface AiUsage { month: string; quick: UsageCount; coach: UsageCount }
export interface AiItem { text: string; why: string; sources: string[] }
export interface QuickResult { items: AiItem[]; sources: AiSource[]; missing: AiMissing[]; ai: AiInfo; usage: AiUsage }
export interface AskResult { answer: string; cited: string[]; unknownCitations: string[]; sources: AiSource[]; missing: AiMissing[]; ai: AiInfo; usage: AiUsage }
export interface AiFailure { error: string; message: string; used?: number; limit?: number }
export interface Preset { label: string; baseUrl: string | null; quickModel: string | null; coachModel: string | null; note?: string }
export interface AiStatus {
  included: { provider: string; label: string; quickModel: string; coachModel: string } | null;
  own: { provider: string; label: string; quickModel: string; coachModel: string; baseUrl: string | null; keyHint: string } | null;
  usage: AiUsage;
  presets: Record<string, Preset>;
  customAllowed: boolean;
}

/** POST to an AI endpoint; any failure becomes an AiFailure with a message, never thrown. */
export async function postAi<T>(path: string, body: unknown): Promise<T | AiFailure> {
  try {
    const res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const out = (await res.json().catch(() => null)) as T | AiFailure | null;
    if (res.status === 401) return { error: 'signed_out', message: 'Sign in first.' };
    if (!res.ok || !out) return out && typeof (out as AiFailure).error === 'string' ? (out as AiFailure) : { error: 'failed', message: `Server error (HTTP ${res.status})` };
    return out;
  } catch (e) {
    return { error: 'failed', message: e instanceof Error ? e.message : 'Network error' };
  }
}
export const isFailure = (x: unknown): x is AiFailure => !!x && typeof x === 'object' && typeof (x as AiFailure).error === 'string' && typeof (x as AiFailure).message === 'string';
