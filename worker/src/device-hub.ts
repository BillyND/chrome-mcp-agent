// One Durable Object per user. It holds that user's extension WebSocket (with
// the Hibernation API, so an idle connection costs nothing) and relays tool
// calls from the MCP endpoint to it.

import { DurableObject } from 'cloudflare:workers';
import type { HubToExtension } from '../../shared/protocol';
import { PROTOCOL } from '../../shared/protocol';
import { type CallResult, errorResult, parseExtensionMessage, Relay } from '../../shared/relay';
import type { Env } from './env';
import { isActiveDevice } from './pairing';

export const DISCONNECTED = 'This Chrome was disconnected from Helmsman. Tell the user to reconnect: click the Helmsman icon in Chrome, press Connect, then remove and re-add the Helmsman connector with the new code.';

export type { CallResult };

interface SocketInfo {
  device: string;
  connectedAt: number;
  version?: string;
  userAgent?: string;
}

export class DeviceHub extends DurableObject<Env> {
  private relay = new Relay<WebSocket>({
    current: () => this.socket(),
    notConnected:
      'Chrome is not connected. Ask the user to open Chrome and check that the Helmsman extension shows "Connected" (click its icon and sign in if needed).',
  });

  /**
   * Whether this Chrome is registered. Only a "yes" is remembered, so KV is read once per object
   * lifetime instead of on every MCP request, while a "no" (a fresh registration KV has not spread yet,
   * or a disconnected Chrome) is checked again next time. forget() clears it the moment the user disconnects.
   */
  private active = false;

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
    this.relay.connected();
    // Closing a socket from this side fires no close event here, so hand over its calls now.
    for (const ws of old) this.relay.lost(ws, 'replaced');
    return new Response(null, { status: 101, webSocket: pair[0], headers: { 'Sec-WebSocket-Protocol': PROTOCOL } });
  }

  status(): { connected: boolean; info?: SocketInfo } {
    const ws = this.socket();
    return ws ? { connected: true, info: ws.deserializeAttachment() as SocketInfo } : { connected: false };
  }

  private socket(): WebSocket | undefined {
    return this.ctx.getWebSockets().find((ws) => ws.readyState === WebSocket.OPEN);
  }

  private async isActive(device: string): Promise<boolean> {
    if (!this.active) this.active = await isActiveDevice(this.env, device);
    return this.active;
  }

  /** RPC from the MCP endpoint: run one tool in the user's Chrome. */
  async call(device: string, tool: string, args: Record<string, unknown>, timeoutMs: number, readOnly = false, agent?: string): Promise<CallResult> {
    if (!(await this.isActive(device))) return errorResult(DISCONNECTED);
    return this.relay.call(tool, args, timeoutMs, readOnly, agent);
  }

  /** RPC when the user disconnects this Chrome: later calls are refused at once and the extension's socket closes. */
  forget(): void {
    this.active = false;
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(4001, 'Disconnected');
      } catch {
        /* already closed */
      }
      this.relay.lost(ws, 'dropped');
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const msg = parseExtensionMessage(message);
    if (!msg) return;
    if (msg.type === 'status') {
      const info = ws.deserializeAttachment() as SocketInfo;
      ws.serializeAttachment({ ...info, version: msg.version, userAgent: msg.userAgent });
      return;
    }
    this.relay.receive(msg);
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    this.relay.lost(ws, code === 4000 ? 'replaced' : 'dropped');
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
