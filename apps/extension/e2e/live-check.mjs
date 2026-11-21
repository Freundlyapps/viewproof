// Manual live check against real YouTube (NOT part of `pnpm e2e`; budget: one page load per video id given).
// Usage: node e2e/live-check.mjs <outDir> <videoId>...
import { chromium } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = fileURLToPath(new URL('../.output/chrome-mv3', import.meta.url));
const [outDir, ...ids] = process.argv.slice(2);
// Chromium 159+ ignores --load-extension: keep extensions enabled and load the build through the DevTools protocol.
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'vp-live-')), {
  channel: 'chromium', headless: true, viewport: { width: 1400, height: 900 },
  args: ['--enable-unsafe-extension-debugging'], ignoreDefaultArgs: ['--disable-extensions'],
});
await (await ctx.browser().newBrowserCDPSession()).send('Extensions.loadUnpacked', { path: EXT });
// Decline-all consent cookie so EU visitors land on the video, not the consent page.
await ctx.addCookies([{ name: 'SOCS', value: 'CAI', domain: '.youtube.com', path: '/' }]);
const page = await ctx.newPage();
const offHost = [];
page.on('request', (r) => { const h = new URL(r.url()).hostname; if (r.frame() && !/(^|\.)(youtube\.com|ytimg\.com|googlevideo\.com|ggpht\.com|google\.com|gstatic\.com|doubleclick\.net|googleapis\.com|googlesyndication\.com|youtube-nocookie\.com)$/.test(h)) offHost.push(h); });
for (const id of ids) {
  await page.goto(`https://www.youtube.com/watch?v=${id}`, { waitUntil: 'domcontentloaded' });
  const panel = page.locator('#viewproof-panel');
  try {
    await panel.waitFor({ timeout: 30_000 });
    await page.waitForTimeout(3000);
    console.log(id, '→', (await panel.evaluate((h) => h.shadowRoot?.textContent ?? '')).replace(/\s+/g, ' '));
    await panel.screenshot({ path: join(outDir, `${id}-panel.png`) });
  } catch (e) {
    console.log(id, '→ NO PANEL', e.message.split('\n')[0]);
    await page.screenshot({ path: join(outDir, `${id}-page.png`) });
  }
}
console.log('non-Google hosts requested:', [...new Set(offHost)]);
await ctx.close();
