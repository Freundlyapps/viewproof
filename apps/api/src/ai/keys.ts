// Settings → AI & apps: the included AI, the user's own key (D7) and this month's use.
import { LLM_PRESETS, type LlmProviderId, isLlmError } from '@viewproof/providers';
import type { Context, Hono } from 'hono';
import type { Deps } from '../app';
import { encryptForUser } from '../crypto';
import { readSession } from '../session';
import { aiUsage, label, llmFailure, ownKey } from './router';

const err = (c: Context, status: number, error: string, message: string) => c.json({ error, message }, status as 400);
const MODEL = /^[\w.:/-]{1,100}$/;
export const CUSTOM_HOSTED = 'Custom servers are only available when you host ViewProof yourself.';

type KeyInput = { provider: LlmProviderId; apiKey: string; quickModel: string; coachModel: string; baseUrl: string | null };

function parseKeyInput(body: unknown, selfHosted: boolean): KeyInput | string {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const provider = String(b.provider ?? '') as LlmProviderId;
  if (!(provider in LLM_PRESETS)) return 'Choose a provider.';
  const apiKey = typeof b.apiKey === 'string' ? b.apiKey.trim() : '';
  if (apiKey.length < 8 || apiKey.length > 400) return 'Paste the full API key from your provider.';
  const preset = LLM_PRESETS[provider];
  const pick = (v: unknown, d: string | null) => (typeof v === 'string' && v.trim() ? v.trim() : d);
  const quickModel = pick(b.quickModel, preset.quickModel);
  const coachModel = pick(b.coachModel, preset.coachModel);
  if (!quickModel || !coachModel) return `Type the model names from ${preset.label} (one for quick actions, one for Ask AI).`;
  if (!MODEL.test(quickModel) || !MODEL.test(coachModel)) return 'A model name has characters it can’t have.';
  let baseUrl: string | null = null;
  if (provider === 'custom') {
    if (!selfHosted) return CUSTOM_HOSTED;
    try {
      const u = new URL(String(b.baseUrl ?? ''));
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('scheme');
      baseUrl = u.toString().replace(/\/+$/, '');
    } catch {
      return 'Enter the server address, for example http://localhost:11434/v1';
    }
  }
  return { provider, apiKey, quickModel, coachModel, baseUrl };
}

export function aiKeyRoutes(app: Hono, deps: Deps): void {
  app.get('/api/ai/status', async (c) => {
    const s = await readSession(c, deps);
    if (!s) return err(c, 401, 'signed_out', 'Sign in first.');
    const own = await ownKey(deps, s.userId);
    const ai = deps.config.ai;
    return c.json({
      included: ai ? { provider: ai.provider, label: label(ai.provider), quickModel: ai.quickModel, coachModel: ai.coachModel } : null,
      own: own ? { provider: own.provider, label: label(own.provider), quickModel: own.quick_model, coachModel: own.coach_model, baseUrl: own.base_url, keyHint: own.key_hint } : null,
      usage: await aiUsage(deps, s.userId),
      presets: LLM_PRESETS,
      customAllowed: deps.config.selfHosted,
    });
  });

  app.post('/api/ai/key', async (c) => {
    const s = await readSession(c, deps);
    if (!s) return err(c, 401, 'signed_out', 'Sign in first.');
    const input = parseKeyInput(await c.req.json().catch(() => null), deps.config.selfHosted);
    if (typeof input === 'string') return err(c, 400, 'bad_input', input);
    // One small call proves the key and the model name work before anything is stored.
    const client = deps.llm({ provider: input.provider, apiKey: input.apiKey, model: input.quickModel, baseUrl: input.baseUrl });
    const r = await client.complete({ system: 'Reply with OK.', messages: [{ role: 'user', content: 'OK?' }], maxTokens: 64 });
    if (isLlmError(r) && r.error !== 'truncated') {
      const f = llmFailure(r, 'own', input.provider);
      return err(c, 400, f.error, f.error === 'bad_request' ? `${label(input.provider)} rejected the test: ${r.message}` : f.message);
    }
    await deps.db
      .prepare(`INSERT INTO ai_keys (user_id, provider, base_url, quick_model, coach_model, key_box, key_hint, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET provider = excluded.provider, base_url = excluded.base_url, quick_model = excluded.quick_model,
        coach_model = excluded.coach_model, key_box = excluded.key_box, key_hint = excluded.key_hint, updated_at = excluded.updated_at`)
      .bind(s.userId, input.provider, input.baseUrl, input.quickModel, input.coachModel,
        await encryptForUser(input.apiKey, s.userId, deps.config.tokenKey), `…${input.apiKey.slice(-4)}`, new Date(deps.now()).toISOString())
      .run();
    return c.json({ ok: true });
  });

  app.delete('/api/ai/key', async (c) => {
    const s = await readSession(c, deps);
    if (!s) return err(c, 401, 'signed_out', 'Sign in first.');
    await deps.db.prepare('DELETE FROM ai_keys WHERE user_id = ?').bind(s.userId).run();
    return c.json({ ok: true });
  });
}
