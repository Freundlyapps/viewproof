import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import { SCOPES } from '../src/google';
import { maxChannels } from '../src/plans';
import { ALL_SCOPES, channelFixture, post, readText, signIn } from './helpers';

const channelRows = (channelId: string) => env.DB.prepare('SELECT user_id, status FROM channels WHERE channel_id = ?').bind(channelId).all();

describe('confirm page', () => {
  test('renders channel facts and both choices', async () => {
    const { app, cookie, pendingId } = await signIn({ sub: 'c-render', channel: channelFixture({ channelId: 'UCrender' }) });
    const html = await readText(await app.request(`/connect/confirm?id=${pendingId}`, { headers: { cookie } }));
    for (const s of ['Is this the right channel?', 'Quiet Hands Pottery', '@quiethands', '12,345 subscribers', '41 videos', 'UCrender', 'Yes, connect', 'Pick another',
      "Not the one? Google's list sometimes shows a channel's old name. Go back and pick the account in the same position as in your YouTube channel list."]) {
      expect(html).toContain(s);
    }
  });

  test('hidden subscriber count says so', async () => {
    const { app, cookie, pendingId } = await signIn({ sub: 'c-hidden', channel: channelFixture({ channelId: 'UChidden', subscriberCount: null }) });
    expect(await readText(await app.request(`/connect/confirm?id=${pendingId}`, { headers: { cookie } }))).toContain('Subscriber count hidden');
  });

  test("another user's pending id is 404", async () => {
    const a = await signIn({ sub: 'c-owner', channel: channelFixture({ channelId: 'UCowner' }) });
    const b = await signIn({ sub: 'c-other', channel: channelFixture({ channelId: 'UCother' }) });
    const res = await a.app.request(`/connect/confirm?id=${a.pendingId}`, { headers: { cookie: b.cookie } });
    expect(res.status).toBe(404);
  });

  test('signed out goes to sign-in', async () => {
    const { app, pendingId } = await signIn({ sub: 'c-out', channel: channelFixture({ channelId: 'UCout' }) });
    const res = await app.request(`/connect/confirm?id=${pendingId}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/auth/google/start');
  });
});

describe('confirm', () => {
  test('creates an active channel and clears the pending row', async () => {
    const { app, cookie, pendingId } = await signIn({ sub: 'c-yes', channel: channelFixture({ channelId: 'UCyes' }) });
    const res = await post(app, '/connect/confirm', cookie, { id: pendingId });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/account?connected=UCyes');
    expect((await channelRows('UCyes')).results).toEqual([expect.objectContaining({ status: 'active' })]);
    expect(await env.DB.prepare('SELECT id FROM pending_connections WHERE id = ?').bind(pendingId).first()).toBeNull();
  });

  test('confirm twice is harmless', async () => {
    const { app, cookie, pendingId } = await signIn({ sub: 'c-twice', channel: channelFixture({ channelId: 'UCtwice' }) });
    await post(app, '/connect/confirm', cookie, { id: pendingId });
    const again = await post(app, '/connect/confirm', cookie, { id: pendingId });
    expect(again.status).toBe(302);
    expect(again.headers.get('location')).toBe('/account');
    expect((await channelRows('UCtwice')).results).toHaveLength(1);
  });

  test('reconnecting an existing channel refreshes it instead of hitting the limit', async () => {
    const first = await signIn({ sub: 'c-recon', channel: channelFixture({ channelId: 'UCrecon' }) });
    await post(first.app, '/connect/confirm', first.cookie, { id: first.pendingId });
    await env.DB.prepare("UPDATE channels SET status = 'reconnect' WHERE channel_id = 'UCrecon'").run();
    // Reconnecting your own channel needs no second confirmation: the callback refreshes it directly.
    const again = await signIn({ sub: 'c-recon', channel: channelFixture({ channelId: 'UCrecon' }), cookie: first.cookie });
    expect(again.callback.headers.get('location')).toBe('/account?connected=UCrecon');
    expect((await channelRows('UCrecon')).results).toEqual([expect.objectContaining({ status: 'active' })]);
  });

  test('free plan limit', async () => {
    const first = await signIn({ sub: 'c-limit', channel: channelFixture({ channelId: 'UClimit1' }) });
    await post(first.app, '/connect/confirm', first.cookie, { id: first.pendingId });
    const second = await signIn({ sub: 'c-limit', channel: channelFixture({ channelId: 'UClimit2' }), cookie: first.cookie });
    const res = await post(second.app, '/connect/confirm', first.cookie, { id: second.pendingId });
    expect(await readText(res)).toContain('Your plan allows 1 channel. Remove one first.');
    expect((await channelRows('UClimit2')).results).toHaveLength(0);
    expect(second.google.calls).toContain('revoke');
  });

  test('self-hosted has no limit', async () => {
    const envOver = { SELF_HOSTED: 'true' };
    const first = await signIn({ sub: 'c-self', channel: channelFixture({ channelId: 'UCself1' }), envOver });
    await post(first.app, '/connect/confirm', first.cookie, { id: first.pendingId });
    const second = await signIn({ sub: 'c-self', channel: channelFixture({ channelId: 'UCself2' }), cookie: first.cookie, envOver });
    await post(second.app, '/connect/confirm', first.cookie, { id: second.pendingId });
    expect((await channelRows('UCself2')).results).toHaveLength(1);
  });

  test('channel connected to another account is refused', async () => {
    const a = await signIn({ sub: 'c-first', channel: channelFixture({ channelId: 'UCshared' }) });
    await post(a.app, '/connect/confirm', a.cookie, { id: a.pendingId });
    const own = await signIn({ sub: 'c-second', channel: channelFixture({ channelId: 'UCsecondown' }) });
    await post(own.app, '/connect/confirm', own.cookie, { id: own.pendingId });
    // signed in as c-second, a Google identity that manages UCshared too
    const b = await signIn({ sub: 'c-second-brand', channel: channelFixture({ channelId: 'UCshared' }), cookie: own.cookie });
    expect(await readText(b.callback)).toContain('This channel is already connected to another ViewProof account.');
    expect((await channelRows('UCshared')).results).toEqual([expect.objectContaining({ status: 'active' })]);
    expect(b.google.calls).not.toContain('revoke'); // revoking would break the first account's connection
  });
});

describe('pick another', () => {
  test('forces the account chooser and keeps the revenue choice', async () => {
    const { app, cookie, pendingId, google } = await signIn({ sub: 'c-pick', channel: channelFixture({ channelId: 'UCpick' }), scopes: [...ALL_SCOPES, SCOPES.revenue], query: '?revenue=1' });
    const res = await post(app, '/connect/cancel', cookie, { id: pendingId });
    expect(res.headers.get('location')).toBe('/auth/google/start?choose=1&revenue=1');
    expect(google.calls).toContain('revoke');
    expect(await env.DB.prepare('SELECT id FROM pending_connections WHERE id = ?').bind(pendingId).first()).toBeNull();
  });
});

describe('maxChannels', () => {
  test('per plan', () => {
    expect(maxChannels('free', false)).toBe(1);
    expect(maxChannels('pro', false)).toBe(3);
    expect(maxChannels('free', true)).toBe(Infinity);
    expect(maxChannels('unknown', false)).toBe(1);
  });
});
