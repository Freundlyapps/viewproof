import { env } from 'cloudflare:test';
import { expect, test } from 'vitest';

const user = (id: string) => env.DB.prepare("INSERT INTO users (id, google_sub, created_at) VALUES (?, ?, '2026-11-21T00:00:00Z')").bind(id, `sub-${id}`).run();
const channel = (id: string, userId: string, channelId: string, status = 'active') =>
  env.DB.prepare(
    "INSERT INTO channels (id, user_id, channel_id, scopes, refresh_token_enc, status, connected_at, last_verified_at) VALUES (?, ?, ?, 's', 'x', ?, 't', 't')",
  ).bind(id, userId, channelId, status).run();

test('all tables exist', async () => {
  const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>();
  const names = results.map((r) => r.name);
  for (const t of ['users', 'sessions', 'oauth_states', 'pending_connections', 'channels']) expect(names).toContain(t);
});

test('a channel can belong to only one account', async () => {
  await user('u1');
  await user('u2');
  await channel('c1', 'u1', 'UC1');
  await expect(channel('c2', 'u2', 'UC1')).rejects.toThrow();
});

test('status is limited to active, reconnect, gone', async () => {
  await user('u3');
  await expect(channel('c3', 'u3', 'UC3', 'paused')).rejects.toThrow();
});
