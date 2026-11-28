// Bearer tokens for the read-only MCP server (plan 6c). Shown once; only the SHA-256 is stored.
import type { Context, Hono } from 'hono';
import type { Deps } from '../app';
import { randomToken, sha256Hex } from '../crypto';
import { MCP_DAILY_CALLS, mcpLimit } from '../plans';
import { readSession } from '../session';

export { MCP_DAILY_CALLS };
export const MAX_MCP_TOKENS = 5;
const DEFAULT_LABEL = 'AI app';

/** `connectedApp`: made by signing in from an AI app (OAuth), not created by hand. */
export interface McpTokenInfo { id: string; label: string; createdAt: string; lastUsedAt: string | null; connectedApp: boolean }
interface Row { id: string; label: string; created_at: string; last_used_at: string | null; client_id: string | null }

const dayOf = (deps: Deps) => new Date(deps.now()).toISOString().slice(0, 10);
const info = (r: Row): McpTokenInfo => ({ id: r.id, label: r.label, createdAt: r.created_at, lastUsedAt: r.last_used_at, connectedApp: r.client_id !== null });

export async function tokensOf(deps: Deps, userId: string): Promise<McpTokenInfo[]> {
  return (await deps.db.prepare('SELECT id, label, created_at, last_used_at, client_id FROM mcp_tokens WHERE user_id = ? ORDER BY created_at, id').bind(userId).all<Row>()).results.map(info);
}

/** The user an `Authorization: Bearer vpm_…` header belongs to, or null. Records the time of use. Connected apps' tokens expire. */
export async function userForToken(deps: Deps, header: string | undefined): Promise<string | null> {
  const m = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? '');
  if (!m) return null;
  const hash = await sha256Hex(m[1]!);
  const now = new Date(deps.now()).toISOString();
  const row = await deps.db.prepare('UPDATE mcp_tokens SET last_used_at = ? WHERE id_hash = ? AND (expires_at IS NULL OR expires_at > ?) RETURNING user_id')
    .bind(now, hash, now).first<{ user_id: string }>();
  return row?.user_id ?? null;
}

/** Counts one tool call against today's limit, atomically; refused calls are not counted. */
export async function countCall(deps: Deps, userId: string): Promise<{ ok: true } | { ok: false; limit: number }> {
  const limit = mcpLimit(deps.config.selfHosted);
  if (limit === null) {
    await deps.db.prepare('INSERT INTO mcp_calls (user_id, day, count) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1').bind(userId, dayOf(deps)).run();
    return { ok: true };
  }
  const row = await deps.db
    .prepare('INSERT INTO mcp_calls (user_id, day, count) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count')
    .bind(userId, dayOf(deps), limit).first<{ count: number }>();
  return row ? { ok: true } : { ok: false, limit };
}

export async function callsToday(deps: Deps, userId: string): Promise<number> {
  return (await deps.db.prepare('SELECT count FROM mcp_calls WHERE user_id = ? AND day = ?').bind(userId, dayOf(deps)).first<{ count: number }>())?.count ?? 0;
}

const err = (c: Context, status: 401 | 422, error: string, message: string) => c.json({ error, message }, status);

export function mcpTokenRoutes(app: Hono, deps: Deps): void {
  app.get('/api/mcp/tokens', async (c) => {
    const s = await readSession(c, deps);
    if (!s) return err(c, 401, 'signed_out', 'Sign in first.');
    return c.json({
      endpoint: `${deps.config.appOrigin}/mcp`,
      tokens: await tokensOf(deps, s.userId),
      usage: { used: await callsToday(deps, s.userId), limit: mcpLimit(deps.config.selfHosted) },
    });
  });

  app.post('/api/mcp/tokens', async (c) => {
    const s = await readSession(c, deps);
    if (!s) return err(c, 401, 'signed_out', 'Sign in first.');
    const n = (await deps.db.prepare('SELECT COUNT(*) AS n FROM mcp_tokens WHERE user_id = ? AND client_id IS NULL').bind(s.userId).first<{ n: number }>())!.n;
    if (n >= MAX_MCP_TOKENS) return err(c, 422, 'limit', `You can have up to ${MAX_MCP_TOKENS} MCP tokens. Revoke one first.`);
    const body = (await c.req.json().catch(() => null)) as { label?: unknown } | null;
    const label = typeof body?.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 40) : DEFAULT_LABEL;
    const token = `vpm_${randomToken(32)}`;
    const row: Row = { id: randomToken(12), label, created_at: new Date(deps.now()).toISOString(), last_used_at: null, client_id: null };
    await deps.db.prepare('INSERT INTO mcp_tokens (id, id_hash, user_id, label, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(row.id, await sha256Hex(token), s.userId, row.label, row.created_at).run();
    return c.json({ token, info: info(row) }, 201);
  });

  app.delete('/api/mcp/tokens/:id', async (c) => {
    const s = await readSession(c, deps);
    if (!s) return err(c, 401, 'signed_out', 'Sign in first.');
    await deps.db.prepare('DELETE FROM mcp_tokens WHERE id = ? AND user_id = ?').bind(c.req.param('id'), s.userId).run();
    return c.body(null, 204);
  });
}
