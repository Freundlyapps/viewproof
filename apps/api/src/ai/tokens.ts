// Measured AI cost: every answer's real token counts, summed per month, task and model, with no link to any account.
import type { Deps } from '../app';
import type { AiTask } from '../plans';

export async function recordTokens(deps: Deps, task: AiTask, provider: string, model: string, via: 'own' | 'included', input: number, output: number): Promise<void> {
  const month = new Date(deps.now()).toISOString().slice(0, 7);
  await deps.db
    .prepare(`INSERT INTO ai_tokens (month, task, provider, model, via, runs, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(month, task, provider, model, via) DO UPDATE SET runs = runs + 1, input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens`)
    .bind(month, task, provider, model.slice(0, 100), via, Math.max(0, Math.round(input) || 0), Math.max(0, Math.round(output) || 0))
    .run();
}

/** USD per million tokens (input, output) for models we can price; from the Anthropic price list, 2026-11. Others: unpriced. */
export const PRICES: Record<string, [number, number]> = {
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-sonnet-5-5': [2, 10],
  'claude-opus-5-5': [4, 20],
  'claude-fable-5-2': [8, 40],
};

export function priced(model: string, input: number, output: number): number | null {
  const p = PRICES[model] ?? Object.entries(PRICES).find(([k]) => model.startsWith(k))?.[1];
  return p ? (input * p[0] + output * p[1]) / 1e6 : null;
}
