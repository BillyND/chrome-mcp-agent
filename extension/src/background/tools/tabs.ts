// browser_tabs: list, open, select and close tabs. Every agent works in its own tab group.

import { adopt, defaultTabOf, ownerLabel, withClaimLock } from './agents';
import { openAgentTab, pageHeader, waitForLoad } from './tab';
import { freeTool, text, ToolError } from './types';

async function bringToFront(tab: chrome.tabs.Tab) {
  await chrome.tabs.update(tab.id!, { active: true });
  if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
}

async function groupTitles(): Promise<Map<number, string>> {
  const groups = chrome.tabGroups ? await chrome.tabGroups.query({}).catch(() => []) : [];
  return new Map(groups.map((g) => [g.id, g.title ?? '']));
}

export const tabsTools = {
  browser_tabs: freeTool(async (args, ctx) => {
    const action = args.action as string;
    if (action === 'new') {
      const tab = await withClaimLock(() => openAgentTab(ctx.agent, args.url || 'about:blank'));
      if (args.activate) await bringToFront(tab);
      if (args.url) await waitForLoad(tab.id!, 30_000);
      return text(`Opened tab ${tab.id}${args.url ? ` at ${args.url}` : ''} in your tab group. It is now your default tab.\n\n${await pageHeader(tab)}`);
    }
    if (action === 'select') {
      if (args.tabId === undefined) throw new ToolError('tabId is required for "select".');
      const tab = await chrome.tabs.get(args.tabId).catch(() => null);
      if (!tab) throw new ToolError(`Tab ${args.tabId} does not exist. Call browser_tabs with action "list".`);
      await withClaimLock(() => adopt(ctx.agent, tab, true));
      if (args.activate) await bringToFront(tab);
      return text(`Tab ${args.tabId} is now your default tab.\n\n${await pageHeader(tab)}`);
    }
    if (action === 'close') {
      if (args.tabId === undefined) throw new ToolError('tabId is required for "close".');
      await chrome.tabs.remove(args.tabId);
      return text(`Closed tab ${args.tabId}.`);
    }
    const mine = defaultTabOf(ctx.agent);
    const titles = await groupTitles();
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
    const lines: string[] = [];
    for (const w of windows) {
      lines.push(`Window ${w.id}${w.focused ? ' (focused)' : ''}:`);
      for (const t of w.tabs ?? []) {
        const owner = ownerLabel(t.id!);
        const group = t.groupId !== -1 ? titles.get(t.groupId) : undefined;
        const flags = [
          t.active && 'active',
          t.id === mine && 'YOUR DEFAULT TAB',
          owner && t.id !== mine && `used by ${owner}`,
          group && `group "${group}"`,
          t.audible && 'playing audio',
          t.discarded && 'sleeping',
        ].filter(Boolean).join(', ');
        lines.push(`  - [${t.id}] ${t.title ?? ''} — ${t.url ?? ''}${flags ? ` (${flags})` : ''}`);
      }
    }
    return text(`${lines.join('\n')}\n\nPass tabId to any tool to work in a specific tab; calls on different tabs run in parallel. Use action "new" to open a tab of your own.`);
  }),
};
