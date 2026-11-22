// Manual live check for plan 5b (budget: 1 watch page + 1 search page on YouTube). Needs the dev build and a dev server on :8787.
// Usage: VP_SESSION=<local session id> node e2e/pool-live-check.mjs <screenshot dir>
import { chromium } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = fileURLToPath(new URL('../.output/chrome-mv3-dev', import.meta.url));
const OUT = process.argv[2] ?? '.';
const APP = 'http://localhost:8787';
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'vp-pool-')), {
  channel: 'chromium', headless: true, viewport: { width: 1400, height: 900 }, args: ['--enable-unsafe-extension-debugging'], ignoreDefaultArgs: ['--disable-extensions'],
});
const { id } = await (await ctx.browser().newBrowserCDPSession()).send('Extensions.loadUnpacked', { path: EXT });
await ctx.addCookies([{ name: 'vp_session', value: process.env.VP_SESSION, domain: 'localhost', path: '/' }]);

// 1. Link this browser from the web app; the extension opens its consent page.
const app = await ctx.newPage();
await app.goto(APP + '/app/settings/extension');
const optionsOpened = ctx.waitForEvent('page', { predicate: (p) => p.url().startsWith('chrome-extension://'), timeout: 15000 });
await app.getByRole('button', { name: 'Link this browser' }).click();
console.log('web says:', await app.getByRole('status').innerText({ timeout: 15000 }));
const options = await optionsOpened;
await options.waitForLoadState();
console.log('before consent:', (await options.locator('#app').innerText()).split('\n').slice(0, 12).join(' | '));
await options.getByRole('button', { name: 'I agree — start sharing' }).click();

// 2. One watch page and one search page on YouTube.
const yt = await ctx.newPage();
await yt.goto('https://www.youtube.com/watch?v=HZjRoKgDnow', { waitUntil: 'domcontentloaded' });
await yt.waitForTimeout(8000);
await yt.goto('https://www.youtube.com/results?search_query=pottery+wheel+for+beginners', { waitUntil: 'domcontentloaded' });
await yt.waitForTimeout(8000);
const queued = await options.evaluate(async () => (await chrome.storage.local.get('pool')).pool.queue.length);
console.log('queued:', queued);

// 3. Send now instead of waiting for the 5-minute alarm.
await options.evaluate(() => chrome.runtime.sendMessage({ kind: 'pool-flush' }));
await options.waitForTimeout(4000);
const st = await options.evaluate(async () => (await chrome.storage.local.get('pool')).pool);
console.log('log[0]:', JSON.stringify({ ...st.log[0], videos: st.log[0]?.videos.length }), 'queue after:', st.queue.length);
await options.reload();
await options.screenshot({ path: join(OUT, 'pool-options.png'), fullPage: true });
await app.reload();
await app.waitForSelector('table[aria-label="Linked browsers"]');
await app.screenshot({ path: join(OUT, 'pool-settings.png'), fullPage: true });
console.log('extension id', id);
await ctx.close();
