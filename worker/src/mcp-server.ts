import { createMcpHandler, fromJsonSchema, McpServer, type JsonSchemaType } from '@modelcontextprotocol/server';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/server/validators/cf-worker';
import { TOOLS } from '../../shared/tools';
import type { Env } from './env';

const validator = new CfWorkerJsonSchemaValidator();
const schemas = new Map(TOOLS.map((t) => [t.name, fromJsonSchema(t.inputSchema as JsonSchemaType, validator)]));

const INSTRUCTIONS = `Chrome MCP Agent controls the user's own Google Chrome (their real tabs and logged-in accounts).
Workflow: browser_tabs (list/select or open) -> browser_snapshot -> act with refs from the latest snapshot -> snapshot again to verify.
- Refs look like "e12" (top page) or "f3e7" (inside an iframe); iframes, including cross-origin ones, are part of the snapshot and work like normal elements.
- Every action returns a fresh short page summary; take a new snapshot after navigation or big page changes because refs from older snapshots expire.
- Prefer browser_snapshot over screenshots; use browser_screenshot for visual checks (charts, captchas, layouts).
- Ask the user before purchases, sending messages/emails, deleting data or changing account settings unless they clearly asked for it.
- If a tool says Chrome is not connected, tell the user to open Chrome and click the Chrome MCP Agent icon.`;

function buildServer(env: Env, email: string): McpServer {
  const server = new McpServer({ name: 'chrome-mcp-agent', version: '1.0.0' }, { instructions: INSTRUCTIONS });
  const hub = env.HUB.get(env.HUB.idFromName(email));
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
        const result = await hub.call(tool.name, (args ?? {}) as Record<string, unknown>, tool.timeoutMs);
        return { content: result.content, isError: result.isError };
      },
    );
  }
  return server;
}

/** Serves the MCP endpoint for one authenticated user. */
export async function handleMcp(request: Request, env: Env, email: string): Promise<Response> {
  const handler = createMcpHandler(() => buildServer(env, email), { legacy: 'stateless', responseMode: 'json' });
  return handler.fetch(request);
}
