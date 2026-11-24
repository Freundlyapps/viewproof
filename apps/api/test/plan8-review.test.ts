// Plan 8 final review: each Important finding pinned by a test.
import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import { createApp } from '../src/app';
import { runCron } from '../src/competitors/cron';
import { addUser, makeDeps, readText, sessionCookie } from './helpers';

const NOW = Date.parse('2026-11-23T10:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const H = 3_600_000;
const D = 24 * H;
const BILLING = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x', STRIPE_PRICE_ID: 'price_x' };

describe('YouTube data is deleted when its cache time is over (privacy page and YouTube storage rules)', () => {
  test('the hourly job deletes reports older than 6 hours and first-week views older than 30 days', async () => {
    await addUser('p8-c1');
    await env.DB.prepare("INSERT INTO channels (id, user_id, platform, channel_id, title, scopes, refresh_token_enc, status, connected_at, last_verified_at) VALUES ('p8-ch1', 'p8-c1', 'youtube', 'UCp8000000000000000000c1', 'T', 'x', 'enc', 'active', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')").run();
    const put = (key: string, at: string) => env.DB.prepare("INSERT INTO report_cache (channel_id, key, body, fetched_at) VALUES ('p8-ch1', ?, '{}', ?)").bind(key, at).run();
    await put('daily:28d:2026-11-20', ago(3 * D));
    await put('uploads:2026-11-23', ago(7 * H));
    await put('terms:90d:2026-11-23', ago(H));
    await put('fw:old', ago(31 * D));
    await put('fw:new', ago(10 * D));
    await env.DB.prepare("INSERT INTO keyword_cache (keyword, country, provider, body, fetched_at) VALUES ('p8 old', 'US', 'x', '{}', ?), ('p8 new', 'US', 'x', '{}', ?)").bind(ago(31 * D), ago(D)).run();
    await runCron(makeDeps({ now: () => NOW }), new Date(NOW));
    const keys = await env.DB.prepare("SELECT key FROM report_cache WHERE channel_id = 'p8-ch1' ORDER BY key").all<{ key: string }>();
    expect(keys.results.map((r) => r.key)).toEqual(['fw:new', 'terms:90d:2026-11-23']);
    const kws = await env.DB.prepare("SELECT keyword FROM keyword_cache WHERE keyword LIKE 'p8 %'").all<{ keyword: string }>();
    expect(kws.results.map((r) => r.keyword)).toEqual(['p8 new']);
  }, 60_000);
});

describe('privacy and terms say only what is true on this server', () => {
  test('the pool sentence names the browser token; export covers every table about you', async () => {
    const html = await readText(await createApp(makeDeps()).request('/privacy'));
    expect(html).not.toContain('without your identity');
    expect(html).toContain("sent with your linked browser's token");
    expect(html).toContain('stored without any link to your account');
    await addUser('p8-e1');
    await env.DB.batch([
      env.DB.prepare("INSERT INTO competitor_lookups (user_id, day, count) VALUES ('p8-e1', '2026-11-23', 4)"),
      env.DB.prepare("INSERT INTO pool_suspensions (user_id, until) VALUES ('p8-e1', '2026-11-30T00:00:00Z')"),
    ]);
    const res = await createApp(makeDeps()).request('/account/export', { headers: { cookie: await sessionCookie('p8-e1') } });
    const body = await res.json<Record<string, unknown>>();
    expect(body.competitorLookups).toEqual([{ day: '2026-11-23', count: 4 }]);
    expect(body.poolSuspension).toEqual({ until: '2026-11-30T00:00:00Z' });
  });

  test('names who else receives data, and how the browser stores it', async () => {
    const html = await readText(await createApp(makeDeps()).request('/privacy'));
    expect(html).toContain('hosting provider');
    expect(html).toContain('DataForSEO');
    expect(html).toContain('chrome.storage.local');
  });

  test('self-hosted (no billing): no Stripe or Pro text; with billing: both', async () => {
    const off = createApp(makeDeps({}, { SELF_HOSTED: 'true' }));
    expect(await readText(await off.request('/terms'))).not.toContain('Pro renews');
    expect(await readText(await off.request('/privacy'))).not.toContain('Stripe');
    const on = createApp(makeDeps({}, BILLING));
    expect(await readText(await on.request('/terms'))).toContain('Pro renews');
    expect(await readText(await on.request('/privacy'))).toContain('Stripe');
  });
});
