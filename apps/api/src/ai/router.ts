// Which AI answers a request (spec S6, D7): the user's own key first, else the included AI within the plan's limits.
import { LLM_PRESETS, type LlmClient, type LlmError, type LlmProviderId } from '@viewproof/providers';
import type { Deps } from '../app';
import { decryptForUser } from '../crypto';
import { type AiTask, aiLimit, limitMessage, planOf as planOfUser } from '../plans';

export type AiChoice = { client: LlmClient; via: 'own' | 'included'; release: () => Promise<void> };
export type AiRefusal = { error: 'no_ai' | 'limit' | 'key_unreadable'; message: string; used?: number; limit?: number };
export interface AiKeyRow { user_id: string; provider: string; base_url: string | null; quick_model: string; coach_model: string; key_box: string; key_hint: string; updated_at: string }
export interface UsageCount { used: number; limit: number | null }

const NO_AI = 'No AI is set up on this server. Add your own key in Settings → AI & apps.';
const UNREADABLE = "Your saved key can't be read any more. Save it again in Settings → AI & apps.";
const IS_PRO: Record<AiTask, string> = {
  quick: 'AI quick actions are not included on this plan. Add your own key in Settings → AI & apps.',
  coach: 'Ask AI uses the deeper model, included with Pro. Add your own key to use it now.',
  brief: 'The weekly brief is included with Pro. Add your own key in Settings → AI & apps to use it now.',
};
const TASK_NAME: Record<AiTask, string> = { quick: 'quick actions', coach: 'Ask AI messages', brief: 'weekly briefs' };
/** Which of the server's models a task uses; own keys use their quick model for quick actions, their deeper model otherwise. */
const includedModel = (ai: NonNullable<Deps['config']['ai']>, task: AiTask) => (task === 'quick' ? ai.quickModel : task === 'coach' ? ai.coachModel : ai.briefModel);
const limitText = (task: AiTask, limit: number) =>
  `You've used all ${limit} ${TASK_NAME[task]} included this month. Add your own key in Settings → AI & apps to keep going.`;

export const monthOf = (now: number) => new Date(now).toISOString().slice(0, 7);
export const label = (p: LlmProviderId | string) => LLM_PRESETS[p as LlmProviderId]?.label ?? p;
const finite = (n: number) => (Number.isFinite(n) ? n : null);

export const ownKey = (deps: Deps, userId: string) => deps.db.prepare('SELECT * FROM ai_keys WHERE user_id = ?').bind(userId).first<AiKeyRow>();
const planOf = (deps: Deps, userId: string) => planOfUser(deps.db, userId);

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
  const plan = await planOf(deps, userId);
  const limit = aiLimit(plan, deps.config.selfHosted, task);
  const month = monthOf(deps.now());
  const usedNow = async () =>
    (await deps.db.prepare(`SELECT ${task} AS n FROM ai_usage WHERE user_id = ? AND month = ?`).bind(userId, month).first<{ n: number }>())?.n ?? 0;
  if (limit === 0) return { error: 'limit', message: IS_PRO[task], used: await usedNow(), limit: 0 };
  // Reserve one use atomically; the WHERE on the upsert keeps concurrent requests from passing the limit.
  const cap = Number.isFinite(limit) ? limit : Number.MAX_SAFE_INTEGER;
  const r = await deps.db
    .prepare(`INSERT INTO ai_usage (user_id, month, ${task}) VALUES (?, ?, 1) ON CONFLICT(user_id, month) DO UPDATE SET ${task} = ${task} + 1 WHERE ${task} < ?`)
    .bind(userId, month, cap)
    .run();
  if (!r.meta.changes) return { error: 'limit', message: limitMessage(limitText(task, limit), plan, !!deps.config.billing), used: await usedNow(), limit };
  const client = deps.llm({ provider: ai.provider, apiKey: ai.apiKey, model: includedModel(ai, task), baseUrl: ai.baseUrl });
  const release = async () => {
    await deps.db.prepare(`UPDATE ai_usage SET ${task} = MAX(${task} - 1, 0) WHERE user_id = ? AND month = ?`).bind(userId, month).run();
  };
  return { client, via: 'included', release };
}

export async function aiUsage(deps: Deps, userId: string): Promise<{ month: string; quick: UsageCount; coach: UsageCount; brief: UsageCount }> {
  const month = monthOf(deps.now());
  const row = await deps.db.prepare('SELECT quick, coach, brief FROM ai_usage WHERE user_id = ? AND month = ?').bind(userId, month).first<{ quick: number; coach: number; brief: number }>();
  const plan = await planOf(deps, userId);
  return {
    month,
    quick: { used: row?.quick ?? 0, limit: finite(aiLimit(plan, deps.config.selfHosted, 'quick')) },
    coach: { used: row?.coach ?? 0, limit: finite(aiLimit(plan, deps.config.selfHosted, 'coach')) },
    brief: { used: row?.brief ?? 0, limit: finite(aiLimit(plan, deps.config.selfHosted, 'brief')) },
  };
}

/** Refund only failures the user can't cause; a prompt can force a cut-off, a refusal or unreadable output. */
export const refundable = (e: LlmError['error']) => e === 'unavailable' || e === 'rate_limited' || e === 'auth' || e === 'bad_request';

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
