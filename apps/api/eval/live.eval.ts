// Live model eval: `pnpm --filter api eval`. Reads EVAL_* keys from the environment or apps/api/.dev.vars,
// sends each case once to each candidate that has a key, writes docs/model-eval/<date>.md (and raw answers to eval/out/, git-ignored).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { llmClient } from '@viewproof/providers';
import { CASES } from './cases';
import { type Candidate, report, runEval } from './run';

const here = dirname(fileURLToPath(import.meta.url));

function evalKeys(): Record<string, string | undefined> {
  const keys: Record<string, string | undefined> = {};
  const file = join(here, '..', '.dev.vars');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*(EVAL_[A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/.exec(line);
      if (m && m[2]) keys[m[1]!] = m[2].trim();
    }
  }
  for (const [k, v] of Object.entries(process.env)) if (k.startsWith('EVAL_') && v) keys[k] = v;
  return keys;
}

test('model eval', async () => {
  const cands = JSON.parse(readFileSync(join(here, 'candidates.json'), 'utf8')) as Candidate[];
  const keys = evalKeys();
  const planned = cands.filter((c) => keys[c.keyEnv]).reduce((n, c) => n + CASES.filter((x) => c.tasks.includes(x.task)).length, 0);
  console.log(`Planned calls: ${planned}`);
  const rows = await runEval(cands, CASES, keys, (c, key) => llmClient({ provider: c.provider, apiKey: key, model: c.model, baseUrl: c.baseUrl ?? null }), () => Date.now());
  for (const c of cands) if (!keys[c.keyEnv]) console.log(`${c.name}: skipped: no key (set ${c.keyEnv})`);
  const date = new Date().toISOString().slice(0, 10);
  const md = report(rows, date);
  console.log(md);
  if (rows.some((r) => r.status !== 'skipped')) {
    const docs = join(here, '..', '..', '..', 'docs', 'model-eval');
    mkdirSync(docs, { recursive: true });
    writeFileSync(join(docs, `${date}.md`), md);
    mkdirSync(join(here, 'out'), { recursive: true });
    writeFileSync(join(here, 'out', `${date}.json`), JSON.stringify(rows, null, 2));
    console.log(`Report: docs/model-eval/${date}.md`);
  } else {
    console.log('No candidate has a key: nothing was sent and no report was written.');
  }
}, 900_000);
