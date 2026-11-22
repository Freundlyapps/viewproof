// Provider-agnostic text generation (spec §6 S6, D7). Anthropic goes through its official SDK;
// every other provider through the OpenAI-compatible chat completions API.
import Anthropic, { APIConnectionError, APIError } from '@anthropic-ai/sdk';

export type LlmProviderId = 'anthropic' | 'openai' | 'gemini' | 'deepseek' | 'openrouter' | 'custom';
export interface LlmMessage { role: 'user' | 'assistant'; content: string }
export interface LlmRequest { system: string; messages: LlmMessage[]; maxTokens: number }
export interface LlmResult { text: string; model: string; inputTokens: number; outputTokens: number }
export interface LlmError { error: 'auth' | 'rate_limited' | 'unavailable' | 'bad_request' | 'refused' | 'truncated'; message: string }
export interface LlmClient { provider: LlmProviderId; model: string; complete(r: LlmRequest): Promise<LlmResult | LlmError> }
export interface LlmPreset { label: string; baseUrl: string | null; quickModel: string | null; coachModel: string | null; note?: string }

/** Only Anthropic ships default models; for the others the user types the model name from their provider. */
export const LLM_PRESETS: Record<LlmProviderId, LlmPreset> = {
  anthropic: { label: 'Anthropic (Claude)', baseUrl: null, quickModel: 'claude-haiku-5-5', coachModel: 'claude-sonnet-5-5' },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', quickModel: null, coachModel: null },
  gemini: { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', quickModel: null, coachModel: null },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', quickModel: null, coachModel: null, note: "DeepSeek's API is hosted in China; your channel data is sent there." },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', quickModel: null, coachModel: null },
  custom: { label: 'Custom (OpenAI-compatible)', baseUrl: null, quickModel: null, coachModel: null, note: 'Any server with an OpenAI-compatible API, such as a local Ollama.' },
};

const ERROR_KINDS = ['auth', 'rate_limited', 'unavailable', 'bad_request', 'refused', 'truncated'];
export const isLlmError = (x: unknown): x is LlmError =>
  !!x && typeof x === 'object' && ERROR_KINDS.includes(String((x as { error?: unknown }).error)) && typeof (x as { message?: unknown }).message === 'string';

const err = (error: LlmError['error'], message: string): LlmError => ({ error, message: message.slice(0, 200) });

function byStatus(status: number, message: string): LlmError {
  if (status === 401 || status === 403) return err('auth', message || 'The key was refused');
  if (status === 429) return err('rate_limited', message || 'Rate limited');
  if (status >= 500) return err('unavailable', message || `The AI service failed (HTTP ${status})`);
  return err('bad_request', message || `The AI service rejected the request (HTTP ${status})`);
}

function anthropicClient(apiKey: string, model: string, fetchFn?: typeof fetch): LlmClient {
  const client = new Anthropic({ apiKey, maxRetries: 1, ...(fetchFn ? { fetch: fetchFn } : {}) });
  return {
    provider: 'anthropic',
    model,
    async complete(r) {
      try {
        const m = await client.messages.create({ model, max_tokens: r.maxTokens, system: r.system, messages: r.messages });
        if (m.stop_reason === 'refusal') return err('refused', 'The AI declined to answer');
        if (m.stop_reason === 'max_tokens') return err('truncated', 'The answer was cut off');
        const text = m.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
        return { text, model: m.model, inputTokens: m.usage.input_tokens, outputTokens: m.usage.output_tokens };
      } catch (e) {
        if (e instanceof APIConnectionError) return err('unavailable', 'Could not reach Anthropic');
        if (e instanceof APIError && typeof e.status === 'number') {
          const body = e.error as { error?: { message?: string } } | undefined;
          return byStatus(e.status, body?.error?.message ?? '');
        }
        return err('unavailable', e instanceof Error ? e.message : 'Anthropic request failed');
      }
    },
  };
}

function openAiCompatible(provider: LlmProviderId, baseUrl: string, apiKey: string, model: string, fetchFn: typeof fetch): LlmClient {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  return {
    provider,
    model,
    async complete(r) {
      let res: Response;
      try {
        res = await fetchFn(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
          // OpenAI's newer models refuse max_tokens; the other providers only know max_tokens.
          body: JSON.stringify({ model, [provider === 'openai' ? 'max_completion_tokens' : 'max_tokens']: r.maxTokens, messages: [{ role: 'system', content: r.system }, ...r.messages] }),
        });
      } catch {
        return err('unavailable', `Could not reach ${LLM_PRESETS[provider].label}`);
      }
      const body = (await res.json().catch(() => null)) as any;
      if (!res.ok) return byStatus(res.status, typeof body?.error?.message === 'string' ? body.error.message : '');
      const choice = body?.choices?.[0];
      if (choice?.finish_reason === 'length') return err('truncated', 'The answer was cut off');
      if (choice?.finish_reason === 'content_filter') return err('refused', 'The AI declined to answer');
      const text = choice?.message?.content;
      if (typeof text !== 'string') return err('unavailable', 'The AI service returned no text');
      return {
        text,
        model: typeof body.model === 'string' ? body.model : model,
        inputTokens: Number(body.usage?.prompt_tokens) || 0,
        outputTokens: Number(body.usage?.completion_tokens) || 0,
      };
    },
  };
}

export function llmClient(o: { provider: LlmProviderId; apiKey: string; model: string; baseUrl?: string | null; fetchFn?: typeof fetch }): LlmClient {
  if (o.provider === 'anthropic') return anthropicClient(o.apiKey, o.model, o.fetchFn);
  const baseUrl = o.provider === 'custom' ? o.baseUrl : LLM_PRESETS[o.provider].baseUrl;
  if (!baseUrl) throw new Error(`${o.provider} needs a base URL`);
  return openAiCompatible(o.provider, baseUrl, o.apiKey, o.model, o.fetchFn ?? ((...a) => fetch(...a)));
}
