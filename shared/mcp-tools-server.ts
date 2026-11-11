// Builds the MCP server that advertises the browser tools. Shared by the cloud
// gateway (Worker) and the local stdio server; each supplies only how a call
// reaches Chrome.

import { fromJsonSchema, McpServer, type JsonSchemaType } from '@modelcontextprotocol/server';
import type { CallResult } from './relay';
import { TOOLS } from './tools';

/** Runs one tool in the user's Chrome. `safeToRepeat` marks calls that may be sent twice without side effects. */
export type ToolCaller = (tool: string, args: Record<string, unknown>, timeoutMs: number, safeToRepeat: boolean) => Promise<CallResult>;

export const INSTRUCTIONS = `Chrome MCP Agent controls the user's own Google Chrome (their real tabs and logged-in accounts).
Workflow: browser_tabs (list/select or open) -> browser_snapshot -> act with refs from the latest snapshot -> snapshot again to verify.
- Refs look like "e12" (top page) or "f3e7" (inside an iframe); iframes, including cross-origin ones, are part of the snapshot and work like normal elements.
- Every action returns a fresh short page summary; take a new snapshot after navigation or big page changes because refs from older snapshots expire.
- Prefer browser_snapshot over screenshots; use browser_screenshot for visual checks (charts, captchas, layouts).
- Ask the user before purchases, sending messages/emails, deleting data or changing account settings unless they clearly asked for it.
- If a tool says Chrome is not connected, tell the user to open Chrome and click the Chrome MCP Agent icon.`;

/** Pass the runtime's JSON Schema validator (Workers cannot use the default one); schemas are compiled once. */
export function toolsServerFactory(validator?: Parameters<typeof fromJsonSchema>[1]) {
  const schemas = new Map(TOOLS.map((t) => [t.name, fromJsonSchema(t.inputSchema as JsonSchemaType, validator)]));

  return (call: ToolCaller): McpServer => {
    const server = new McpServer({ name: 'chrome-mcp-agent', version: '1.0.0' }, { instructions: INSTRUCTIONS });
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
          const result = await call(tool.name, input, tool.timeoutMs, safeToRepeat);
          return { content: result.content, isError: result.isError };
        },
      );
    }
    return server;
  };
}
