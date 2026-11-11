// Helpers shared by the e2e suites.

import type { ToolResult } from './mcp-stdio-client';

let rpcId = 0;

/** Calls a tool through the cloud gateway's dev MCP endpoint, exactly as ChatGPT would. */
export async function cloudCall(gateway: string, device: string, name: string, args: Record<string, unknown> = {}, agent?: string): Promise<ToolResult> {
  const query = new URLSearchParams({ device, ...(agent ? { agent } : {}) });
  const res = await fetch(`${gateway}/dev/mcp?${query}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
  });
  const raw = await res.text();
  const dataLine = raw.split('\n').find((l) => l.startsWith('data: ')) ?? raw;
  const msg = JSON.parse(dataLine.replace(/^data: /, ''));
  if (msg.error) throw new Error(`${name}: ${JSON.stringify(msg.error)}`);
  const result = msg.result as Omit<ToolResult, 'text'>;
  const text = result.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  return { ...result, text };
}

/** Finds the ref of the first snapshot line containing `label` (and optionally a role). */
export function refOf(snapshot: string, label: string, role?: string): string {
  const line = snapshot.split('\n').find((l) => l.includes(label) && /\[ref=/.test(l) && (!role || l.includes(`- ${role}`)));
  const m = line && /ref=(f?\d*e\d+)/.exec(line);
  if (!m) throw new Error(`No ref for ${role ?? ''} "${label}" in snapshot:\n${snapshot}`);
  return m[1];
}

/** The text a tool returned without the untrusted-content envelope (and the notice before it), for tests that parse the payload. */
export const unwrapUntrusted = (text: string): string =>
  text.replace(/^[\s\S]*?<untrusted_page_content>\n/, '').replace(/\n<\/untrusted_page_content>\s*$/, '');
