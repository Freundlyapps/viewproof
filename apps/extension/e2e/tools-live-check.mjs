// Manual live check of the Tools page with the real extension (NOT part of `pnpm e2e`).
// Budget: one tag lookup (one watch page fetched by the extension) + one watch page opened with its transcript panel.
// Needs the dev build (`pnpm --filter extension build:dev`) and a local server; VP_SESSION = a vp_session cookie.
// Usage: VP_SESSION=… node e2e/tools-live-check.mjs <outDir> <videoId> [server]
import { chromium } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = fileURLToPath(new URL('../.output/chrome-mv3-dev', import.meta.url));
const [outDir, id, server = 'http://localhost:8787'] = process.argv.slice(2);
if (!outDir || !id || !process.env.VP_SESSION) throw new Error('usage: VP_SESSION=… node e2e/tools-live-check.mjs <outDir> <videoId> [server]');
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'vp-tools-')), {
  // CHROMIUM_PATH: use an already installed Chromium instead of Playwright's own download.
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' }), headless: true, viewport: { width: 1400, height: 900 },
  args: ['--enable-unsafe-extension-debugging'], ignoreDefaultArgs: ['--disable-extensions'],
});
await (await ctx.browser().newBrowserCDPSession()).send('Extensions.loadUnpacked', { path: EXT });
await ctx.addCookies([
  { name: 'SOCS', value: 'CAI', domain: '.youtube.com', path: '/' },
  { name: 'vp_session', value: process.env.VP_SESSION, url: server },
]);
const page = await ctx.newPage();

// 1. Tags through the extension.
await page.goto(`${server}/app/tools/tags`);
await page.getByLabel('YouTube video link or id').fill(`https://www.youtube.com/watch?v=${id}`);
await page.getByRole('button', { name: 'Get tags' }).click();
await page.waitForFunction(() => !document.body.innerText.includes('Reading…'), null, { timeout: 30_000 });
console.log('tags →', (await page.locator('main').innerText()).split('\n').slice(4, 12).join(' | '));
await page.screenshot({ path: join(outDir, 'tools-live-tags.png') });

// 2. Open the transcript panel on YouTube; the extension keeps it.
await page.goto(`https://www.youtube.com/watch?v=${id}`, { waitUntil: 'domcontentloaded' });
await page.locator('#description-inline-expander, #expand').first().click({ timeout: 30_000 }).catch(() => undefined);
const show = page.getByRole('button', { name: /show transcript/i }).first();
try {
  await show.click({ timeout: 20_000 });
  const seg = page.locator('transcript-segment-view-model, ytd-transcript-segment-renderer');
  await seg.first().waitFor({ timeout: 20_000 });
  console.log('segments on the page:', await seg.count());
} catch (e) {
  console.log('transcript panel → NOT FOUND', e.message.split('\n')[0]);
  console.log('segment-like tags:', await page.evaluate(() => [...new Set([...document.querySelectorAll('*')].map((n) => n.tagName.toLowerCase()).filter((t) => t.includes('transcript')))]));
  // What a segment looks like now, to update readTranscriptPanel when YouTube changes it.
  console.log('first segments:', await page.evaluate(() => [...document.querySelectorAll('transcript-segment-view-model')].slice(0, 2).map((n) => n.outerHTML.replace(/\s+/g, ' ').slice(0, 1500))));
}
await page.waitForTimeout(8000);
await page.screenshot({ path: join(outDir, 'tools-live-youtube.png') });

// 3. The Tools page lists it.
await page.goto(`${server}/app/tools/transcripts`);
await page.waitForTimeout(3000);
console.log('transcripts →', (await page.locator('main').innerText()).split('\n').slice(4, 10).join(' | '));
await page.screenshot({ path: join(outDir, 'tools-live-transcripts.png') });
await ctx.close();
