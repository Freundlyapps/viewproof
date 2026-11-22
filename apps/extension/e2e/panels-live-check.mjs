// Manual live check (not part of the suite): loads the built extension on real YouTube pages,
// one channel page, one search and one watch page, and saves screenshots. Run: node e2e/panels-live-check.mjs <outdir>
import { chromium } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = process.argv[2] ?? tmpdir();
const EXT = fileURLToPath(new URL('../.output/chrome-mv3', import.meta.url));
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'vp-panels-')), {
  channel: 'chromium', headless: true, viewport: { width: 1400, height: 1000 }, locale: 'en-US',
  args: ['--enable-unsafe-extension-debugging'], ignoreDefaultArgs: ['--disable-extensions'],
});
await (await ctx.browser().newBrowserCDPSession()).send('Extensions.loadUnpacked', { path: EXT });
await ctx.addCookies([{ name: 'SOCS', value: 'CAI', domain: '.youtube.com', path: '/' }]);
const page = await ctx.newPage();
const only = process.argv[3]; // channel | search | watch: run just that page
const want = (k) => !only || only === k;

const panelText = (sel) => page.locator(sel).evaluate((h) => h.shadowRoot?.querySelector('.vp')?.textContent ?? '').catch((e) => `ERR ${e.message}`);

if (want('channel')) {
await page.goto('https://www.youtube.com/@veritasium/videos');
await page.waitForSelector('#viewproof-page-panel', { timeout: 30_000 }).catch(() => undefined);
await page.waitForTimeout(3000);
console.log('CHANNEL panel:', (await panelText('#viewproof-page-panel')).slice(0, 600));
console.log('CHANNEL badges:', await page.locator('[data-viewproof-badge]').count());
await page.screenshot({ path: join(out, 'live-channel.png') });
}
if (want('search')) {

await page.goto('https://www.youtube.com/results?search_query=pottery+wheel+beginner');
await page.waitForSelector('#viewproof-page-panel', { timeout: 30_000 }).catch(() => undefined);
await page.waitForTimeout(8000);
console.log('SEARCH panel:', (await panelText('#viewproof-page-panel')).slice(0, 800));
console.log('SEARCH badges:', await page.locator('[data-viewproof-badge]').count());
await page.screenshot({ path: join(out, 'live-search.png') });
}
if (want('watch')) {

await page.goto('https://www.youtube.com/watch?v=KfODG5REyss');
await page.waitForSelector('#viewproof-panel', { timeout: 30_000 }).catch(() => undefined);
await page.waitForTimeout(6000);
console.log('WATCH panel:', (await panelText('#viewproof-panel')).slice(0, 900));
await page.locator('#viewproof-panel').screenshot({ path: join(out, 'live-watch.png') }).catch((e) => console.log('shot', e.message));
}
await ctx.close();
