// POST /mcp: the read-only MCP endpoint. Bearer token only; cookies are ignored.
import type { Hono } from 'hono';
import type { Deps } from '../app';
import { SUPPORTED_VERSIONS, handleMcp, rpcError } from './protocol';
import { userForToken } from './tokens';

const NO_TOKEN = 'Missing or invalid token. Create one in ViewProof under Settings → AI & apps.';

export function mcpRoutes(app: Hono, deps: Deps): void {
  app.all('/mcp', async (c) => {
    if (c.req.method !== 'POST') return c.body(null, 405, { allow: 'POST' });
    const version = c.req.header('mcp-protocol-version');
    if (version && !SUPPORTED_VERSIONS.includes(version)) return c.json(rpcError(null, -32600, `Unsupported MCP protocol version: ${version}`), 400);
    const userId = await userForToken(deps, c.req.header('authorization'));
    if (!userId) return c.json(rpcError(null, -32001, NO_TOKEN), 401, { 'www-authenticate': 'Bearer realm="viewproof"' });
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(rpcError(null, -32700, 'Parse error'), 400);
    }
    const out = await handleMcp(deps, userId, body);
    if (out === null) return c.body(null, 202);
    return c.json(out, Array.isArray(body) ? 400 : 200);
  });
}
