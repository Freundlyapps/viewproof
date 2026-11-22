// Loads the built extension into Chromium and serves fake youtube.com pages through
// request routing — no real YouTube traffic. Real-page behaviour is checked by hand (README).
import { type BrowserContext, chromium, expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'node:fs';
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

function feed(extra?: string): string {
  const newest = extra ? [`
  <entry><yt:videoId>${extra}</yt:videoId><title>new</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=${extra}"/>
    <published>${new Date(Date.now() - 24 * HOUR).toISOString()}</published>
    <media:group><media:community><media:statistics views="1"/></media:community></media:group></entry>`] : [];
  const entries = [...newest, ...[10000, 20000, 30000, 30000, 40000, 50000].map((v, i) => `
  <entry><yt:videoId>base0000${i}aa</yt:videoId><title>b${i}</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=base0000${i}aa"/>
    <published>${new Date(Date.now() - (200 + i * 24) * HOUR).toISOString()}</published>
    <media:group><media:community><media:statistics views="${v}"/></media:community></media:group></entry>`)];
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

const FIX = (n: string) => readFileSync(fileURLToPath(new URL(`../../../packages/core/test/fixtures/${n}`, import.meta.url)), 'utf8');
const SEARCH_VIDEO = '-YCGK33c0xs';
const SEARCH_CHANNEL = 'UCqZL_f4Jp8yHnv2KNvcsWeg';
const tileHtml = (tag: string, id: string) => `<${tag}><a href="/watch?v=${id}">thumb</a><div id="details"><h3><a href="/watch?v=${id}">title ${id}</a></h3></div></${tag}>`;

function channelPage(): string {
  return `<!doctype html><html><body><ytd-browse><div id="primary"><ytd-rich-grid-renderer>
    ${['uXuQF_PPg5U', 'KfODG5REyss', 'Y-W-w8yNiKU'].map((id) => tileHtml('ytd-rich-item-renderer', id)).join('')}
  </ytd-rich-grid-renderer></div></ytd-browse>
  <script>window.ytInitialData = ${FIX('channel-videos.json')};</script></body></html>`;
}

function searchPage(): string {
  return `<!doctype html><html><body><ytd-search><div id="primary"><ytd-section-list-renderer><div id="contents">
    ${tileHtml('ytd-video-renderer', SEARCH_VIDEO)}${tileHtml('ytd-video-renderer', 'otherresult1')}
  </div></ytd-section-list-renderer></div></ytd-search>
  <script>window.ytInitialData = ${FIX('search-results-en.json')};</script></body></html>`;
}

let holdSearchFeed: Promise<void> | null = null;

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
    if (url.pathname === '/feeds/videos.xml' && url.searchParams.get('channel_id') === SEARCH_CHANNEL && feedStatus === 200) {
      if (holdSearchFeed) return holdSearchFeed.then(() => route.fulfill({ status: 200, contentType: 'application/xml', body: feed(SEARCH_VIDEO) }));
      return route.fulfill({ status: 200, contentType: 'application/xml', body: feed(SEARCH_VIDEO) });
    }
    if (url.pathname === '/feeds/videos.xml') {
      if (url.searchParams.get('channel_id') === HUNG_CHANNEL) return; // never answers
      return feedStatus === 200
        ? route.fulfill({ status: 200, contentType: 'application/xml', body: feed() })
        : route.fulfill({ status: feedStatus, body: '' });
    }
    if (url.pathname === '/@fixture/videos') return route.fulfill({ status: 200, contentType: 'text/html', body: channelPage() });
    if (url.pathname === '/results') return route.fulfill({ status: 200, contentType: 'text/html', body: searchPage() });
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

const pagePanel = (page: import('@playwright/test').Page) => page.locator('#viewproof-page-panel');

test('watch page shows the checklist', async () => {
  const ctx = await launch(200);
  const page = await ctx.newPage();
  await page.goto('https://www.youtube.com/watch?v=VIDEO000001');
  await expect(panel(page)).toContainText('Checklist', { timeout: 15_000 });
  await expect(panel(page)).toContainText('Title length');
  await expect(panel(page)).toContainText('No end screen');
  await ctx.close();
});

test('channel page: panel above the grid and ×N badges on tiles', async () => {
  const ctx = await launch(200);
  const page = await ctx.newPage();
  await page.goto('https://www.youtube.com/@fixture/videos');
  await expect(pagePanel(page)).toContainText("This channel's videos", { timeout: 15_000 });
  await expect(pagePanel(page)).toContainText('rounded');
  await expect(pagePanel(page)).toContainText('×N for 25 of 30 videos');
  await expect(page.locator('ytd-rich-item-renderer').first().locator('[data-viewproof-badge]')).toHaveText(/^×[\d.]+$/);
  // The oldest video on the page has no older neighbours: no badge.
  await expect(page.locator('ytd-rich-item-renderer').nth(2).locator('[data-viewproof-badge]')).toHaveCount(0);
  await ctx.close();
});

test('search page: competition facts, and ×N for a result in its channel feed', async () => {
  const ctx = await launch(200);
  const page = await ctx.newPage();
  await page.goto('https://www.youtube.com/results?search_query=pottery');
  await expect(pagePanel(page)).toContainText('What ranks for "pottery"', { timeout: 15_000 });
  await expect(pagePanel(page)).toContainText('Median views');
  await expect(pagePanel(page)).toContainText('×N shown for 1 of', { timeout: 15_000 });
  await expect(page.locator('ytd-video-renderer').first().locator('[data-viewproof-badge]')).toHaveText('×68.7');
  await expect(page.locator('ytd-video-renderer').nth(1).locator('[data-viewproof-badge]')).toHaveCount(0);
  await ctx.close();
});

test('switching channel pages off in settings hides the panel, live', async () => {
  const ctx = await launch(200);
  const page = await ctx.newPage();
  await page.goto('https://www.youtube.com/@fixture/videos');
  await expect(pagePanel(page)).toContainText("This channel's videos", { timeout: 15_000 });
  const sw = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  const opts = await ctx.newPage();
  await opts.goto(`chrome-extension://${id}/options.html`);
  await opts.locator('#panel-channel').uncheck();
  await expect(pagePanel(page)).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('[data-viewproof-badge]')).toHaveCount(0);
  await opts.locator('#panel-channel').check();
  await expect(pagePanel(page)).toContainText("This channel's videos", { timeout: 15_000 });
  await ctx.close();
});

test('a new search while the old feeds are pending: no ×N from the old search', async () => {
  let release!: () => void;
  holdSearchFeed = new Promise((r) => { release = r; });
  const ctx = await launch(200);
  const page = await ctx.newPage();
  await page.goto('https://www.youtube.com/results?search_query=pottery');
  await expect(pagePanel(page)).toContainText('Checking channel feeds', { timeout: 15_000 });
  // Search B: the same tiles stay in the DOM (YouTube reuses them), but B's results don't include the held video.
  const b = JSON.parse(FIX('search-results-en.json'));
  const items = b.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents[0].itemSectionRenderer.contents;
  b.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents[0].itemSectionRenderer.contents =
    items.filter((i: { videoRenderer?: { videoId?: string } }) => i.videoRenderer?.videoId !== SEARCH_VIDEO);
  await page.evaluate((data) => {
    document.dispatchEvent(new Event('yt-navigate-start'));
    history.pushState({}, '', '/results?search_query=glaze');
    document.dispatchEvent(new CustomEvent('yt-navigate-finish', { detail: { response: { response: data } } }));
  }, b);
  await expect(pagePanel(page)).toContainText('What ranks for "glaze"', { timeout: 15_000 });
  release();
  holdSearchFeed = null;
  await expect(pagePanel(page)).toContainText('×N shown for 0 of', { timeout: 15_000 });
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-viewproof-badge]')).toHaveCount(0);
  await expect(pagePanel(page)).not.toContainText('pottery');
  await ctx.close();
});
