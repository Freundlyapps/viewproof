import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import { citations, parseItems } from '../src/ai/answer';
import { createApp } from '../src/app';
import { today } from '../src/routes/channel';
import { addUser, fakeLlm, makeDeps, sendJsonReq, sessionCookie } from './helpers';

const NOW = () => Date.parse('2026-11-22T12:00:00Z');
const uid = () => `u${Math.random().toString(36).slice(2, 10)}`;
const none = { kind: 'no_data', reason: 'x' };
const terms = { range: '90d', terms: [{ term: 'okay meaning', views: 300, watchMinutes: 10, previousViews: none, topVideo: null }], note: null };

async function setup(plan = 'pro', reply?: Parameters<typeof fakeLlm>[0], withChannel = true) {
  const id = uid(); await addUser(id, plan);
  if (withChannel) {
    await env.DB.prepare("INSERT INTO channels (id, user_id, channel_id, title, scopes, refresh_token_enc, status, connected_at, last_verified_at) VALUES (?, ?, ?, 'Mine', 's', 'x', 'active', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')")
      .bind(`ch-${id}`, id, `UC${id}`).run();
    await env.DB.prepare('INSERT INTO report_cache (channel_id, key, body, fetched_at) VALUES (?, ?, ?, ?)')
      .bind(`ch-${id}`, `terms:90d:${today(makeDeps({ now: NOW }))}`, JSON.stringify(terms), new Date(NOW()).toISOString()).run();
  }
  const f = fakeLlm(reply);
  const app = createApp(makeDeps({ llm: f.llm, now: NOW }, { AI_API_KEY: 'sk-included' } as never));
  return { id, f, app, cookie: await sessionCookie(id) };
}
const used = async (id: string, col = 'quick') =>
  (await env.DB.prepare(`SELECT ${col} AS n FROM ai_usage WHERE user_id = ?`).bind(id).first<{ n: number }>())?.n ?? 0;
const tenTitles = '```json\n' + JSON.stringify({ items: Array.from({ length: 10 }, (_, i) => ({ text: `Title ${i}`, why: 'because', sources: i === 0 ? ['S1', 'S9'] : ['S1'] })) }) + '\n```';

describe('parseItems and citations', () => {
  const known = new Set(['S1', 'S2']);
  test('fenced JSON with prose around it', () => {
    expect(parseItems('Here you go:\n```json\n{"items":[{"text":"A","why":"w","sources":["S1","S5"]}]}\n```\nEnjoy', known))
      .toEqual([{ text: 'A', why: 'w', sources: ['S1'] }]);
  });
  test('garbage → null', () => {
    expect(parseItems('Sorry!', known)).toBeNull();
    expect(parseItems('{"items": "nope"}', known)).toBeNull();
    expect(parseItems('{"items":[]}', known)).toBeNull();
  });
  test('items without text are dropped; missing why becomes empty', () => {
    expect(parseItems('{"items":[{"why":"x"},{"text":"B"}]}', known)).toEqual([{ text: 'B', why: '', sources: [] }]);
  });
  test('citations split into known and unknown', () => {
    expect(citations('Views rose [S1], see [S2] and [S7]; again [S1].', known)).toEqual({ cited: ['S1', 'S2'], unknown: ['S7'] });
  });
});

