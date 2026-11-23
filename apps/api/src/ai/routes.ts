// Quick actions and Ask AI (spec §8 item 6). Nothing about the prompt or the answer is stored.
import { type LlmMessage, isLlmError } from '@viewproof/providers';
import type { Context, Hono } from 'hono';
import type { Deps } from '../app';
import type { AiTask } from '../plans';
import { readSession } from '../session';
import { type AiItem, citations, parseItems } from './answer';
import { type QuickAction, SYSTEM_QUICK, askSystem, missingLine, quickPrompt } from './prompts';
import { type AiChoice, aiUsage, chooseAi, label, llmFailure, refundable } from './router';
import { type Missing, type SourceKind, gatherSources, sourceBlock } from './sources';


const err = (c: Context, status: number, body: Record<string, unknown>) => c.json(body, status as 400);
const bad = (c: Context, message: string) => err(c, 400, { error: 'bad_request', message });

const SOURCES: Record<QuickAction, SourceKind[]> = {
  titles: ['videos', 'terms', 'outliers', 'competitors'],
  description: ['videos', 'terms'],
  tags: ['terms', 'videos'],
  ideas: ['channel', 'videos', 'terms', 'competitors', 'outliers'],
};
const COUNT: Record<QuickAction, number> = { titles: 10, description: 1, tags: 20, ideas: 5 };
const ALL: SourceKind[] = ['channel', 'videos', 'terms', 'competitors', 'outliers'];
const TAGS_MAX_CHARS = 500; // YouTube's limit for all tags together
const BAD_OUTPUT = "The AI's answer couldn't be read. Try again.";

/** Tags within YouTube's limit: each ≤ 100 characters, all together ≤ 500 (counted with separators). */
function capTags(items: AiItem[]): AiItem[] {
  const out: AiItem[] = [];
  let total = 0;
  for (const i of items) {
    const t = i.text.replace(/[<>,]/g, '').trim();
    if (!t || t.length > 100) continue;
    const add = (out.length ? 1 : 0) + t.length;
    if (total + add > TAGS_MAX_CHARS) break;
    total += add;
    out.push({ ...i, text: t });
  }
  return out;
}

const refusalStatus = (e: string) => (e === 'limit' ? 402 : 409);

async function choose(c: Context, deps: Deps, userId: string, task: AiTask): Promise<AiChoice | Response> {
  const r = await chooseAi(deps, userId, task);
  return 'error' in r ? err(c, refusalStatus(r.error), r) : r;
}

function parseMessages(body: Record<string, unknown>): LlmMessage[] | string {
  const m = body.messages;
  if (!Array.isArray(m) || m.length < 1 || m.length > 20) return 'Send between 1 and 20 messages.';
  const out: LlmMessage[] = [];
  for (const [i, x] of m.entries()) {
    const role = (x as { role?: unknown })?.role;
    const content = (x as { content?: unknown })?.content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string' || !content.trim()) return 'Each message needs a role and text.';
    if (content.length > (role === 'user' ? 4000 : 40_000)) return 'A message can be at most 4,000 characters.';
    if (role !== (i % 2 === 0 ? 'user' : 'assistant')) return 'Messages must take turns, starting with yours.';
    out.push({ role, content });
  }
  if (out[out.length - 1]!.role !== 'user') return 'The last message must be yours.';
  return out;
}

export function aiRoutes(app: Hono, deps: Deps): void {
  app.post('/api/ai/quick', async (c) => {
    const s = await readSession(c, deps);
    if (!s) return err(c, 401, { error: 'signed_out', message: 'Sign in first.' });
    const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const action = b.action as QuickAction;
    if (!(action in SOURCES)) return bad(c, 'Choose titles, description, tags or ideas.');
    const topic = typeof b.topic === 'string' ? b.topic.trim() : '';
    const notes = typeof b.notes === 'string' ? b.notes.trim() : '';
    if (action !== 'ideas' && !topic) return bad(c, 'Enter a topic or keyword.');
    if (topic.length > 200) return bad(c, 'Keep the topic under 200 characters.');
    if (notes.length > 1000) return bad(c, 'Keep the notes under 1,000 characters.');

    const choice = await choose(c, deps, s.userId, 'quick');
    if (choice instanceof Response) return choice;
    const { sources, missing } = await gatherSources(deps, s.userId, SOURCES[action], typeof b.channel === 'string' ? b.channel : null);
    const r = await choice.client.complete({ system: SYSTEM_QUICK, messages: [{ role: 'user', content: quickPrompt(action, topic, notes, sourceBlock(sources), missingLine(missing)) }], maxTokens: 4000 });
    if (isLlmError(r)) {
      if (refundable(r.error)) await choice.release();
      const f = llmFailure(r, choice.via, choice.client.provider);
      return err(c, f.status, { error: f.error, message: f.message });
    }
    const parsed = parseItems(r.text, new Set(sources.map((x) => x.id)));
    const items = parsed && (action === 'tags' ? capTags(parsed) : parsed.slice(0, COUNT[action]));
    if (!items?.length) return err(c, 502, { error: 'bad_output', message: BAD_OUTPUT });
    return c.json({
      items, sources, missing,
      ai: { provider: choice.client.provider, label: label(choice.client.provider), model: choice.client.model, via: choice.via },
      usage: await aiUsage(deps, s.userId),
    });
  });

  app.post('/api/ai/ask', async (c) => {
    const s = await readSession(c, deps);
    if (!s) return err(c, 401, { error: 'signed_out', message: 'Sign in first.' });
    const b = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const messages = parseMessages(b);
    if (typeof messages === 'string') return bad(c, messages);

    const choice = await choose(c, deps, s.userId, 'coach');
    if (choice instanceof Response) return choice;
    const { sources, missing } = await gatherSources(deps, s.userId, ALL, typeof b.channel === 'string' ? b.channel : null);
    const r = await choice.client.complete({ system: askSystem(sourceBlock(sources), missingLine(missing)), messages, maxTokens: 8000 });
    if (isLlmError(r)) {
      if (refundable(r.error)) await choice.release();
      const f = llmFailure(r, choice.via, choice.client.provider);
      return err(c, f.status, { error: f.error, message: f.message });
    }
    const answer = r.text.trim();
    if (!answer) return err(c, 502, { error: 'bad_output', message: BAD_OUTPUT });
    const { cited, unknown } = citations(answer, new Set(sources.map((x) => x.id)));
    return c.json({
      answer, cited, unknownCitations: unknown, sources, missing,
      ai: { provider: choice.client.provider, label: label(choice.client.provider), model: choice.client.model, via: choice.via },
      usage: await aiUsage(deps, s.userId),
    });
  });
}
