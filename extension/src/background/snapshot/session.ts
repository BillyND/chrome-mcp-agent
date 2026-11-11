// Browser-side bookkeeping for snapshot baselines: which agent is running on a tab, and when a
// tab's baselines stop being valid.

import { baselines } from './baselines';

/** Tab-scoped calls on one tab never overlap, so the agent running on a tab is unambiguous while it runs. */
const running = new Map<number, string>();
export const setRunningAgent = (tabId: number, agent: string) => void running.set(tabId, agent);
export const runningAgent = (tabId: number): string | undefined => running.get(tabId);

chrome.tabs.onRemoved.addListener((tabId) => {
  baselines.clearTab(tabId);
  running.delete(tabId);
});
// A new document means old lines no longer describe the page.
chrome.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId === 0) baselines.clearTab(d.tabId);
});
