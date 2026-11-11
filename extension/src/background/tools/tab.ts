// Choosing, validating and describing the tab a call works on.

import { attach, sessionOf } from '../cdp';
import { adopt, defaultTabOf, ownerLabel, ownerOf, withClaimLock } from './agents';
import { showAgentBar } from './overlay';
import { checkAbort, sleep, ToolError, type ToolCtx } from './types';

const isWeb = (t?: chrome.tabs.Tab) => !!t && /^(https?|file):/.test(t.url ?? t.pendingUrl ?? '');

const getTab = (tabId: number) => chrome.tabs.get(tabId).catch(() => null);

/** Opens a tab for the agent (in the background, in its tab group) and makes it the agent's default. Call inside the claim lock. */
export async function openAgentTab(agent: string, url = 'about:blank', windowId?: number): Promise<chrome.tabs.Tab> {
  const tab = await chrome.tabs.create({ url, active: false, windowId });
  await adopt(agent, tab, true);
  return tab;
}

/**
 * Picks the tab a call acts on: the one it names, else the agent's own default tab, else
 * the active tab when nobody else owns it, else a fresh tab.
 */
export async function resolveTab(agent: string, tabId?: number): Promise<chrome.tabs.Tab> {
  return withClaimLock(async () => {
    if (tabId !== undefined) {
      const tab = await getTab(tabId);
      if (!tab) throw new ToolError(`Tab ${tabId} does not exist. Call browser_tabs with action "list".`);
      if (ownerOf(tabId) === undefined) await adopt(agent, tab, defaultTabOf(agent) === undefined);
      return tab;
    }
    const own = defaultTabOf(agent);
    const ownTab = own === undefined ? null : await getTab(own);
    if (ownTab) return ownTab;
    const free = (t?: chrome.tabs.Tab) => isWeb(t) && t!.id !== undefined && ownerOf(t!.id) === undefined;
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const recent = (await chrome.tabs.query({})).filter(free).sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
    const pick = free(active) ? active : recent;
    if (pick) {
      await adopt(agent, pick, true);
      return pick;
    }
    return openAgentTab(agent);
  });
}

/** The tab a running call was scheduled on, as it is right now. */
export async function liveTab(ctx: ToolCtx): Promise<chrome.tabs.Tab> {
  const tab = await getTab(ctx.tabId);
  if (!tab) throw new ToolError(`Tab ${ctx.tabId} was closed. Call browser_tabs with action "list".`);
  return tab;
}

export function assertScriptable(tab: chrome.tabs.Tab) {
  const url = tab.url ?? tab.pendingUrl ?? '';
  if ((/^(chrome|edge|about|devtools|chrome-extension|view-source):/.test(url) && url !== 'about:blank') ||
      /^https:\/\/chrome(webstore)?\.google\.com\/webstore/.test(url)) {
    throw new ToolError(`Chrome does not let extensions control ${url}. Navigate the tab to a normal website first (browser_navigate).`);
  }
}

export async function waitForLoad(tabId: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // Give a click-triggered navigation a moment to start.
  await sleep(150);
  while (Date.now() < deadline) {
    const tab = await getTab(tabId);
    if (!tab || tab.status === 'complete') return;
    await sleep(200);
  }
}

/** "Tab 12 (ChatGPT)": names the tab and the agent that owns it, so a result says where it acted. */
export function tabTag(tabId: number): string {
  const owner = ownerLabel(tabId);
  return `Tab ${tabId}${owner ? ` (${owner})` : ''}`;
}

/** Title and URL of the tab (plus an open dialog), the first lines of most results. */
export async function pageHeader(tab: chrome.tabs.Tab): Promise<string> {
  const fresh = (await getTab(tab.id!)) ?? tab;
  const dialog = sessionOf(tab.id!)?.dialog;
  const lines = [`${tabTag(tab.id!)}: ${fresh.title ?? ''}`, `URL: ${fresh.url ?? ''}`];
  if (dialog) {
    lines.push(`⚠ A ${dialog.type} dialog is open: "${dialog.message}". Use browser_handle_dialog before anything else.`);
  }
  return lines.join('\n');
}

/**
 * Starts a tab-scoped action: checks Stop, makes sure the tab is scriptable and attached,
 * refuses to act under an open dialog, and shows the agent bar.
 */
export async function prepareTab(ctx: ToolCtx, label: string): Promise<chrome.tabs.Tab> {
  checkAbort(ctx);
  const tab = await liveTab(ctx);
  assertScriptable(tab);
  await attach(tab.id!);
  const dialog = sessionOf(tab.id!)?.dialog;
  if (dialog && label !== 'handle_dialog') {
    throw new ToolError(`A ${dialog.type} dialog is open: "${dialog.message}". Call browser_handle_dialog first.`);
  }
  await showAgentBar(tab.id!, label);
  return tab;
}
