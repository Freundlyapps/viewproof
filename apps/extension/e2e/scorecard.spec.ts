// Loads the built extension into Chromium and serves fake youtube.com pages through
// request routing — no real YouTube traffic. Real-page behaviour is checked by hand (README).
import { type BrowserContext, chromium, expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = fileURLToPath(new URL('../.output/chrome-mv3', import.meta.url));
const CHANNEL = 'UCfixturechannel000000';
const HOUR = 3_600_000;
const HUNG_CHANNEL = 'UChungchannel0000000000';

function player(videoId: string, title: string, views: number, hoursAgo: number, channelId = CHANNEL) {
  return {
    videoDetails: { videoId, title, channelId, viewCount: String(views), lengthSeconds: '600', keywords: ['pottery', 'bowl'], isLiveContent: false },
    microformat: { playerMicroformatRenderer: { publishDate: new Date(Date.now() - hoursAgo * HOUR).toISOString(), canonicalUrl: `https://www.youtube.com/watch?v=${videoId}` } },
  };
}

function feed(): string {
  const entries = [10000, 20000, 30000, 30000, 40000, 50000].map((v, i) => `
  <entry><yt:videoId>base0000${i}aa</yt:videoId><title>b${i}</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=base0000${i}aa"/>
    <published>${new Date(Date.now() - (200 + i * 24) * HOUR).toISOString()}</published>
    <media:group><media:community><media:statistics views="${v}"/></media:community></media:group></entry>`);
  return `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">${entries.join('')}</feed>`;
}

function watchPage(data: unknown): string {
  return `<!doctype html><html><body>
  <div id="movie_player"></div><div id="primary"></div><div id="secondary"><div>related videos</div></div>
  <script>
    window.__vp = ${JSON.stringify(data)};
    document.getElementById('movie_player').getPlayerResponse = () => window.__vp;
  </script></body></html>`;
}

async function launch(feedStatus: number): Promise<BrowserContext> {
  // Chromium 159+ ignores --load-extension: keep extensions enabled and load the build through the DevTools protocol.
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'vp-e2e-')), {
    channel: 'chromium',
    headless: true,
    args: ['--enable-unsafe-extension-debugging'],
    ignoreDefaultArgs: ['--disable-extensions'],
  });
  await (await ctx.browser()!.newBrowserCDPSession()).send('Extensions.loadUnpacked', { path: EXT });
  await ctx.route('https://www.youtube.com/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/feeds/videos.xml') {
      if (url.searchParams.get('channel_id') === HUNG_CHANNEL) return; // never answers
      return feedStatus === 200
        ? route.fulfill({ status: 200, contentType: 'application/xml', body: feed() })
        : route.fulfill({ status: feedStatus, body: '' });
    }
    if (url.pathname === '/watch') {
      return route.fulfill({ status: 200, contentType: 'text/html', body: watchPage(player(url.searchParams.get('v')!, 'First video', 90000, 72)) });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  return ctx;
}

const panel = (page: import('@playwright/test').Page) => page.locator('#viewproof-panel');

test('shows ×N with its reason and VPH on a watch page', async () => {
  const ctx = await launch(200);
  const page = await ctx.newPage();
  await page.goto('https://www.youtube.com/watch?v=VIDEO000001');
  await expect(panel(page)).toContainText('×3', { timeout: 15_000 });
  await expect(panel(page)).toContainText('this channel usually gets 30,000');
  await expect(panel(page)).toContainText('1,250'); // 90,000 views ÷ 72 h
  await expect(panel(page)).toContainText('avg since upload');
  await ctx.close();
});

test('in-app navigation shows the new video, not the old one', async () => {
  const ctx = await launch(200);
  const page = await ctx.newPage();
  await page.goto('https://www.youtube.com/watch?v=VIDEO000001');
  await expect(panel(page)).toContainText('First video', { timeout: 15_000 });
  await page.evaluate((next) => {
    (window as unknown as { __vp: unknown }).__vp = next;
    history.pushState({}, '', '/watch?v=VIDEO000002');
    document.dispatchEvent(new Event('yt-navigate-finish'));
  }, player('VIDEO000002', 'Second video', 6000, 48));
  await expect(panel(page)).toContainText('Second video', { timeout: 15_000 });
  await expect(panel(page)).not.toContainText('First video');
  await expect(panel(page)).toContainText('×0.2');
  await ctx.close();
});

test('feed failure: ×N explains, other stats still show', async () => {
  const ctx = await launch(404);
  const page = await ctx.newPage();
  await page.goto('https://www.youtube.com/watch?v=VIDEO000001');
  await expect(panel(page)).toContainText('No data', { timeout: 15_000 });
  await expect(panel(page)).toContainText('HTTP 404');
  await expect(panel(page)).toContainText('1,250');
  await ctx.close();
});

test('navigating to a video whose channel feed hangs: old numbers vanish, new ones show, ×N times out', async () => {
  const ctx = await launch(200);
  const page = await ctx.newPage();
  await page.goto('https://www.youtube.com/watch?v=VIDEO000001');
  await expect(panel(page)).toContainText('×3', { timeout: 15_000 });
  await page.evaluate((next) => {
    document.dispatchEvent(new Event('yt-navigate-start'));
    (window as unknown as { __vp: unknown }).__vp = next;
    history.pushState({}, '', '/watch?v=VIDEO000003');
    document.dispatchEvent(new Event('yt-navigate-finish'));
  }, player('VIDEO000003', 'Third video', 4800, 48, HUNG_CHANNEL));
  await expect(panel(page)).toContainText('Third video', { timeout: 10_000 });
  await expect(panel(page)).not.toContainText('First video');
  await expect(panel(page)).not.toContainText('×3');
  await expect(panel(page)).toContainText('100'); // 4,800 views ÷ 48 h
  await expect(panel(page)).toContainText('Loading');
  await expect(panel(page)).toContainText('Timed out loading the channel feed', { timeout: 15_000 });
  await ctx.close();
});
