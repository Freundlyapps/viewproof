// Minimal stateless MCP server over JSON-RPC (Streamable HTTP, JSON responses only). Plan 6c.
import type { Deps } from '../app';
import { countCall, MCP_DAILY_CALLS } from './tokens';
import { TOOLS, inputSchema, validate } from './tools';

export const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
export const LATEST_VERSION = SUPPORTED_VERSIONS[0]!;
const SERVER_VERSION = '0.1.0';
export const INSTRUCTIONS = "ViewProof gives read-only research data for the creator's YouTube channels and niche. Numbers come as measured values: kind 'value' with its source, or kind 'no_data' with a reason. Never fill in or estimate a no_data value; tell the user the reason. Search volume estimates are labelled as estimates; outliers come from videos ViewProof's network observed, not all of YouTube. ViewProof has no thumbnail impressions, click-through rate or returning-viewer data: say so instead of guessing them.";
const LIMIT_MESSAGE = `You used all ${MCP_DAILY_CALLS} MCP tool calls for today. More tomorrow.`;

type Id = string | number | null;
export const rpcError = (id: Id, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });
const ok = (id: Id, result: unknown) => ({ jsonrpc: '2.0', id, result });
const toolError = (message: string) => ({ content: [{ type: 'text', text: message }], isError: true });

/** One JSON-RPC message → its response, or null for a notification (no id). */
export async function handleMcp(deps: Deps, userId: string, body: unknown): Promise<object | null> {
  if (Array.isArray(body)) return rpcError(null, -32600, 'Batches are not supported');
  if (!body || typeof body !== 'object') return rpcError(null, -32600, 'Invalid request');
  const m = body as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
  const isRequest = typeof m.id === 'string' || typeof m.id === 'number';
  if (!isRequest) return null; // notifications and responses need no answer
  const id = m.id as string | number;
  if (m.jsonrpc !== '2.0' || typeof m.method !== 'string') return rpcError(id, -32600, 'Invalid request');
  const params = (m.params && typeof m.params === 'object' ? m.params : {}) as Record<string, unknown>;

  switch (m.method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      return ok(id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : LATEST_VERSION,
        capabilities: { tools: { listChanged: false } },
        // Apps that show server icons (MCP 2025-11-25) pick up the logo without the user uploading one.
        serverInfo: { name: 'viewproof', title: 'ViewProof', version: SERVER_VERSION, websiteUrl: deps.config.appOrigin,
          icons: [{ src: `${deps.config.appOrigin}/app/connector-icon.png`, mimeType: 'image/png', sizes: ['256x256'] }] },
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return ok(id, {});
    case 'tools/list':
      return ok(id, {
        tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: inputSchema(t), annotations: { title: t.title, readOnlyHint: true, openWorldHint: false } })),
      });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${typeof params.name === 'string' ? params.name : ''}`);
      const args = validate(tool, params.arguments);
      if (typeof args === 'string') return ok(id, toolError(args));
      const counted = await countCall(deps, userId);
      if (!counted.ok) return ok(id, toolError(LIMIT_MESSAGE));
      try {
        const r = await tool.run({ deps, userId }, args);
        if ('error' in r) return ok(id, toolError(r.error));
        return ok(id, { content: [{ type: 'text', text: JSON.stringify(r.data) }], structuredContent: r.data });
      } catch (e) {
        return ok(id, toolError(`The tool failed: ${e instanceof Error ? e.message.slice(0, 200) : 'unknown error'}`));
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${m.method}`);
  }
}
