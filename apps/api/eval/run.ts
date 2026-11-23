// Runs eval cases against candidate models and renders the markdown report (plan 6c). No network of its own.
import { type LlmClient, type LlmProviderId, isLlmError } from '@viewproof/providers';
import type { EvalCase } from './cases';
import { type Check, buildRequest, score } from './score';

export interface Candidate {
  name: string; provider: LlmProviderId; model: string; baseUrl?: string; keyEnv: string;
  tasks: ('quick' | 'coach')[];
  price: { inPerM: number; outPerM: number; source: string } | null;
}
export interface RunRow {
  candidate: string; task: 'quick' | 'coach'; caseId: string; status: 'ok' | 'error' | 'skipped'; reason?: string;
  checks: Check[]; inputTokens: number; outputTokens: number; ms: number; costUsd: number | null; answer?: string;
}

export async function runEval(cands: Candidate[], cases: EvalCase[], keys: Record<string, string | undefined>, make: (c: Candidate, key: string) => LlmClient, now: () => number): Promise<RunRow[]> {
  const rows: RunRow[] = [];
  for (const cand of cands) {
    const key = keys[cand.keyEnv];
    for (const c of cases.filter((x) => cand.tasks.includes(x.task))) {
      const base = { candidate: cand.name, task: c.task, caseId: c.id, checks: [] as Check[], inputTokens: 0, outputTokens: 0, ms: 0, costUsd: null };
      if (!key) { rows.push({ ...base, status: 'skipped', reason: 'no key' }); continue; }
      const { request, known, sourceText } = buildRequest(c);
      const t0 = now();
      const r = await make(cand, key).complete(request);
      const ms = now() - t0;
      if (isLlmError(r)) { rows.push({ ...base, ms, status: 'error', reason: `${r.error}: ${r.message}` }); continue; }
      const cost = cand.price ? (r.inputTokens * cand.price.inPerM + r.outputTokens * cand.price.outPerM) / 1e6 : null;
      rows.push({ ...base, status: 'ok', checks: score(c, r.text, known, sourceText), inputTokens: r.inputTokens, outputTokens: r.outputTokens, ms, costUsd: cost, answer: r.text });
    }
  }
  return rows;
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

export function report(rows: RunRow[], date: string): string {
  const lines = [
    `# Model eval — ${date}`,
    '',
    'Synthetic channel data, the production prompts, one call per case. Checks are deterministic (see README "Model eval"); "numbers" lists numbers not found in the sources, which may be derived rather than invented.',
    '',
    '## Results',
    '',
    '| Candidate | Task | Passed checks | Cases fully passed | Errors | Avg input tokens | Avg output tokens | Avg ms | Cost per call |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  const ran = rows.filter((r) => r.status !== 'skipped');
  const groups = [...new Set(ran.map((r) => `${r.candidate}\u0000${r.task}`))];
  for (const g of groups) {
    const [cand, task] = g.split('\u0000') as [string, string];
    const rs = ran.filter((r) => r.candidate === cand && r.task === task);
    const ok = rs.filter((r) => r.status === 'ok');
    const checks = ok.flatMap((r) => r.checks);
    const costs = ok.map((r) => r.costUsd);
    const cost = costs.length && costs.every((x) => x !== null) ? `$${(costs.reduce((a, b) => a! + b!, 0)! / costs.length).toFixed(5)}` : 'price not set';
    lines.push(`| ${cand} | ${task} | ${checks.filter((c) => c.pass).length}/${checks.length} | ${ok.filter((r) => r.checks.every((c) => c.pass)).length}/${rs.length} | ${rs.length - ok.length} | ${avg(ok.map((r) => r.inputTokens))} | ${avg(ok.map((r) => r.outputTokens))} | ${avg(ok.map((r) => r.ms))} | ${cost} |`);
  }
  const failed = ran.filter((r) => r.status === 'error' || r.checks.some((c) => !c.pass));
  if (failed.length) {
    lines.push('', '## Failures', '');
    for (const r of failed) {
      if (r.status === 'error') lines.push(`- ${r.candidate} · ${r.caseId}: error (${r.reason})`);
      else for (const c of r.checks.filter((x) => !x.pass)) lines.push(`- ${r.candidate} · ${r.caseId} · ${c.id}: ${c.detail}`);
    }
  }
  const skipped = [...new Map(rows.filter((r) => r.status === 'skipped').map((r) => [r.candidate, r.reason])).entries()];
  if (skipped.length) {
    lines.push('', '## Skipped', '');
    for (const [cand, why] of skipped) lines.push(`- ${cand}: ${why}`);
  }
  return `${lines.join('\n')}\n`;
}
