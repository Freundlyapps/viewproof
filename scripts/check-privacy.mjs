#!/usr/bin/env node
// Fails if a tracked file could leak who captured it. Runs in CI on every pull request and locally via `pnpm check:privacy`.
// Captured YouTube JSON carries stream URLs (googlevideo.com) with the capturer's IP address in them.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const isData = (f) => /(^|\/)(fixtures|test-data)\//.test(f) || /\.(json|har|html)$/.test(f);
const rules = [
  { name: 'YouTube stream URL (holds an IP address)', re: /googlevideo\.com/, applies: isData },
  { name: 'IPv4 address', re: /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/, applies: (f) => /(^|\/)fixtures\//.test(f) },
  { name: 'IPv6 address in a URL parameter', re: /[?&]ip=[0-9a-f]{0,4}:[0-9a-f:]+/i, applies: isData },
  { name: 'local secrets file', re: /^/, applies: (f) => /(^|\/)\.dev\.vars$|(^|\/)\.env(\.|$)/.test(f) && !f.endsWith('.example') },
];

const problems = [];
for (const f of files) {
  const active = rules.filter((r) => r.applies(f));
  if (!active.length) continue;
  let text;
  try { text = readFileSync(f, 'utf8'); } catch { continue; }
  for (const r of active) {
    const m = r.re.exec(text);
    if (m) problems.push(`${f}: ${r.name}${r.name === 'local secrets file' ? '' : ` (line ${text.slice(0, m.index).split('\n').length})`}`);
  }
}
if (problems.length) {
  console.error('Privacy check failed. Remove these before committing (see CONTRIBUTING.md, "Test fixtures"):');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`Privacy check passed (${files.length} files).`);
