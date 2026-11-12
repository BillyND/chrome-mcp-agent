import { createMcpHandler } from '@modelcontextprotocol/server';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/server/validators/cf-worker';
import { toolsServerFactory } from '../../shared/mcp-tools-server';
import { parseProfile } from '../../shared/tools';
import type { Env } from './env';

const makeServer = toolsServerFactory(new CfWorkerJsonSchemaValidator());

/**
 * Serves the MCP endpoint for one authenticated user; `agent` identifies the calling AI client.
 * `?profile=core|full` on the MCP URL picks the tool set (default full).
 */
export async function handleMcp(request: Request, env: Env, device: string, agent?: string): Promise<Response> {
  const hub = env.HUB.get(env.HUB.idFromName(device));
  const profile = parseProfile(new URL(request.url).searchParams.get('profile'));
  const call = async (tool: string, args: Record<string, unknown>, timeoutMs: number, safeToRepeat: boolean) => {
    const result = await hub.call(tool, args, timeoutMs, safeToRepeat, agent);
    const first = result.content[0];
    if (result.isError && first?.type === 'text' && first.text.startsWith('Chrome is not connected')) {
      // The usual cause is a ChatGPT link made with an old code (the extension was reinstalled
      // or disconnected). Name the linked code's tail so the user can compare it with the popup.
      const code = await env.OAUTH_KV.get(`device:${device}`);
      const tail = code && code !== 'dev' ? code.slice(-4) : null;
      if (tail) {
        first.text += ` This connection is linked to the connection code ending in "${tail}". If the Helmsman popup shows a different code, tell the user to remove and re-add the Helmsman connector in ChatGPT and paste the code shown in the popup.`;
      }
    }
    return result;
  };
  const handler = createMcpHandler(() => makeServer(call, profile), {
    legacy: 'stateless',
    responseMode: 'json',
  });
  return handler.fetch(request);
}
