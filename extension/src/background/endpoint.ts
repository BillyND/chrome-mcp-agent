// One WebSocket to a relay (the cloud gateway or the local MCP server), kept
// open for as long as it is wanted:
// - heartbeat every 20s (also keeps the MV3 service worker alive),
// - backoff with jitter on failure,
// - results larger than one message are sent in chunks.
// What differs between relays (where to connect, whether we may, how long to
// wait between retries) is supplied by an EndpointConfig.

import {
  CHUNK_SIZE,
  type ExtensionToHub,
  type HubToExtension,
  PING,
  PING_INTERVAL_MS,
} from '../../../shared/protocol';
import type { ConnectionStatus } from '../messages';

const PONG_TIMEOUT_MS = 10_000;

export type CallMessage = Extract<HubToExtension, { type: 'call' }>;

export interface EndpointConfig {
  /** Resolves the socket to open, or the status to show instead when connecting is not possible or wanted. */
  open(failures: number): Promise<{ url: string; protocols: string[] } | { status: ConnectionStatus; error?: string }>;
  /** Milliseconds to wait before the next attempt after `failures` consecutive failures. */
  retryMs(failures: number): number;
  setStatus(status: ConnectionStatus, error?: string): void;
  /** Current status, so a replaced endpoint stays quiet until the user asks again. */
  status(): ConnectionStatus;
}

export class Endpoint {
  private ws: WebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private pongTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;
  private onCall: ((msg: CallMessage) => void) | null = null;

  constructor(private cfg: EndpointConfig) {}

  /** Handler for calls arriving on this endpoint; answer with this endpoint's `send`. */
  onToolCall(handler: (msg: CallMessage) => void) {
    this.onCall = handler;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private cleanup() {
    clearInterval(this.heartbeat);
    clearTimeout(this.pongTimer);
    this.heartbeat = undefined;
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }

  private scheduleRetry() {
    clearTimeout(this.retryTimer);
    this.failures++;
    this.retryTimer = setTimeout(() => void this.connect(), this.cfg.retryMs(this.failures));
  }

  async connect(): Promise<void> {
    clearTimeout(this.retryTimer);
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    if (this.cfg.status() === 'replaced') return;
    const target = await this.cfg.open(this.failures);
    if ('status' in target) {
      this.cfg.setStatus(target.status, target.error);
      return;
    }
    this.cfg.setStatus('connecting');
    this.cleanup();
    const socket = new WebSocket(target.url, target.protocols);
    this.ws = socket;

    socket.onopen = () => {
      this.failures = 0;
      this.cfg.setStatus('connected');
      this.send({ type: 'status', version: chrome.runtime.getManifest().version, userAgent: navigator.userAgent });
      this.heartbeat = setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN) return;
        socket.send(PING);
        clearTimeout(this.pongTimer);
        this.pongTimer = setTimeout(() => {
          // No pong: the connection is dead even if the socket still looks open.
          this.cleanup();
          this.cfg.setStatus('connecting');
          this.scheduleRetry();
        }, PONG_TIMEOUT_MS);
      }, PING_INTERVAL_MS);
    };

    socket.onmessage = (event) => {
      const data = typeof event.data === 'string' ? event.data : '';
      if (data === 'pong') {
        clearTimeout(this.pongTimer);
        return;
      }
      let msg: HubToExtension;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (msg.type === 'call') this.onCall?.(msg);
    };

    socket.onclose = (event) => {
      if (this.ws !== socket) return;
      this.cleanup();
      if (event.code === 4000) {
        this.cfg.setStatus('replaced', 'replaced');
        return;
      }
      this.cfg.setStatus('connecting');
      this.scheduleRetry();
    };

    socket.onerror = () => {
      /* onclose follows and handles retry */
    };
  }

  send = (msg: ExtensionToHub): void => {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const raw = JSON.stringify(msg);
    if (raw.length <= CHUNK_SIZE || msg.type !== 'result') {
      ws.send(raw);
      return;
    }
    const total = Math.ceil(raw.length / CHUNK_SIZE);
    for (let i = 0; i < total; i++) {
      ws.send(JSON.stringify({ type: 'chunk', id: msg.id, index: i, total, data: raw.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE) } satisfies ExtensionToHub));
    }
  };

  disconnect() {
    clearTimeout(this.retryTimer);
    this.cleanup();
  }

  /** The user asked ("Use this Chrome", a settings change, the network is back): start over now. */
  async reconnectNow() {
    this.failures = 0;
    if (this.cfg.status() === 'replaced') this.cfg.setStatus('connecting');
    this.disconnect();
    await this.connect();
  }
}
