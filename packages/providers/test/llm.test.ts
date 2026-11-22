import { describe, expect, test } from 'vitest';
import { LLM_PRESETS, isLlmError, llmClient, type LlmRequest } from '../src';

const REQ: LlmRequest = { system: 'sys', messages: [{ role: 'user', content: 'hi' }], maxTokens: 100 };

function fakeFetch(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit; body: any }[] = [];
  const fn = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url instanceof Request ? url.url : url), init, body: init.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const header = (init: RequestInit, name: string) => new Headers(init.headers as HeadersInit).get(name);

describe('OpenAI-compatible providers', () => {
  const ok = { choices: [{ message: { content: 'answer' }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 3 }, model: 'm-1' };

  test('request shape and result', async () => {
    const f = fakeFetch(ok);
    const c = llmClient({ provider: 'openai', apiKey: 'k', model: 'm-1', fetchFn: f.fn });
    const r = await c.complete(REQ);
    expect(r).toEqual({ text: 'answer', model: 'm-1', inputTokens: 12, outputTokens: 3 });
    expect(f.calls[0]!.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(header(f.calls[0]!.init, 'authorization')).toBe('Bearer k');
    expect(f.calls[0]!.body).toEqual({ model: 'm-1', max_completion_tokens: 100, messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }] });
  });

  test('OpenAI gets max_completion_tokens (newer models refuse max_tokens)', async () => {
    const f = fakeFetch(ok);
    await llmClient({ provider: 'openai', apiKey: 'k', model: 'gpt-x', fetchFn: f.fn }).complete(REQ);
    expect(f.calls[0]!.body.max_completion_tokens).toBe(100);
    expect(f.calls[0]!.body.max_tokens).toBeUndefined();
  });

  test('custom base URL with a trailing slash; missing usage counts as 0', async () => {
    const f = fakeFetch({ choices: [{ message: { content: 'x' }, finish_reason: 'stop' }] });
    const r = await llmClient({ provider: 'custom', apiKey: '', model: 'llama', baseUrl: 'http://localhost:11434/v1/', fetchFn: f.fn }).complete(REQ);
    expect(f.calls[0]!.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(r).toMatchObject({ text: 'x', model: 'llama', inputTokens: 0, outputTokens: 0 });
  });

  test.each([
    ['length', 'truncated'],
    ['content_filter', 'refused'],
  ])('finish_reason %s → %s', async (reason, error) => {
    const f = fakeFetch({ choices: [{ message: { content: 'x' }, finish_reason: reason }] });
    const r = await llmClient({ provider: 'deepseek', apiKey: 'k', model: 'm', fetchFn: f.fn }).complete(REQ);
    expect(isLlmError(r) && r.error).toBe(error);
  });

  test.each([
    [401, 'auth'], [403, 'auth'], [429, 'rate_limited'], [500, 'unavailable'], [503, 'unavailable'], [400, 'bad_request'],
  ])('HTTP %i → %s', async (status, error) => {
    const f = fakeFetch({ error: { message: 'x'.repeat(300) } }, status);
    const r = await llmClient({ provider: 'gemini', apiKey: 'k', model: 'm', fetchFn: f.fn }).complete(REQ);
    expect(isLlmError(r) && r.error).toBe(error);
    if (status === 400 && isLlmError(r)) expect(r.message.length).toBeLessThanOrEqual(200);
  });

  test('network failure → unavailable', async () => {
    const fn = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    const r = await llmClient({ provider: 'openrouter', apiKey: 'k', model: 'm', fetchFn: fn }).complete(REQ);
    expect(isLlmError(r) && r.error).toBe('unavailable');
  });

  test('custom without a base URL is a programming error', () => {
    expect(() => llmClient({ provider: 'custom', apiKey: '', model: 'm' })).toThrow();
  });
});

describe('Anthropic through the official SDK', () => {
  const msg = (over: object = {}) => ({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'end_turn', stop_sequence: null,
    content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: 'Hello ' }, { type: 'text', text: 'there' }],
    usage: { input_tokens: 20, output_tokens: 5 }, ...over,
  });

  test('text blocks joined, thinking ignored, no thinking field sent', async () => {
    const f = fakeFetch(msg());
    const r = await llmClient({ provider: 'anthropic', apiKey: 'sk-test', model: 'claude-haiku-5-5', fetchFn: f.fn }).complete(REQ);
    expect(r).toEqual({ text: 'Hello there', model: 'claude-haiku-5-5', inputTokens: 20, outputTokens: 5 });
    expect(f.calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(f.calls[0]!.body).toEqual({ model: 'claude-haiku-5-5', max_tokens: 100, system: 'sys', messages: [{ role: 'user', content: 'hi' }] });
    expect(header(f.calls[0]!.init, 'authorization')).toBe('Bearer sk-test');
  });

  test.each([
    ['refusal', 'refused'],
    ['max_tokens', 'truncated'],
  ])('stop_reason %s → %s', async (stop, error) => {
    const f = fakeFetch(msg({ stop_reason: stop }));
    const r = await llmClient({ provider: 'anthropic', apiKey: 'k', model: 'claude-haiku-5-5', fetchFn: f.fn }).complete(REQ);
    expect(isLlmError(r) && r.error).toBe(error);
  });

  test.each([
    [401, 'auth'], [429, 'rate_limited'], [529, 'unavailable'], [400, 'bad_request'],
  ])('HTTP %i → %s', async (status, error) => {
    const f = fakeFetch({ type: 'error', error: { type: 'x', message: 'nope' } }, status);
    const r = await llmClient({ provider: 'anthropic', apiKey: 'k', model: 'claude-haiku-5-5', fetchFn: f.fn }).complete(REQ);
    expect(isLlmError(r) && r.error).toBe(error);
  });
});

test('presets: only Anthropic ships default models', () => {
  expect(LLM_PRESETS.anthropic).toMatchObject({ quickModel: 'claude-haiku-5-5', coachModel: 'claude-sonnet-5-5', baseUrl: null });
  for (const p of ['openai', 'gemini', 'deepseek', 'openrouter', 'custom'] as const) expect(LLM_PRESETS[p].quickModel).toBeNull();
  expect(LLM_PRESETS.deepseek.note).toContain('China');
});
