// Manual live check of keyword capture against real YouTube (NOT part of `pnpm e2e`).
// Budget: 2 YouTube page loads, 1 in-app search, 1 filter click, 1 German page load, ≤ 12 suggestion requests.
// Needs: `pnpm --filter extension build:dev` and the local server on :8787 (pnpm dev).
// Usage: node e2e/keyword-live-check.mjs <outDir>
import { chromium } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = fileURLToPath(new URL('../.output/chrome-mv3-dev', import.meta.url));
const outDir = process.argv[2] ?? tmpdir();
// Chromium 159+ ignores --load-extension; load the unpacked build through the DevTools protocol instead.
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'vp-kw-')), {
  channel: 'chromium', headless: true, viewport: { width: 1400, height: 900 }, args: ['--enable-unsafe-extension-debugging'], ignoreDefaultArgs: ['--disable-extensions'],
});
const loaded = await (await ctx.browser().newBrowserCDPSession()).send('Extensions.loadUnpacked', { path: EXT });
console.error('extension loaded:', loaded.id);
await ctx.addCookies([{ name: 'SOCS', value: 'CAI', domain: '.youtube.com', path: '/' }]);
const report = {};
const app = await ctx.newPage();
await app.goto('http://localhost:8787/app/', { waitUntil: 'domcontentloaded' });
const ask = (q) => app.evaluate((q) => new Promise((res) => {
  const id = `t${Math.random()}`;
  const on = (e) => { if (e.data?.type === 'viewproof:kw-response' && e.data.id === id) { removeEventListener('message', on); res(e.data); } };
  addEventListener('message', on);
  postMessage({ type: 'viewproof:kw-request', id, q }, location.origin);
  setTimeout(() => res(null), 30_000);
}), q);
const hello = () => app.evaluate(() => new Promise((res) => {
  const on = (e) => { if (e.data?.type === 'viewproof:here') { removeEventListener('message', on); res(e.data); } };
  addEventListener('message', on);
  postMessage({ type: 'viewproof:hello' }, location.origin);
  setTimeout(() => res(null), 5000);
}));
const brief = (r) => r && ({
  snapshot: r.snapshot ? { query: r.snapshot.query, capturedAt: r.snapshot.capturedAt, results: r.snapshot.page.results.length, first: r.snapshot.page.results[0] && { title: r.snapshot.page.results[0].title, views: r.snapshot.page.results[0].views, age: r.snapshot.page.results[0].ageDays, label: r.snapshot.page.results[0].ageLabel }, unparsedAges: r.snapshot.page.results.filter((x) => x.ageDays.kind !== 'value').map((x) => x.ageLabel), unparsedViews: r.snapshot.page.results.filter((x) => x.views.kind !== 'value').map((x) => x.views.reason) } : null,
  suggestions: r.suggestions && { related: r.suggestions.related.slice(0, 5), questions: r.suggestions.questions.slice(0, 5), matching: r.suggestions.matching.length },
  suggestionsError: r.suggestionsError,
});

report.hello = await hello();

// 1. Direct load of a search page (ytInitialData path).
const yt = await ctx.newPage();
await yt.addInitScript(() => {
  window.__vpNav = [];
  document.addEventListener('yt-navigate-finish', (e) => {
    const d = e.detail ?? {};
    const r = d.response ?? {};
    window.__vpNav.push({ url: location.href, detailKeys: Object.keys(d), responseKeys: Object.keys(r), hasResponseResponse: !!r.response, innerHasContents: !!r.response?.contents?.twoColumnSearchResultsRenderer, outerHasContents: !!r.contents?.twoColumnSearchResultsRenderer });
  });
});
await yt.goto('https://www.youtube.com/results?search_query=pottery+wheel', { waitUntil: 'domcontentloaded' });
await yt.waitForTimeout(6000);
await yt.screenshot({ path: join(outDir, 'kw-1-direct.png') });
report.direct = brief(await ask('pottery wheel'));

// 2. In-app search typed into YouTube's own box (yt-navigate-finish path).
const box = yt.locator('input[name="search_query"]').first();
await box.click();
await box.fill('kiln firing');
await box.press('Enter');
await yt.waitForURL(/search_query=kiln/, { timeout: 20_000 }).catch(() => {});
await yt.waitForTimeout(6000);
report.inAppUrl = yt.url();
report.inApp = brief(await ask('kiln firing'));

// 3. A filter chip: does the URL get sp=, and is the snapshot left alone?
const before = report.inApp?.snapshot?.capturedAt ?? null;
const chips = await yt.locator('yt-chip-cloud-chip-renderer, chip-view-model, button[role="tab"]').allInnerTexts().catch(() => []);
report.chips = chips.map((c) => c.trim()).filter(Boolean).slice(0, 12);
const chip = yt.locator('yt-chip-cloud-chip-renderer, chip-view-model').filter({ hasText: /^\s*Recently uploaded\s*$/ }).first();
try {
  await chip.click({ timeout: 10_000 });
  await yt.waitForTimeout(6000);
  report.chipUrl = yt.url();
} catch (e) { report.chipUrl = `no chip clicked: ${e.message.split('\n')[0]}`; }
await yt.screenshot({ path: join(outDir, 'kw-3-chip.png') });
const after = brief(await ask('kiln firing'));
report.chipLeftSnapshotAlone = after?.snapshot?.capturedAt === before;

// 4. German page (throwaway profile, so hl=de changes nothing for anyone).
await yt.goto('https://www.youtube.com/results?search_query=t%C3%B6pfern+drehscheibe&hl=de&gl=DE', { waitUntil: 'domcontentloaded' });
await yt.waitForTimeout(6000);
report.german = brief(await ask('töpfern drehscheibe'));

report.navEvents = await yt.evaluate(() => window.__vpNav);
writeFileSync(join(outDir, 'keyword-live-check.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await ctx.close();
