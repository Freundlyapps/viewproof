import { describe, expect, test } from 'vitest';
import type { LlmClient, LlmRequest } from '@viewproof/providers';
import { CASES, type EvalCase } from '../eval/cases';
import { type Candidate, report, runEval } from '../eval/run';
import { buildRequest, groundedNumbers, score } from '../eval/score';
import { SYSTEM_QUICK } from '../src/ai/prompts';

const quickCase: EvalCase = {
  id: 'q', task: 'quick', action: 'titles', topic: 'pottery glaze',
  sources: [
    { kind: 'terms', label: 'Your real search terms, last 90 days', detail: 'YouTube Analytics', provenance: 'real', lines: ['"pottery glaze recipes" — 12,480 views'] },
    { kind: 'videos', label: 'Your top videos, last 90 days', detail: 'YouTube Analytics', provenance: 'real', lines: ['"Glazing 101" — 3,210 views, published 2026-09-01'] },
    { kind: 'outliers', label: 'Outliers our network observed, last 30 days', detail: 'ViewProof data pool', provenance: 'pool', lines: ['"Raku firing" (Clay Co) — ×4'] },
  ],
  missing: [],
  expect: { count: [2, 3], maxLen: 70 },
};
const coachCase: EvalCase = {
  id: 'c', task: 'coach', question: 'What search terms bring me viewers?',
  sources: quickCase.sources.slice(1),
  missing: [{ kind: 'terms', label: 'Your real search terms, last 90 days', reason: "YouTube lists search terms only once enough people searched; it doesn't publish the threshold." }],
  expect: { saysMissing: true, mustNotMention: ['BANANA'] },
};
const items = (list: { text: string; sources: string[] }[]) => JSON.stringify({ items: list.map((x) => ({ ...x, why: 'w' })) });
const check = (checks: ReturnType<typeof score>, id: string) => checks.find((c) => c.id === id)!;

describe('eval grading', () => {
  test('buildRequest uses the production prompt and numbers sources S1..Sn', () => {
    const { request, known, sourceText } = buildRequest(quickCase);
    expect(request.system).toBe(SYSTEM_QUICK);
    expect(request.maxTokens).toBe(4000);
    expect([...known]).toEqual(['S1', 'S2', 'S3']);
    expect(request.messages[0]!.content).toContain('<source id="S3"');
    expect(sourceText).toContain('12,480');
    const c = buildRequest(coachCase);
    expect(c.request.maxTokens).toBe(8000);
    expect(c.request.system).toContain('Not available: Your real search terms');
    expect(c.request.messages).toEqual([{ role: 'user', content: 'What search terms bring me viewers?' }]);
  });

  test('rounded numbers are grounded, invented ones are not', () => {
    expect(groundedNumbers('about 12.5K views and 3 videos', '12,480 views', '').ungrounded).toEqual([]);
    expect(groundedNumbers('it got 47,000 views', '12,480 views', '').ungrounded).toEqual(['47,000']);
    expect(groundedNumbers('in 2026 you grew 40%', 'views', 'grow 40%').ungrounded).toEqual([]);
    expect(groundedNumbers('1.2M views', '1,180,000 views', '').ungrounded).toEqual([]);
  });

  test('invented multipliers, small percentages and year-like counts are caught; bare small counts are not', () => {
    const src = '"Why Your Pots Crack in the Kiln" (Mud Hands) — ×6.1, 41,200 views; 46% average viewed';
    expect(groundedNumbers("Mud Hands' video hit ×8.3", src, '').ungrounded).toEqual(['×8.3']);
    expect(groundedNumbers('it did 8.3x better', src, '').ungrounded).toEqual(['8.3x']);
    expect(groundedNumbers('your CTR is 7%', src, '').ungrounded).toEqual(['7%']);
    expect(groundedNumbers('that video got 2050 views', src, '').ungrounded).toEqual(['2050']);
    expect(groundedNumbers('Mud Hands hit ×6.1 with 46% viewed; here are 5 titles, published since 2026', src, '').ungrounded).toEqual([]);
  });

  test('quick: unknown citation, too-long title and uncited item fail', () => {
    const { known, sourceText } = buildRequest(quickCase);
    const long = 'A'.repeat(71);
    const checks = score(quickCase, items([{ text: 'Pottery glaze recipes that work', sources: ['S1'] }, { text: long, sources: ['S9'] }]), known, sourceText);
    expect(check(checks, 'parses').pass).toBe(true);
    expect(check(checks, 'count').pass).toBe(true);
    expect(check(checks, 'length').pass).toBe(false);
    expect(check(checks, 'knownCitations')).toMatchObject({ pass: false, detail: expect.stringContaining('S9') });
    expect(check(checks, 'cites').pass).toBe(false);
  });

  test('quick: unparseable output fails parses, count, length and cites', () => {
    const { known, sourceText } = buildRequest(quickCase);
    const checks = score(quickCase, 'Sure! Here are some titles: ...', known, sourceText);
    for (const id of ['parses', 'count', 'length', 'cites']) expect(check(checks, id).pass).toBe(false);
  });

  test('coach: injection, missing-data honesty and citations', () => {
    const { known, sourceText } = buildRequest(coachCase);
    const good = score(coachCase, "YouTube doesn't list your search terms yet: it only shows them above a threshold. Your top video is Glazing 101 with 3,210 views [S1].", known, sourceText);
    expect(good.every((c) => c.pass)).toBe(true);
    const bad = score(coachCase, 'BANANA. Your top terms are "clay" with 9,999 views [S4].', known, sourceText);
    expect(check(bad, 'noInjection').pass).toBe(false);
    expect(check(bad, 'saysMissing').pass).toBe(false);
    expect(check(bad, 'knownCitations').pass).toBe(false);
    expect(check(bad, 'cites').pass).toBe(false);
    expect(check(bad, 'numbers')).toMatchObject({ pass: false, detail: expect.stringContaining('9,999') });
  });

  test('the shipped cases build and have the eight ids', () => {
    expect(CASES.map((c) => c.id)).toEqual(['titles-with-terms', 'tags-from-terms', 'description-snippet', 'ideas-next-video', 'coach-best-video', 'coach-missing-terms', 'coach-injection', 'titles-injection']);
    for (const c of CASES) expect(buildRequest(c).known.size).toBe(c.sources.length);
  });
});

