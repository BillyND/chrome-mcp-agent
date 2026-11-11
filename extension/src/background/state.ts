// Persistent and session state of the background worker, plus the popup snapshot.

import type { ActivityEntry, ConnectionStatus, PopupState } from '../messages';

declare const __GATEWAY_URL__: string;
export const GATEWAY_URL: string = __GATEWAY_URL__;

export interface Account {
  token: string;
  /** Connection code the user pastes into ChatGPT's consent page. */
  code: string;
}

const LOG_LIMIT = 60;

export const state = {
  status: 'signed-out' as ConnectionStatus,
  /** Error code the popup translates (see popup i18n `err_*`). */
  lastError: undefined as string | undefined,
  /** The "Allow AI control" switch is off: every tool call fails until the user turns it back on. Persisted. */
  paused: false,
  /** The gateway asked for the group password on the last connect attempt. */
  needsPassword: false,
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
export const pausedLoaded: Promise<void> = chrome.storage.local.get('paused').then(({ paused }) => {
  state.paused = paused === true;
});

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

export async function logActivity(entry: ActivityEntry): Promise<void> {
  const { log } = await chrome.storage.local.get('log');
  const next = [entry, ...((log as ActivityEntry[] | undefined) ?? [])].slice(0, LOG_LIMIT);
  await chrome.storage.local.set({ log: next });
  notify();
}

export async function popupState(): Promise<PopupState> {
  await pausedLoaded;
  const [account, { log }] = await Promise.all([getAccount(), chrome.storage.local.get('log')]);
  return {
    status: account ? state.status : state.status === 'not-allowed' ? 'not-allowed' : 'signed-out',
    code: account?.code,
    needsPassword: state.needsPassword,
    paused: state.paused,
    gateway: GATEWAY_URL,
    log: ((log as ActivityEntry[] | undefined) ?? []).slice(0, 20),
    lastError: state.lastError,
  };
}

export function setStatus(status: ConnectionStatus, error?: string) {
  if (state.status === status && state.lastError === error) return;
  state.status = status;
  state.lastError = error;
  void chrome.action.setBadgeText({ text: status === 'connected' ? '' : status === 'signed-out' ? '!' : '…' });
  void chrome.action.setBadgeBackgroundColor({ color: status === 'signed-out' || status === 'not-allowed' ? '#dc2626' : '#d97706' });
  notify();
}
