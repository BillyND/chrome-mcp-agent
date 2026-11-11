import { createMcpHandler, fromJsonSchema, McpServer, type JsonSchemaType } from '@modelcontextprotocol/server';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/server/validators/cf-worker';
import { TOOLS } from '../../shared/tools';
import type { Env } from './env';

const validator = new CfWorkerJsonSchemaValidator();
const schemas = new Map(TOOLS.map((t) => [t.name, fromJsonSchema(t.inputSchema as JsonSchemaType, validator)]));

const INSTRUCTIONS = `Helmsman controls the user's own Google Chrome (their real tabs and logged-in accounts).
Workflow: browser_tabs (list/select or open) -> browser_snapshot -> act with refs from the latest snapshot -> snapshot again to verify.
- Refs look like "e12" (top page) or "f3e7" (inside an iframe); iframes, including cross-origin ones, are part of the snapshot and work like normal elements.
- Every action returns a fresh short page summary; take a new snapshot after navigation or big page changes because refs from older snapshots expire.
- Prefer browser_snapshot over screenshots; use browser_screenshot for visual checks (charts, captchas, layouts).
- Ask the user before purchases, sending messages/emails, deleting data or changing account settings unless they clearly asked for it.
- If a tool says Chrome is not connected, tell the user to open Chrome and click the Helmsman icon.`;

function buildServer(env: Env, device: string): McpServer {
  const server = new McpServer({ name: 'helmsman', version: '1.0.0' }, { instructions: INSTRUCTIONS });
  const hub = env.HUB.get(env.HUB.idFromName(device));
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: schemas.get(tool.name)!,
        annotations: {
          title: tool.title,
          readOnlyHint: tool.readOnly,
          destructiveHint: !tool.readOnly,
          openWorldHint: true,
        },
      },
      async (args: unknown) => {
        const input = (args ?? {}) as Record<string, unknown>;
        const safeToRepeat = tool.readOnly || (tool.name === 'browser_tabs' && (input.action ?? 'list') === 'list');
        const result = await hub.call(tool.name, input, tool.timeoutMs, safeToRepeat);
        return { content: result.content, isError: result.isError };
      },
    );
  }
  return server;
}

/** Serves the MCP endpoint for one authenticated user. */
export async function handleMcp(request: Request, env: Env, device: string): Promise<Response> {
  const handler = createMcpHandler(() => buildServer(env, device), { legacy: 'stateless', responseMode: 'json' });
  return handler.fetch(request);
}
