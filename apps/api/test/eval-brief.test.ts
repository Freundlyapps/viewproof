import { describe, expect, test } from 'vitest';
import { CASES } from '../eval/cases';
import { type Candidate, report, runEval } from '../eval/run';
import { buildRequest, score } from '../eval/score';
import { SYSTEM_BRIEF } from '../src/agent/brief';

const brief = CASES.find((c) => c.id === 'brief-weekly')!;
const good = JSON.stringify({
  ideas: Array.from({ length: 5 }, (_, i) => ({ text: `Idea ${i}`, why: 'Your term "pottery for beginners" brought 1,870 views', sources: ['S3'] })),
  changes: [{ video: 'V1', title: 'Raku Firing at Home: What Actually Works', why: '"raku firing" brought 210 views', sources: ['S6'] }],
});

describe('eval: weekly brief', () => {
  test('uses the production brief prompt with the candidates source last', () => {
    const { request, known } = buildRequest(brief);
    expect(request.system).toBe(SYSTEM_BRIEF);
    expect(request.messages[0]!.content).toContain('V1: "Raku Firing at Home?"');
    expect(known.has('S6')).toBe(true);
  });

  test('a good answer passes every check; invented numbers fail "numbers"', () => {
    const { known, sourceText } = buildRequest(brief);
    expect(score(brief, good, known, sourceText).filter((c) => !c.pass)).toEqual([]);
    const bad = good.replace('brought 210 views', 'gets 3x the views of similar titles');
    const checks = score(brief, bad, known, sourceText);
    expect(checks.find((c) => c.id === 'numbers')).toMatchObject({ pass: false });
    expect(checks.find((c) => c.id === 'changes')).toMatchObject({ pass: false });
  });

  test('report prints measured cost per Pro user per month from real token counts', async () => {
    const cands: Candidate[] = [{ name: 'Sonnet', provider: 'anthropic', model: 'claude-sonnet-5-5', keyEnv: 'K', tasks: ['brief'], price: { inPerM: 2, outPerM: 10, source: 'test' } }];
    const rows = await runEval(cands, [brief], { K: 'x' }, () => ({ provider: 'anthropic', model: 'm', complete: async () => ({ text: good, model: 'm', inputTokens: 5000, outputTokens: 2000 }) }), () => 0);
    const md = report(rows, '2026-11-25');
    // 5000 × $2/M + 2000 × $10/M = $0.03 per brief.
    expect(md).toContain('| Sonnet | $0.0300 | $0.130 | $0.180 |');
  });
});
