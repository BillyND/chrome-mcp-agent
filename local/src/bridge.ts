// Connects this process to the browser extension, sharing one extension
// connection between every local MCP process on the machine.
//
// The first process to bind 127.0.0.1:<port> becomes the "hub": the extension
// connects to it and it runs calls through the shared relay. Any other process
// finds the port taken and connects to the hub as a "peer" (path /peer), which
// forwards its calls over that socket. If the hub exits, a peer takes over.

import http from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { PING, PROTOCOL } from '../../shared/protocol';
import { type CallResult, type CallRequest, encodeCall, parseExtensionMessage, Relay, type RelayLink } from '../../shared/relay';

/** A link calls go out on: the extension itself (hub) or the hub process (peer). */
interface Wire extends RelayLink {
  peer: boolean;
}

/** Peer -> hub: run this call and answer with a `result` message carrying the same id. */
interface PeerCall extends CallRequest {
  type: 'relay';
  id: string;
}

/** The hub answers a peer this long before the peer's own timer, so the hub's error text wins. */
const PEER_SLACK_MS = 3000;
const RETRY_MS = 1000;

const NOT_CONNECTED =
  'Chrome is not connected to the local server. Ask the user to open Chrome, click the Helmsman icon and turn on "Local mode".';

export interface Bridge {
  call(tool: string, args: Record<string, unknown>, timeoutMs: number, safeToRepeat: boolean, agent: string): Promise<CallResult>;
  close(): void;
}

export interface BridgeOptions {
  port: number;
  /** Only this extension id may connect (default: any chrome-extension:// origin). */
  extensionId?: string;
  log: (line: string) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function startBridge({ port, extensionId, log }: BridgeOptions): Bridge {
  let wire: Wire | undefined;
  let hub: http.Server | undefined;
  let peerSocket: WebSocket | undefined;
  let closed = false;

  const relay = new Relay<Wire>({
    current: () => wire,
    notConnected: NOT_CONNECTED,
    encode: (id, req, link) =>
      link.peer
        ? JSON.stringify({ ...req, type: 'relay', id, timeoutMs: Math.max(1000, req.timeoutMs - PEER_SLACK_MS) } satisfies PeerCall)
        : encodeCall(id, req),
  });

  // ---- hub role --------------------------------------------------------------

  const originAllowed = (origin: string | undefined, path: string): boolean => {
    // Browsers always send Origin; only the extension may connect on `/`, and no web page may reach `/peer`.
    if (path === '/peer') return origin === undefined;
    if (!origin?.startsWith('chrome-extension://')) return false;
    return !extensionId || origin === `chrome-extension://${extensionId}`;
  };

  /** Blocks DNS rebinding: the Host header must name the loopback address we bound. */
  const hostAllowed = (host: string | undefined) => host === `127.0.0.1:${port}` || host === `localhost:${port}`;

  function acceptExtension(ws: WebSocket) {
    const old = wire;
    const mine: Wire = { peer: false, send: (d) => ws.send(d) };
    wire = mine;
    if (old) {
      for (const other of wss.clients) if (other !== ws && !isPeer.has(other)) other.close(4000, 'Replaced by a newer connection');
      relay.lost(old, 'replaced');
    }
    log('extension connected');
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const text = data.toString();
      if (text === PING) return void ws.send('pong');
      const msg = parseExtensionMessage(text);
      if (msg) relay.receive(msg);
    });
    ws.on('close', () => {
      relay.lost(mine, 'dropped');
      if (wire === mine) wire = undefined;
      log('extension disconnected');
    });
    relay.connected();
  }

  function acceptPeer(ws: WebSocket) {
    ws.on('message', async (data) => {
      let msg: PeerCall;
      try {
        msg = JSON.parse(data.toString()) as PeerCall;
      } catch {
        return;
      }
      if (msg.type !== 'relay') return;
      const result = await relay.call(msg.tool, msg.args, msg.timeoutMs, msg.safeToRepeat, msg.agent);
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'result', id: msg.id, content: result.content, isError: result.isError }));
    });
  }

  const isPeer = new WeakSet<WebSocket>();
  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => (protocols.has(PROTOCOL) ? PROTOCOL : false),
  });

  function listen(): Promise<boolean> {
    return new Promise((resolve) => {
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' }).end('Helmsman local server\n');
      });
      server.on('upgrade', (req, socket: Duplex, head) => {
        const path = new URL(req.url ?? '/', 'http://x').pathname;
        if (!hostAllowed(req.headers.host) || !originAllowed(req.headers.origin, path)) {
          socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          if (path === '/peer') {
            isPeer.add(ws);
            acceptPeer(ws);
          } else acceptExtension(ws);
        });
      });
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code !== 'EADDRINUSE') log(`cannot listen on 127.0.0.1:${port}: ${err.message}`);
        resolve(false);
      });
      server.listen(port, '127.0.0.1', () => {
        server.on('error', (err) => log(`server error: ${err.message}`));
        hub = server;
        resolve(true);
      });
    });
  }

  // ---- peer role -------------------------------------------------------------

  /** Connects to the hub; resolves when that connection ends (or never came up). */
  function runPeer(): Promise<void> {
    return new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/peer`, PROTOCOL);
      peerSocket = ws;
      const mine: Wire = { peer: true, send: (d) => ws.send(d) };
      ws.on('open', () => {
        wire = mine;
        log(`joined the local server on port ${port}`);
        relay.connected();
      });
      ws.on('message', (data) => {
        const msg = parseExtensionMessage(data.toString());
        if (msg) relay.receive(msg);
      });
      ws.on('error', () => {});
      ws.on('close', () => {
        if (wire === mine) wire = undefined;
        relay.lost(mine, 'dropped');
        resolve();
      });
    });
  }

  void (async () => {
    while (!closed) {
      if (await listen()) {
        log(`listening on 127.0.0.1:${port}`);
        return;
      }
      await runPeer();
      await sleep(RETRY_MS);
    }
  })();

  return {
    call: (tool, args, timeoutMs, safeToRepeat, agent) => relay.call(tool, args, timeoutMs, safeToRepeat, agent),
    close() {
      closed = true;
      peerSocket?.terminate();
      hub?.close();
      for (const ws of wss.clients) ws.terminate();
    },
  };
}
