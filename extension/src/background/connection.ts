// Keeps one WebSocket to the gateway open for as long as Chrome runs:
// - heartbeat every 20s (also keeps the MV3 service worker alive),
// - exponential backoff with jitter on failure, instant retry when the network returns,
// - an alarm that revives the connection if Chrome ever suspended the worker.

import {
  AUTH_PROTOCOL_PREFIX,
  CHUNK_SIZE,
  type ExtensionToHub,
  type HubToExtension,
  PING,
  PING_INTERVAL_MS,
  PROTOCOL,
} from '../../../shared/protocol';
import { GATEWAY_URL, getAccount, isEnabled, setAccount, setStatus, state } from './state';

const PONG_TIMEOUT_MS = 10_000;
const MAX_BACKOFF_MS = 15_000;

let ws: WebSocket | null = null;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let pongTimer: ReturnType<typeof setTimeout> | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let failures = 0;
let onCall: ((msg: Extract<HubToExtension, { type: 'call' }>) => void) | null = null;

export function onToolCall(handler: typeof onCall) {
  onCall = handler;
}

const wsUrl = () => `${GATEWAY_URL.replace(/^http/, 'ws')}/ext/ws`;

function cleanup() {
  clearInterval(heartbeat);
  clearTimeout(pongTimer);
  heartbeat = undefined;
  if (ws) {
    ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }
  ws = null;
}

export function isConnected(): boolean {
  return ws?.readyState === WebSocket.OPEN;
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  failures++;
  const base = Math.min(MAX_BACKOFF_MS, 500 * 2 ** Math.min(failures, 6));
  const delay = Math.round(base * (0.7 + Math.random() * 0.6));
  retryTimer = setTimeout(() => void connect(), delay);
}

/** After several failed attempts, ask the gateway whether the token itself is the problem. */
async function tokenRejected(token: string): Promise<'ok' | 'invalid' | 'unreachable'> {
  try {
    const res = await fetch(`${GATEWAY_URL}/ext/whoami`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401 || res.status === 403) return 'invalid';
    return res.ok ? 'ok' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}

export async function connect(): Promise<void> {
  clearTimeout(retryTimer);
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const account = await getAccount();
  if (!account) {
    setStatus('signed-out');
    return;
  }
  if (!(await isEnabled())) {
    setStatus('offline', 'disabled');
    return;
  }
  if (state.status === 'replaced') return;
  if (!navigator.onLine) {
    setStatus('offline', 'offline');
    return;
  }
  if (failures >= 3 && failures % 3 === 0) {
    const verdict = await tokenRejected(account.token);
    if (verdict === 'invalid') {
      await setAccount(null);
      setStatus('signed-out', 'revoked');
      return;
    }
  }
  setStatus('connecting');
  cleanup();
  const socket = new WebSocket(wsUrl(), [PROTOCOL, AUTH_PROTOCOL_PREFIX + account.token]);
  ws = socket;

  socket.onopen = () => {
    failures = 0;
    setStatus('connected');
    send({ type: 'status', version: chrome.runtime.getManifest().version, userAgent: navigator.userAgent });
    heartbeat = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(PING);
      clearTimeout(pongTimer);
      pongTimer = setTimeout(() => {
        // No pong: the connection is dead even if the socket still looks open.
        cleanup();
        setStatus('connecting');
        scheduleRetry();
      }, PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);
  };

  socket.onmessage = (event) => {
    const data = typeof event.data === 'string' ? event.data : '';
    if (data === 'pong') {
      clearTimeout(pongTimer);
      return;
    }
    let msg: HubToExtension;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.type === 'call') onCall?.(msg);
  };

  socket.onclose = (event) => {
    if (ws !== socket) return;
    cleanup();
    if (event.code === 4000) {
      setStatus('replaced', 'replaced');
      return;
    }
    setStatus(navigator.onLine ? 'connecting' : 'offline');
    scheduleRetry();
  };

  socket.onerror = () => {
    /* onclose follows and handles retry */
  };
}

export function send(msg: ExtensionToHub): void {
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
}

export function disconnect() {
  clearTimeout(retryTimer);
  cleanup();
}

/** Called by the user ("Dùng Chrome này") or when settings change. */
export async function reconnectNow() {
  failures = 0;
  if (state.status === 'replaced') setStatus('connecting');
  disconnect();
  await connect();
}
