// Persistent and session state of the background worker, plus the popup snapshot.

import type { ActivityEntry, ConnectionStatus, PopupState } from '../messages';

declare const __GATEWAY_URL__: string;
export const GATEWAY_URL: string = __GATEWAY_URL__;
declare const __LOCAL_PORT__: number;
export const LOCAL_PORT: number = __LOCAL_PORT__;

export interface Account {
  token: string;
  /** Connection code the user pastes into ChatGPT's consent page. */
  code: string;
}

/** The log doubles as the audit trail; the popup shows only the latest few. */
const LOG_LIMIT = 2000;

export const state = {
  status: 'signed-out' as ConnectionStatus,
  /** Until this time, calls fail with the Stop message so the agent ends its current turn. */
  stoppedUntil: 0,
  /** Error code the popup translates (see popup i18n `err_*`). */
  lastError: undefined as string | undefined,
  /** The "Allow AI control" switch is off: every tool call fails until the user turns it back on. Persisted. */
  paused: false,
  /** The gateway asked for the group password on the last connect attempt. */
  needsPassword: false,
  /** Local mode: the extension connects to an MCP server on this machine instead of (or besides) the cloud. */
  local: { enabled: false, status: 'off' as ConnectionStatus },
  /** Raised while a tool runs so long operations can bail out between steps. */
  abort: new AbortController(),
};

const listeners = new Set<() => void>();
export function onStateChange(fn: () => void) {
  listeners.add(fn);
}
export function notify() {
  for (const fn of listeners) fn();
  void chrome.runtime.sendMessage({ type: 'state-changed' }).catch(() => {});
}

export async function getAccount(): Promise<Account | null> {
  const { account } = await chrome.storage.local.get('account');
  return (account as Account | undefined) ?? null;
}

export async function setAccount(account: Account | null): Promise<void> {
  if (account) await chrome.storage.local.set({ account });
  else await chrome.storage.local.remove('account');
}

/** Resolves once the persisted pause flag has been read after a service-worker start. */
// AI control is always on now (Stop ends a task instead); clear any pause saved by older versions.
export const pausedLoaded: Promise<void> = chrome.storage.local.remove('paused').then(() => {
  state.paused = false;
});

/** Resolves once the persisted local-mode flag has been read after a service-worker start. */
// Local mode is always on: the extension quietly waits for a local server on 127.0.0.1.
export const localLoaded: Promise<void> = Promise.resolve().then(() => {
  state.local.enabled = true;
});

export async function setLocalEnabled(enabled: boolean): Promise<void> {
  state.local.enabled = enabled;
  await chrome.storage.local.set({ localMode: enabled });
}

export async function setPaused(paused: boolean): Promise<void> {
  state.paused = paused;
  await chrome.storage.local.set({ paused });
}

export async function getAgentTab(): Promise<number | undefined> {
  const { agentTabId } = await chrome.storage.session.get('agentTabId');
  return agentTabId as number | undefined;
}

export async function setAgentTab(tabId: number | undefined): Promise<void> {
  if (tabId === undefined) await chrome.storage.session.remove('agentTabId');
  else await chrome.storage.session.set({ agentTabId: tabId });
}

// Writes are chained so parallel tool calls never overwrite each other's entries.
let logWrite: Promise<void> = Promise.resolve();

export function logActivity(entry: ActivityEntry): Promise<void> {
  logWrite = logWrite
    .then(async () => {
      const { log } = await chrome.storage.local.get('log');
      const next = [entry, ...((log as ActivityEntry[] | undefined) ?? [])].slice(0, LOG_LIMIT);
      await chrome.storage.local.set({ log: next });
      notify();
    })
    .catch(() => {});
  return logWrite;
}

/** Empties the log (the audit page's "Clear"), in order with pending writes. */
export function clearActivity(): Promise<void> {
  logWrite = logWrite.then(() => chrome.storage.local.remove('log')).then(notify, () => {});
  return logWrite;
}

export async function popupState(): Promise<Omit<PopupState, 'sites' | 'pending' | 'scriptsEverywhere'>> {
  await Promise.all([pausedLoaded, localLoaded]);
  const [account, { log }] = await Promise.all([getAccount(), chrome.storage.local.get('log')]);
  return {
    status: account ? state.status : state.status === 'not-allowed' ? 'not-allowed' : 'signed-out',
    code: account?.code,
    needsPassword: state.needsPassword,
    paused: state.paused,
    gateway: GATEWAY_URL,
    log: ((log as ActivityEntry[] | undefined) ?? []).slice(0, 20),
    lastError: state.lastError,
    local: { enabled: state.local.enabled, status: state.local.status, port: LOCAL_PORT },
  };
}

/** Confirmations waiting for the user: the toolbar badge asks for attention while there are any. */
export function setPendingCount(count: number) {
  pendingCount = count;
  updateBadge();
}
let pendingCount = 0;

/** Toolbar badge: "?" while a question waits for the user, else clear while any relay is connected, otherwise a hint about the cloud account. */
function updateBadge() {
  if (pendingCount > 0) {
    void chrome.action.setBadgeText({ text: '?' });
    void chrome.action.setBadgeBackgroundColor({ color: '#d97706' });
    return;
  }
  const connected = state.status === 'connected' || state.local.status === 'connected';
  const signedOut = state.status === 'signed-out' && !state.local.enabled;
  void chrome.action.setBadgeText({ text: connected ? '' : signedOut ? '!' : '…' });
  void chrome.action.setBadgeBackgroundColor({ color: signedOut || state.status === 'not-allowed' ? '#dc2626' : '#d97706' });
}

export function setStatus(status: ConnectionStatus, error?: string) {
  if (state.status === status && state.lastError === error) return;
  state.status = status;
  state.lastError = error;
  updateBadge();
  notify();
}

export function setLocalStatus(status: ConnectionStatus) {
  if (state.local.status === status) return;
  state.local.status = status;
  updateBadge();
  notify();
}
