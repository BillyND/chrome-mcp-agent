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
  const handler = createMcpHandler(() => makeServer((tool, args, timeoutMs, safeToRepeat) => hub.call(tool, args, timeoutMs, safeToRepeat, agent), profile), {
    legacy: 'stateless',
    responseMode: 'json',
  });
  return handler.fetch(request);
}
