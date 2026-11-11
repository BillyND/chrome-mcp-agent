// A minimal MCP client over stdio, the way Claude Desktop / Cursor / Claude Code
// drive the local server: spawn the bundle, then newline-delimited JSON-RPC.

import { type ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';

export interface ToolResult {
  content: Array<{ type: string; text?: string; data?: string }>;
  isError?: boolean;
  text: string;
}

export class StdioMcpClient {
  private child: ChildProcess;
  private nextId = 0;
  private waiting = new Map<number, (msg: { result?: unknown; error?: unknown }) => void>();
  private buffer = '';
  stderr = '';
  exited: Promise<void>;

  constructor(
    readonly name: string,
    port: number,
    bundle = path.resolve('local/helmsman-mcp.mjs'),
  ) {
    this.child = spawn(process.execPath, [bundle], { env: { ...process.env, HELMSMAN_PORT: String(port) }, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr!.on('data', (d) => (this.stderr += d));
    this.child.stdout!.on('data', (d) => {
      this.buffer += d;
      let nl: number;
      while ((nl = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, nl);
        this.buffer = this.buffer.slice(nl + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        this.waiting.get(msg.id)?.(msg);
        this.waiting.delete(msg.id);
      }
    });
    this.exited = new Promise((resolve) => this.child.once('exit', () => resolve()));
  }

  private request(method: string, params?: unknown): Promise<unknown> {
    const id = ++this.nextId;
    this.child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return new Promise((resolve, reject) =>
      this.waiting.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${JSON.stringify(msg.error)}`)) : resolve(msg.result))),
    );
  }

  async initialize(): Promise<{ serverInfo: { name: string }; instructions?: string }> {
    const result = (await this.request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: this.name, version: '1.0.0' },
    })) as { serverInfo: { name: string }; instructions?: string };
    this.child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    return result;
  }

  async listTools(): Promise<Array<{ name: string }>> {
    return ((await this.request('tools/list')) as { tools: Array<{ name: string }> }).tools;
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    const result = (await this.request('tools/call', { name, arguments: args })) as Omit<ToolResult, 'text'>;
    return { ...result, text: result.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n') };
  }

  /** Ends the process the way a client quitting does: closing its stdin. */
  async close(): Promise<void> {
    this.child.stdin!.end();
    await Promise.race([this.exited, new Promise((r) => setTimeout(r, 3000))]);
    this.child.kill();
  }

  kill(): Promise<void> {
    this.child.kill('SIGKILL');
    return this.exited;
  }
}
