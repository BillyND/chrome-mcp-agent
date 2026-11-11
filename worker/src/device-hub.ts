// One Durable Object per user. It holds that user's extension WebSocket (with
// the Hibernation API, so an idle connection costs nothing) and relays tool
// calls from the MCP endpoint to it.

import { DurableObject } from 'cloudflare:workers';
import type { ExtensionToHub, HubToExtension, ToolContent } from '../../shared/protocol';
import { PROTOCOL } from '../../shared/protocol';
import type { Env } from './env';

/** How long a tool call waits for the extension to (re)connect before failing. */
const CONNECT_GRACE_MS = 20_000;

export interface CallResult {
  content: ToolContent[];
  isError?: boolean;
}

interface Pending {
  ws: WebSocket;
  tool: string;
  args: Record<string, unknown>;
  /** Read-only calls are safe to send again when the socket they went out on dies. */
  retryable: boolean;
  resolve: (r: CallResult) => void;
  timer: ReturnType<typeof setTimeout>;
  chunks?: string[];
}

interface SocketInfo {
  device: string;
  connectedAt: number;
  version?: string;
  userAgent?: string;
}

const errorResult = (text: string): CallResult => ({ content: [{ type: 'text', text }], isError: true });

export class DeviceHub extends DurableObject<Env> {
  private pending = new Map<string, Pending>();
  private connectWaiters: Array<() => void> = [];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answered by the runtime without waking the object: keeps the extension's
    // service worker alive and the connection warm at zero cost.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/connect') return this.acceptExtension(request);
    if (url.pathname === '/status') return Response.json(this.status());
    return new Response('Not found', { status: 404 });
  }

  private acceptExtension(request: Request): Response {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    const device = request.headers.get('x-cma-device') ?? '';
    // One live Chrome per user: the newest connection wins.
    const old = this.ctx.getWebSockets();
    for (const ws of old) {
      try {
        ws.close(4000, 'Replaced by a newer connection');
      } catch {
        /* already closed */
      }
    }
    const pair = new WebSocketPair();
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    const info: SocketInfo = { device, connectedAt: Date.now() };
    server.serializeAttachment(info);
    server.send(JSON.stringify({ type: 'hello' } satisfies HubToExtension));
    const waiters = this.connectWaiters;
    this.connectWaiters = [];
    waiters.forEach((w) => w());
    // Closing a socket from this side fires no close event here, so hand over its calls now.
    for (const ws of old) this.orphan(ws, 4000);
    return new Response(null, { status: 101, webSocket: pair[0], headers: { 'Sec-WebSocket-Protocol': PROTOCOL } });
  }

  status(): { connected: boolean; info?: SocketInfo } {
    const ws = this.socket();
    return ws ? { connected: true, info: ws.deserializeAttachment() as SocketInfo } : { connected: false };
  }

  private socket(): WebSocket | undefined {
    return this.ctx.getWebSockets().find((ws) => ws.readyState === WebSocket.OPEN);
  }

  private waitForSocket(ms: number): Promise<WebSocket | undefined> {
    const now = this.socket();
    if (now) return Promise.resolve(now);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.connectWaiters = this.connectWaiters.filter((w) => w !== done);
        resolve(undefined);
      }, ms);
      const done = () => {
        clearTimeout(timer);
        resolve(this.socket());
      };
      this.connectWaiters.push(done);
    });
  }

  /** RPC from the MCP endpoint: run one tool in the user's Chrome. */
  async call(tool: string, args: Record<string, unknown>, timeoutMs: number, readOnly = false): Promise<CallResult> {
    const ws = await this.waitForSocket(CONNECT_GRACE_MS);
    if (!ws) {
      return errorResult(
        'Chrome is not connected. Ask the user to open Chrome and check that the Helmsman extension shows "Connected" (click its icon and sign in if needed).',
      );
    }
    const id = crypto.randomUUID();
    return new Promise<CallResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(errorResult(`The browser did not finish "${tool}" within ${Math.round(timeoutMs / 1000)}s. Take a snapshot to see the current state.`));
      }, timeoutMs);
      this.pending.set(id, { ws, tool, args, retryable: readOnly, resolve, timer });
      this.dispatch(id, ws);
    });
  }

  private dispatch(id: string, ws: WebSocket): void {
    const p = this.pending.get(id);
    if (!p) return;
    p.ws = ws;
    p.chunks = undefined;
    try {
      ws.send(JSON.stringify({ type: 'call', id, tool: p.tool, args: p.args } satisfies HubToExtension));
    } catch {
      this.orphan(ws, 1011);
    }
  }

  /** Calls in flight on a dead socket: resend read-only ones once Chrome is back, fail the rest. */
  private orphan(ws: WebSocket, code: number): void {
    for (const [id, p] of this.pending) {
      if (p.ws !== ws) continue;
      if (p.retryable) {
        p.retryable = false; // at most one resend
        void this.waitForSocket(CONNECT_GRACE_MS).then((next) => {
          if (next && next !== ws) this.dispatch(id, next);
          else this.settle(id, errorResult('Lost the connection to Chrome. Try again in a moment.'));
        });
        continue;
      }
      this.settle(id, errorResult(
        code === 4000
          ? 'The command was interrupted because Chrome reconnected. Take a snapshot to check whether it completed.'
          : 'The connection to Chrome dropped while the command was running. Take a snapshot to check whether it completed.',
      ));
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    let msg: ExtensionToHub;
    try {
      msg = JSON.parse(message) as ExtensionToHub;
    } catch {
      return;
    }
    if (msg.type === 'status') {
      const info = ws.deserializeAttachment() as SocketInfo;
      ws.serializeAttachment({ ...info, version: msg.version, userAgent: msg.userAgent });
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    if (msg.type === 'chunk') {
      p.chunks ??= new Array<string>(msg.total);
      p.chunks[msg.index] = msg.data;
      if (p.chunks.filter((c) => c !== undefined).length < msg.total) return;
      this.settle(msg.id, JSON.parse(p.chunks.join('')) as CallResult);
      return;
    }
    this.settle(msg.id, { content: msg.content, isError: msg.isError });
  }

  private settle(id: string, result: CallResult): void {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
    p.resolve(result);
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    this.orphan(ws, code);
    try {
      ws.close(1000, 'closed');
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws, 1011);
  }
}
