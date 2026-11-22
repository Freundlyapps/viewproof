// Which AI answers a request (spec S6, D7): the user's own key first, else the included AI within the plan's limits.
import { LLM_PRESETS, type LlmClient, type LlmError, type LlmProviderId } from '@viewproof/providers';
import type { Deps } from '../app';
import { decryptForUser } from '../crypto';
import { type AiTask, aiLimit } from '../plans';

export type AiChoice = { client: LlmClient; via: 'own' | 'included'; release: () => Promise<void> };
export type AiRefusal = { error: 'no_ai' | 'limit' | 'key_unreadable'; message: string; used?: number; limit?: number };
export interface AiKeyRow { user_id: string; provider: string; base_url: string | null; quick_model: string; coach_model: string; key_box: string; key_hint: string; updated_at: string }
export interface UsageCount { used: number; limit: number | null }

const NO_AI = 'No AI is set up on this server. Add your own key in Settings → AI & apps.';
const UNREADABLE = "Your saved key can't be read any more. Save it again in Settings → AI & apps.";
const COACH_IS_PRO = 'Ask AI uses the deeper model, included with Pro. Add your own key to use it now.';
const limitText = (task: AiTask, limit: number) =>
  `You've used all ${limit} ${task === 'quick' ? 'quick actions' : 'Ask AI messages'} included this month. Add your own key in Settings → AI & apps to keep going.`;

export const monthOf = (now: number) => new Date(now).toISOString().slice(0, 7);
export const label = (p: LlmProviderId | string) => LLM_PRESETS[p as LlmProviderId]?.label ?? p;
const finite = (n: number) => (Number.isFinite(n) ? n : null);

export const ownKey = (deps: Deps, userId: string) => deps.db.prepare('SELECT * FROM ai_keys WHERE user_id = ?').bind(userId).first<AiKeyRow>();
const planOf = async (deps: Deps, userId: string) =>
  (await deps.db.prepare('SELECT plan FROM users WHERE id = ?').bind(userId).first<{ plan: string }>())?.plan ?? 'free';

export async function chooseAi(deps: Deps, userId: string, task: AiTask): Promise<AiChoice | AiRefusal> {
  const own = await ownKey(deps, userId);
  if (own) {
    let apiKey: string;
    try {
      apiKey = await decryptForUser(own.key_box, userId, deps.config.tokenKey);
    } catch {
      return { error: 'key_unreadable', message: UNREADABLE };
    }
    const client = deps.llm({ provider: own.provider as LlmProviderId, apiKey, model: task === 'quick' ? own.quick_model : own.coach_model, baseUrl: own.base_url });
    return { client, via: 'own', release: async () => {} };
  }
  const ai = deps.config.ai;
  if (!ai) return { error: 'no_ai', message: NO_AI };
  const limit = aiLimit(await planOf(deps, userId), deps.config.selfHosted, task);
  if (limit === 0) return { error: 'limit', message: COACH_IS_PRO, used: 0, limit: 0 };
  const month = monthOf(deps.now());
  // Reserve one use atomically; the WHERE on the upsert keeps concurrent requests from passing the limit.
  const cap = Number.isFinite(limit) ? limit : Number.MAX_SAFE_INTEGER;
  const r = await deps.db
    .prepare(`INSERT INTO ai_usage (user_id, month, ${task}) VALUES (?, ?, 1) ON CONFLICT(user_id, month) DO UPDATE SET ${task} = ${task} + 1 WHERE ${task} < ?`)
    .bind(userId, month, cap)
    .run();
  if (!r.meta.changes) return { error: 'limit', message: limitText(task, limit), used: limit, limit };
  const client = deps.llm({ provider: ai.provider, apiKey: ai.apiKey, model: task === 'quick' ? ai.quickModel : ai.coachModel, baseUrl: ai.baseUrl });
  const release = async () => {
    await deps.db.prepare(`UPDATE ai_usage SET ${task} = MAX(${task} - 1, 0) WHERE user_id = ? AND month = ?`).bind(userId, month).run();
  };
  return { client, via: 'included', release };
}

export async function aiUsage(deps: Deps, userId: string): Promise<{ month: string; quick: UsageCount; coach: UsageCount }> {
  const month = monthOf(deps.now());
  const row = await deps.db.prepare('SELECT quick, coach FROM ai_usage WHERE user_id = ? AND month = ?').bind(userId, month).first<{ quick: number; coach: number }>();
  const plan = await planOf(deps, userId);
  return {
    month,
    quick: { used: row?.quick ?? 0, limit: finite(aiLimit(plan, deps.config.selfHosted, 'quick')) },
    coach: { used: row?.coach ?? 0, limit: finite(aiLimit(plan, deps.config.selfHosted, 'coach')) },
  };
}

export function llmFailure(e: LlmError, via: 'own' | 'included', provider: LlmProviderId): { error: string; message: string; status: number } {
  const name = label(provider);
  switch (e.error) {
    case 'auth':
      return via === 'own'
        ? { error: 'auth', status: 400, message: `Your ${name} key was refused. Update it in Settings → AI & apps.` }
        : { error: 'auth', status: 502, message: "The included AI's key was refused. The server owner needs to fix it." };
    case 'rate_limited':
      return { error: 'rate_limited', status: 429, message: `${name} is rate-limiting ${via === 'own' ? 'this key' : 'the included AI'}. Wait a minute and try again.` };
    case 'refused':
      return { error: 'refused', status: 422, message: 'The AI declined to answer this.' };
    case 'truncated':
      return { error: 'truncated', status: 502, message: 'The answer was cut off. Try a shorter request.' };
    case 'bad_request':
      return { error: 'bad_request', status: 502, message: `${name} rejected the request: ${e.message}` };
    default:
      return { error: 'unavailable', status: 502, message: `${name} isn't answering right now. Try again in a moment.` };
  }
}