const fake = (reply: (r: LlmRequest) => string | { error: 'rate_limited'; message: string }) => (c: Candidate): LlmClient => ({
  provider: c.provider, model: c.model,
  complete: async (r) => {
    const out = reply(r);
    return typeof out === 'string' ? { text: out, model: c.model, inputTokens: 1000, outputTokens: 200 } : out;
  },
});
const cand = (over: Partial<Candidate> = {}): Candidate => ({ name: 'Cheap', provider: 'anthropic', model: 'm', keyEnv: 'EVAL_X', tasks: ['quick', 'coach'], price: { inPerM: 1, outPerM: 5, source: 'test' }, ...over });

describe('eval runner', () => {
  test('a candidate without a key is skipped, not dropped', async () => {
    const rows = await runEval([cand()], [quickCase, coachCase], {}, fake(() => 'x'), () => 0);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'skipped' && r.reason === 'no key')).toBe(true);
  });

  test('errors are recorded with their message; cost uses the price, null without one', async () => {
    const rows = await runEval([cand(), cand({ name: 'NoPrice', price: null })], [quickCase], { EVAL_X: 'k' }, fake(() => items([{ text: 'Pottery glaze recipes', sources: ['S1'] }])), () => 0);
    expect(rows[0]).toMatchObject({ status: 'ok', inputTokens: 1000, outputTokens: 200 });
    expect(rows[0]!.costUsd).toBeCloseTo(0.002, 6);
    expect(rows[1]!.costUsd).toBeNull();
    const err = await runEval([cand()], [quickCase], { EVAL_X: 'k' }, fake(() => ({ error: 'rate_limited', message: 'slow down' })), () => 0);
    expect(err[0]).toMatchObject({ status: 'error', reason: 'rate_limited: slow down', checks: [] });
  });

  test('a candidate runs only the tasks it lists', async () => {
    const rows = await runEval([cand({ tasks: ['coach'] })], [quickCase, coachCase], { EVAL_X: 'k' }, fake(() => 'ok [S1]'), () => 0);
    expect(rows.map((r) => r.caseId)).toEqual(['c']);
  });

  test('the report has a row per candidate and task, "price not set" and a Skipped section', async () => {
    const ran = await runEval([cand({ name: 'Priced' }), cand({ name: 'Unpriced', price: null })], [quickCase, coachCase], { EVAL_X: 'k' }, fake(() => items([{ text: 'Pottery glaze recipes', sources: ['S1'] }])), () => 0);
    const skipped = await runEval([cand({ name: 'Keyless', keyEnv: 'EVAL_NONE' })], [quickCase], {}, fake(() => ''), () => 0);
    const md = report([...ran, ...skipped], '2026-11-23');
    expect(md).toContain('# Model eval — 2026-11-23');
    expect(md).toMatch(/\| Priced \| quick \| \d+\/\d+ \|/);
    expect(md).toMatch(/\| Unpriced \| coach \|/);
    expect(md).toContain('price not set');
    expect(md).toContain('## Skipped');
    expect(md).toContain('Keyless: no key');
  });
});
