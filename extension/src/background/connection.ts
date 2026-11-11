// The two relays the extension can talk to, both built from the same Endpoint:
// - cloud: the gateway, needs the connection-code account, backs off up to 15s;
// - local: an MCP server on this machine, only while the user turned "Local mode" on,
//   retries quietly every few seconds and needs no account.

import { AUTH_PROTOCOL_PREFIX, PROTOCOL } from '../../../shared/protocol';
import { type CallMessage, Endpoint } from './endpoint';
import { GATEWAY_URL, getAccount, LOCAL_PORT, localLoaded, setAccount, setLocalEnabled, setLocalStatus, setStatus, state } from './state';

const MAX_BACKOFF_MS = 15_000;
const LOCAL_RETRY_MS = 3_000;

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

export const cloud = new Endpoint({
  async open(failures) {
    const account = await getAccount();
    if (!account) return { status: 'signed-out' };
    if (!navigator.onLine) return { status: 'offline', error: 'offline' };
    if (failures >= 3 && failures % 3 === 0 && (await tokenRejected(account.token)) === 'invalid') {
      await setAccount(null);
      return { status: 'signed-out', error: 'revoked' };
    }
    return { url: `${GATEWAY_URL.replace(/^http/, 'ws')}/ext/ws`, protocols: [PROTOCOL, AUTH_PROTOCOL_PREFIX + account.token] };
  },
  retryMs: (failures) => Math.round(Math.min(MAX_BACKOFF_MS, 500 * 2 ** Math.min(failures, 6)) * (0.7 + Math.random() * 0.6)),
  setStatus,
  status: () => state.status,
});

export const local = new Endpoint({
  async open() {
    await localLoaded;
    if (!state.local.enabled) return { status: 'off' };
    return { url: `ws://127.0.0.1:${LOCAL_PORT}`, protocols: [PROTOCOL] };
  },
  retryMs: () => LOCAL_RETRY_MS,
  setStatus: setLocalStatus,
  status: () => state.local.status,
});

/** Both endpoints deliver calls to one handler, together with the endpoint to answer on. */
export function onToolCall(handler: (msg: CallMessage, endpoint: Endpoint) => void) {
  cloud.onToolCall((msg) => handler(msg, cloud));
  local.onToolCall((msg) => handler(msg, local));
}

export async function setLocalMode(enabled: boolean) {
  await setLocalEnabled(enabled);
  if (enabled) await local.reconnectNow();
  else {
    local.disconnect();
    setLocalStatus('off');
  }
}
