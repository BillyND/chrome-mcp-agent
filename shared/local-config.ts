// How an MCP client starts the local Helmsman server. npx runs the tarball the gateway serves, so no npm
// registry is involved. Shared by the extension popup and the gateway's setup guide.

export const DEFAULT_LOCAL_PORT = 47821;

interface StdioServer {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export function localServer(gateway: string, port = DEFAULT_LOCAL_PORT): StdioServer {
  const entry: StdioServer = { command: 'npx', args: ['-y', `--package=${gateway}/helmsman-mcp.tgz`, 'helmsman-mcp'] };
  if (port !== DEFAULT_LOCAL_PORT) entry.env = { HELMSMAN_PORT: String(port) };
  return entry;
}

/** The command line, for clients configured with "<name> -- <command>" (Claude Code, Codex, VS Code). */
export const localCommand = (gateway: string): string => ['npx', ...localServer(gateway).args].join(' ');

/** `mcpServers` config (Claude Desktop, Cursor); the port only appears when it is not the default. `indent` pretty-prints it. */
export const localSnippet = (gateway: string, port = DEFAULT_LOCAL_PORT, indent?: number): string =>
  JSON.stringify({ mcpServers: { helmsman: localServer(gateway, port) } }, null, indent);