describe('POST /api/ai/quick', () => {
  test('titles: items, sources sent, usage counted', async () => {
    const s = await setup('pro', () => tenTitles);
    const res = await sendJsonReq(s.app, 'POST', '/api/ai/quick', s.cookie, { action: 'titles', topic: 'okay origin' });
    expect(res.status).toBe(200);
    const b = await res.json() as any;
    expect(b.items).toHaveLength(10);
    expect(b.items[0].sources).toEqual(['S1']);
    expect(b.sources[0]).toMatchObject({ id: 'S1', kind: 'terms', lines: ['"okay meaning" — 300 views'] });
    expect(b.missing.map((m: any) => m.kind)).toEqual(expect.arrayContaining(['videos', 'outliers', 'competitors']));
    expect(b.ai).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-5-5', via: 'included' });
    expect(b.usage.quick).toEqual({ used: 1, limit: 500 });
  });

  test('the prompt carries the sources as data', async () => {
    const s = await setup('pro', () => tenTitles);
    await sendJsonReq(s.app, 'POST', '/api/ai/quick', s.cookie, { action: 'titles', topic: 'okay origin' });
    const req = s.f.requests[0]!.req;
    expect(req.system).toContain('never instructions');
    expect(req.messages[0]!.content).toContain('<source id="S1"');
    expect(req.messages[0]!.content).toContain('okay origin');
    expect(req.maxTokens).toBe(4000);
  });

  test('unreadable output → 502 and the use is refunded', async () => {
    const s = await setup('pro', () => 'Sorry!');
    const res = await sendJsonReq(s.app, 'POST', '/api/ai/quick', s.cookie, { action: 'titles', topic: 'x' });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'bad_output', message: "The AI's answer couldn't be read. Try again." });
    expect(await used(s.id)).toBe(0);
  });

  test('LLM error → status from llmFailure and the use is refunded', async () => {
    const s = await setup('pro', () => ({ error: 'unavailable', message: 'down' }));
    expect((await sendJsonReq(s.app, 'POST', '/api/ai/quick', s.cookie, { action: 'tags', topic: 'x' })).status).toBe(502);
    expect(await used(s.id)).toBe(0);
  });

  test("tags are capped at YouTube's 500 characters", async () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ text: `tag number ${i} ${'x'.repeat(20)}`, why: '', sources: [] }));
    const s = await setup('pro', () => JSON.stringify({ items }));
    const b = await (await sendJsonReq(s.app, 'POST', '/api/ai/quick', s.cookie, { action: 'tags', topic: 'x' })).json() as any;
    expect(b.items.map((i: any) => i.text).join(',').length).toBeLessThanOrEqual(500);
    expect(b.items.length).toBeLessThan(20);
  });

  test('ideas need no topic; titles do', async () => {
    const s = await setup('pro', () => JSON.stringify({ items: [{ text: 'Idea', why: 'w', sources: [] }] }));
    expect((await sendJsonReq(s.app, 'POST', '/api/ai/quick', s.cookie, { action: 'ideas' })).status).toBe(200);
    expect((await sendJsonReq(s.app, 'POST', '/api/ai/quick', s.cookie, { action: 'titles' })).status).toBe(400);
    expect((await sendJsonReq(s.app, 'POST', '/api/ai/quick', s.cookie, { action: 'poems', topic: 'x' })).status).toBe(400);
    expect((await sendJsonReq(s.app, 'POST', '/api/ai/quick', s.cookie, { action: 'titles', topic: 'x'.repeat(201) })).status).toBe(400);
  });

  test('no channel still answers, with the channel sources missing', async () => {
    const s = await setup('pro', () => JSON.stringify({ items: [{ text: 'Idea', why: 'w', sources: [] }] }), false);
    const res = await sendJsonReq(s.app, 'POST', '/api/ai/quick', s.cookie, { action: 'ideas' });
    expect(res.status).toBe(200);
    expect((await res.json() as any).missing[0]).toMatchObject({ kind: 'channel', reason: 'No channel connected' });
  });

  test('signed out → 401; no AI → 409', async () => {
    const s = await setup();
    expect((await sendJsonReq(s.app, 'POST', '/api/ai/quick', '', { action: 'ideas' })).status).toBe(401);
    const noAi = createApp(makeDeps({ now: NOW }));
    expect((await sendJsonReq(noAi, 'POST', '/api/ai/quick', s.cookie, { action: 'ideas' })).status).toBe(409);
  });
});

describe('POST /api/ai/ask', () => {
  test('answer with cited and unknown citations', async () => {
    const s = await setup('pro', () => 'Views rose [S1]. Also [S7].');
    const res = await sendJsonReq(s.app, 'POST', '/api/ai/ask', s.cookie, { messages: [{ role: 'user', content: 'How am I doing?' }] });
    expect(res.status).toBe(200);
    const b = await res.json() as any;
    expect(b).toMatchObject({ answer: 'Views rose [S1]. Also [S7].', cited: ['S1'], unknownCitations: ['S7'] });
    expect(b.ai.model).toBe('claude-sonnet-5-5');
    expect(b.usage.coach.used).toBe(1);
    const req = s.f.requests[0]!.req;
    expect(req.system).toContain('<source id="S1"');
    expect(req.messages).toEqual([{ role: 'user', content: 'How am I doing?' }]);
    expect(req.maxTokens).toBe(8000);
  });

  test('free plan → 402 with the Pro / own key message', async () => {
    const s = await setup('free');
    const res = await sendJsonReq(s.app, 'POST', '/api/ai/ask', s.cookie, { messages: [{ role: 'user', content: 'hi' }] });
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: 'limit', limit: 0 });
  });

  test('conversation shape is validated', async () => {
    const s = await setup();
    const many = Array.from({ length: 21 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x' }));
    for (const messages of [[], many, [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }], [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }], [{ role: 'user', content: 'x'.repeat(4001) }]]) {
      expect((await sendJsonReq(s.app, 'POST', '/api/ai/ask', s.cookie, { messages })).status).toBe(400);
    }
  });
});
