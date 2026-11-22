#!/usr/bin/env node
// Live check of Ask AI against a running server: one titles action and one question (≤ 3 AI calls in total).
// Usage: VP_SESSION=<vp_session cookie value> node apps/api/scripts/ai-live-check.mjs http://localhost:8787
const base = (process.argv[2] ?? 'http://localhost:8787').replace(/\/+$/, '');
const sid = process.env.VP_SESSION;
if (!sid) { console.error('Set VP_SESSION to your vp_session cookie value.'); process.exit(2); }
const headers = { cookie: `vp_session=${sid}`, origin: base, 'content-type': 'application/json', accept: 'application/json' };
const call = async (method, path, body) => {
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
};

const status = await call('GET', '/api/ai/status');
if (status.status !== 200) { console.error('status', status.status, status.json); process.exit(1); }
const s = status.json;
console.log('included:', s.included ? `${s.included.label} ${s.included.quickModel} / ${s.included.coachModel}` : 'none');
console.log('own key:', s.own ? `${s.own.label} ${s.own.keyHint}` : 'none');
console.log('usage:', JSON.stringify(s.usage));
if (!s.included && !s.own) { console.log('No AI configured on this server or account: skipping the AI calls.'); process.exit(0); }

let failed = false;
const show = (name, r) => {
  console.log(`\n== ${name}: HTTP ${r.status}`);
  if (r.status !== 200) { failed = true; console.log(r.json); return; }
  const j = r.json;
  console.log('sent to:', j.ai.label, j.ai.model, j.ai.via);
  console.log('sources:', j.sources.map((x) => `${x.id} ${x.label} (${x.lines.length} lines)`).join('; ') || 'none');
  console.log('missing:', j.missing.map((m) => `${m.label}: ${m.reason}`).join('; ') || 'none');
  if (j.items) for (const i of j.items) console.log(` - ${i.text}  [${i.sources.join(',')}] ${i.why}`);
  if (j.answer) console.log(j.answer, '\ncited:', j.cited, 'unknown:', j.unknownCitations);
};
show('titles', await call('POST', '/api/ai/quick', { action: 'titles', topic: process.env.VP_TOPIC ?? 'where common words come from' }));
show('ask', await call('POST', '/api/ai/ask', { messages: [{ role: 'user', content: 'Based on my data, what should my next video be about, and why?' }] }));
process.exit(failed ? 1 : 0);
