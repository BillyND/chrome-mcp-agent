import { createMcpHandler, fromJsonSchema, McpServer, type JsonSchemaType } from '@modelcontextprotocol/server';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/server/validators/cf-worker';
import { TOOLS } from '../../shared/tools';
import type { Env } from './env';

const validator = new CfWorkerJsonSchemaValidator();
const schemas = new Map(TOOLS.map((t) => [t.name, fromJsonSchema(t.inputSchema as JsonSchemaType, validator)]));

const INSTRUCTIONS = `Helmsman controls the user's own Google Chrome (their real tabs and logged-in accounts).
Workflow: browser_tabs (list, or "new" for a tab of your own) -> browser_snapshot -> act with refs from the latest snapshot -> snapshot again to verify.
- Refs look like "e12" (top page) or "f3e7" (inside an iframe); iframes, including cross-origin ones, are part of the snapshot and work like normal elements.
- Every action returns a fresh short page summary; take a new snapshot after navigation or big page changes because refs from older snapshots expire.
- Prefer browser_snapshot over screenshots; use browser_screenshot for visual checks (charts, captchas, layouts). Use browser_find for a quick text lookup and browser_extract for links, tables, forms and metadata.
Several tabs and several agents:
- Several AI agents can use the same Chrome at once. Each has its own default tab and its own Chrome tab group (titled with the agent's name and a colour); never touch a tab another agent is using unless the user asked.
- Calls that omit tabId act on your default tab. Pass tabId (from browser_tabs or a result's "Tab N" line) to work in a specific tab; browser_tabs "new" opens another tab of your own in the background.
- Calls on different tabs run in parallel, so to go faster open several tabs and send independent calls at the same time; calls on the same tab run one after another in the order sent.
- Every result says which tab it acted on. Tabs are not brought to the front: the page does not need to be visible for clicks, typing and screenshots to work.
- Ask the user before purchases, sending messages/emails, deleting data or changing account settings unless they clearly asked for it. Cookies and history are the user's private data: read or change them only when the task needs it.
- If a tool says Chrome is not connected, tell the user to open Chrome and click the Helmsman icon.`;

function buildServer(env: Env, device: string, agent?: string): McpServer {
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
        const result = await hub.call(tool.name, input, tool.timeoutMs, safeToRepeat, agent);
        return { content: result.content, isError: result.isError };
      },
    );
  }
  return server;
}

/** Serves the MCP endpoint for one authenticated user; `agent` identifies the calling AI client. */
export async function handleMcp(request: Request, env: Env, device: string, agent?: string): Promise<Response> {
  const handler = createMcpHandler(() => buildServer(env, device, agent), { legacy: 'stateless', responseMode: 'json' });
  return handler.fetch(request);
}
