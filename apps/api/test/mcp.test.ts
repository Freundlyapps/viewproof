import { env } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ChannelRow } from '@viewproof/db';
import { createApp, type Deps } from '../src/app';
import { MCP_DAILY_CALLS } from '../src/mcp/tokens';
import type { ReportQuery, VideoDetails, YouTubeClient } from '../src/youtube';
import { fakeGoogle } from './fake-google';
import { fakeYouTube } from './fake-youtube';
import { APP, addUser, channelFixture, makeDeps, post, sendJsonReq, sessionCookie, signIn } from './helpers';

const NOW = Date.parse('2026-11-21T12:00:00Z');
type App = ReturnType<typeof createApp>;

async function tokenFor(app: App, userId: string): Promise<string> {
  const res = await sendJsonReq(app, 'POST', '/api/mcp/tokens', await sessionCookie(userId), { label: 'test' });
  return ((await res.json()) as { token: string }).token;
}
function rpc(app: App, token: string | null, body: unknown, headers: Record<string, string> = {}) {
  return app.request('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: JSON.stringify(body),
  });
}
async function call(app: App, token: string, name: string, args: Record<string, unknown> = {}) {
  const res = await rpc(app, token, { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { result: { content: { type: string; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean } }).result;
}
function appWith(yt: Partial<YouTubeClient> = {}, over: Partial<Deps> = {}, envOver = {}) {
  const youtube = fakeYouTube(yt);
  const deps = makeDeps({ youtube, google: fakeGoogle({ refresh: async () => ({ accessToken: 'at' }) }), now: () => NOW, ...over }, envOver);
  return { app: createApp(deps), youtube };
}
async function connected(sub: string, channelId: string) {
  const s = await signIn({ sub, channel: channelFixture({ channelId }) });
  await post(s.app, '/connect/confirm', s.cookie, { id: s.pendingId });
  const row = (await env.DB.prepare('SELECT * FROM channels WHERE channel_id = ?').bind(channelId).first<ChannelRow>())!;
  return { cookie: s.cookie, row };
}
const overviewReport = async (_t: string, q: ReportQuery) =>
  q.dimensions?.[0] === 'day' ? { columns: ['day', 'views'], rows: [['2026-11-19', 3]] } : { columns: ['views', 'estimatedMinutesWatched', 'subscribersGained', 'subscribersLost'], rows: [[120, 300, 4, 1]] };

describe('MCP protocol', () => {
  test('initialize echoes a supported version, else answers the latest, with instructions', async () => {
    await addUser('mcp-p1');
    const { app } = appWith();
    const token = await tokenFor(app, 'mcp-p1');
    const a = (await (await rpc(app, token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })).json()) as { id: number; result: { protocolVersion: string; instructions: string; capabilities: unknown; serverInfo: { name: string } } };
    expect(a.id).toBe(1);
    expect(a.result.protocolVersion).toBe('2025-06-18');
    expect(a.result.serverInfo.name).toBe('viewproof');
    expect(a.result.serverInfo).toMatchObject({ icons: [{ src: `${APP}/app/connector-icon.png`, mimeType: 'image/png' }] });
    expect(a.result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(a.result.instructions).toContain("Never fill in or estimate a no_data value");
    const b = (await (await rpc(app, token, { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01', capabilities: {}, clientInfo: { name: 't', version: '1' } } })).json()) as { result: { protocolVersion: string } };
    expect(b.result.protocolVersion).toBe('2025-11-25');
  });

  test('notifications get 202, ping {}, batches and unknown methods are errors', async () => {
    await addUser('mcp-p2');
    const { app } = appWith();
    const token = await tokenFor(app, 'mcp-p2');
    const n = await rpc(app, token, { jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(n.status).toBe(202);
    expect(await n.text()).toBe('');
    expect(await (await rpc(app, token, { jsonrpc: '2.0', id: 3, method: 'ping' })).json()).toEqual({ jsonrpc: '2.0', id: 3, result: {} });
    const batch = (await (await rpc(app, token, [{ jsonrpc: '2.0', id: 4, method: 'ping' }])).json()) as { error: { code: number } };
    expect(batch.error.code).toBe(-32600);
    const unknown = (await (await rpc(app, token, { jsonrpc: '2.0', id: 5, method: 'resources/list' })).json()) as { id: number; error: { code: number } };
    expect(unknown).toMatchObject({ id: 5, error: { code: -32601 } });
  });

  test('GET is 405, a bad protocol header is 400, a foreign Origin is 403, no Origin is fine', async () => {
    await addUser('mcp-p3');
    const { app } = appWith();
    const token = await tokenFor(app, 'mcp-p3');
    const g = await app.request('/mcp', { headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' } });
    expect(g.status).toBe(405);
    expect(g.headers.get('allow')).toBe('POST');
    expect((await rpc(app, token, { jsonrpc: '2.0', id: 1, method: 'ping' }, { 'mcp-protocol-version': '1999-01-01' })).status).toBe(400);
    expect((await rpc(app, token, { jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await rpc(app, token, { jsonrpc: '2.0', id: 1, method: 'ping' }, { 'mcp-protocol-version': '2025-06-18' })).status).toBe(200);
  });

  test('missing, unknown or revoked tokens get 401 with WWW-Authenticate; a cookie is not enough', async () => {
    await addUser('mcp-p4');
    const { app } = appWith();
    const cookie = await sessionCookie('mcp-p4');
    const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };
    for (const t of [null, 'vpm_nope']) {
      const r = await rpc(app, t, ping);
      expect(r.status).toBe(401);
      expect(r.headers.get('www-authenticate')).toMatch(/^Bearer/);
      expect(((await r.json()) as { error: { message: string } }).error.message).toBeTruthy();
    }
    expect((await rpc(app, null, ping, { cookie })).status).toBe(401);
    const res = await sendJsonReq(app, 'POST', '/api/mcp/tokens', cookie, {});
    const t = (await res.json()) as { token: string; info: { id: string } };
    expect((await rpc(app, t.token, ping)).status).toBe(200);
    await sendJsonReq(app, 'DELETE', `/api/mcp/tokens/${t.info.id}`, cookie);
    expect((await rpc(app, t.token, ping)).status).toBe(401);
  });
});

describe('MCP tools', () => {
  test('tools/list names the 10 read-only tools', async () => {
    await addUser('mcp-t1');
    const { app } = appWith();
    const token = await tokenFor(app, 'mcp-t1');
    const r = (await (await rpc(app, token, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).json()) as { result: { tools: { name: string; inputSchema: { type: string }; annotations: { readOnlyHint: boolean } }[] } };
    expect(r.result.tools.map((t) => t.name).sort()).toEqual(['channel_overview', 'channel_videos', 'check_video_text', 'competitor_uploads', 'find_outliers', 'keyword_trends', 'list_channels', 'search_terms', 'upload_times', 'video_details']);
    for (const t of r.result.tools) {
      expect(t.annotations.readOnlyHint).toBe(true);
      expect(t.inputSchema.type).toBe('object');
    }
  });

  test('channel_overview equals the web endpoint and shares its cache', async () => {
    const { cookie, row } = await connected('mcp-t2', 'UCmcp2');
    const { app, youtube } = appWith({ report: overviewReport });
    const token = await tokenFor(app, row.user_id);
    const web = await (await app.request(`/api/channels/${row.id}/overview?range=28d`, { headers: { cookie } })).json();
    const reports = youtube.calls.length;
    const r = await call(app, token, 'channel_overview', { channel: row.id, range: '28d' });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toEqual(web);
    expect(JSON.parse(r.content[0]!.text)).toEqual(web);
    expect(youtube.calls.length).toBe(reports);
    // Default channel = the user's first.
    expect((await call(app, token, 'channel_overview', {})).structuredContent).toEqual(web);
  });

  test('list_channels lists only your channels', async () => {
    const { row } = await connected('mcp-t3', 'UCmcp3');
    const { app } = appWith();
    const token = await tokenFor(app, row.user_id);
    const r = await call(app, token, 'list_channels');
    expect(r.structuredContent).toEqual({ channels: [{ id: row.id, title: row.title, youtubeChannelId: 'UCmcp3', status: 'active', statusReason: null }] });
  });

  test("another user's channel id is refused", async () => {
    const { row: theirs } = await connected('mcp-t4a', 'UCmcp4a');
    const { row: mine } = await connected('mcp-t4b', 'UCmcp4b');
    const { app, youtube } = appWith({ report: overviewReport });
    const token = await tokenFor(app, mine.user_id);
    const r = await call(app, token, 'channel_overview', { channel: theirs.id });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toBe('No connected channel with that id. Call list_channels for your channel ids.');
    expect(youtube.calls).toHaveLength(0);
  });

  test('a channel whose Google access was removed returns the reason', async () => {
    const { row } = await connected('mcp-t5', 'UCmcp5');
    const { app } = appWith({ report: overviewReport }, { google: fakeGoogle({ refresh: async () => ({ kind: 'revoked' }) }) });
    const token = await tokenFor(app, row.user_id);
    const r = await call(app, token, 'channel_videos', { range: '90d' });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toBe('Google access was removed or expired');
  });

  test('no channel connected', async () => {
    await addUser('mcp-t6');
    const { app } = appWith();
    const token = await tokenFor(app, 'mcp-t6');
    const r = await call(app, token, 'search_terms');
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toBe('No channel is connected yet. Connect one at http://localhost:8787/app/settings.');
  });

  test("video_details: another channel's video, and a bad id", async () => {
    const { row } = await connected('mcp-t7', 'UCmcp7');
    const video = async (): Promise<VideoDetails> => ({ videoId: 'abcdefghijk', channelId: 'UCother', title: 't', description: '', tags: [], publishedAt: '2026-10-01T00:00:00Z', durationSec: 60 });
    const { app } = appWith({ video });
    const token = await tokenFor(app, row.user_id);
    const r = await call(app, token, 'video_details', { videoId: 'abcdefghijk' });
    expect(r).toMatchObject({ isError: true, content: [{ type: 'text', text: 'Video not found on this channel.' }] });
    const bad = await call(app, token, 'video_details', { videoId: 'nope' });
    expect(bad).toMatchObject({ isError: true, content: [{ text: 'That is not a YouTube video id.' }] });
  });

  test('find_outliers returns the same as the web endpoint; check_video_text runs the core checks', async () => {
    await addUser('mcp-t8');
    const { app } = appWith();
    const token = await tokenFor(app, 'mcp-t8');
    const cookie = await sessionCookie('mcp-t8');
    const web = await (await app.request('/api/outliers?q=pottery&days=90&min=2', { headers: { cookie } })).json();
    expect((await call(app, token, 'find_outliers', { q: 'pottery', days: 90, min: 2 })).structuredContent).toEqual(web);
    const c = await call(app, token, 'check_video_text', { title: 'How to throw a pottery bowl', keyword: 'pottery', tags: ['a', 'b'] });
    const sc = c.structuredContent as { title: { id: string; status: string }[]; tags: { id: string; status: string }[]; description?: unknown };
    expect(sc.title.find((x) => x.id === 'keyword')!.status).toBe('pass');
    expect(sc.tags.find((x) => x.id === 'count')!.status).toBe('fail');
    expect(sc.description).toBeUndefined();
  });

  test('bad arguments are a tool error; an unknown tool is a protocol error', async () => {
    await addUser('mcp-t9');
    const { app } = appWith();
    const token = await tokenFor(app, 'mcp-t9');
    const r = await call(app, token, 'channel_overview', { range: '2d' });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/^Invalid arguments: range /);
    const t = await call(app, token, 'check_video_text', {});
    expect(t.content[0]!.text).toMatch(/^Invalid arguments: title /);
    const u = (await (await rpc(app, token, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'delete_everything', arguments: {} } })).json()) as { error: { code: number; message: string } };
    expect(u.error).toMatchObject({ code: -32602, message: 'Unknown tool: delete_everything' });
  });

  test('call 501 of the day hits the limit and does not run the tool', async () => {
    const { row } = await connected('mcp-t10', 'UCmcp10');
    const { app, youtube } = appWith({ report: overviewReport });
    const token = await tokenFor(app, row.user_id);
    await env.DB.prepare('INSERT INTO mcp_calls (user_id, day, count) VALUES (?, ?, ?)').bind(row.user_id, new Date(NOW).toISOString().slice(0, 10), MCP_DAILY_CALLS).run();
    const r = await call(app, token, 'channel_overview');
    expect(r).toMatchObject({ isError: true, content: [{ text: 'You used all 500 MCP tool calls for today. More tomorrow.' }] });
    expect(youtube.calls).toHaveLength(0);
  });
});

describe('MCP interop', () => {
  test('the official SDK client connects, lists and calls a tool', async () => {
    await addUser('mcp-i1');
    const { app } = appWith();
    const token = await tokenFor(app, 'mcp-i1');
    const transport = new StreamableHTTPClientTransport(new URL('http://localhost:8787/mcp'), {
      fetch: async (u, init) => app.request(String(u), init as RequestInit),
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    });
    const client = new Client({ name: 'interop-test', version: '1.0.0' });
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(10);
    const r = await client.callTool({ name: 'check_video_text', arguments: { title: 'Hello' } });
    expect((r.structuredContent as { title: unknown[] }).title.length).toBeGreaterThan(0);
    await client.close();
  });
});
