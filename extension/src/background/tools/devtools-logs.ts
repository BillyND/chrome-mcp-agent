// What the page logged and requested since the agent attached to it.

import { sessionOf } from '../cdp';
import { prepareTab, tabTag } from './tab';
import { tabTool, text } from './types';

const LAST = 150;

export const devtoolsLogTools = {
  browser_console_messages: tabTool(async (args, ctx) => {
    const tab = await prepareTab(ctx, 'Đọc console');
    const entries = (sessionOf(tab.id!)?.console ?? []).filter((e) => !args.onlyErrors || e.level === 'error');
    if (!entries.length) return text(`${tabTag(tab.id!)}: no console messages captured yet (capturing starts when the agent first controls the tab).`);
    return text(`${tabTag(tab.id!)}:\n${entries.slice(-LAST).map((e) => `[${e.level}] ${e.text}${e.url ? ` (${e.url})` : ''}`).join('\n')}`);
  }),

  browser_network_requests: tabTool(async (args, ctx) => {
    const tab = await prepareTab(ctx, 'Đọc network');
    const filter = args.filter ? String(args.filter) : '';
    const entries = [...(sessionOf(tab.id!)?.network.values() ?? [])].filter((e) => !filter || e.url.includes(filter));
    if (!entries.length) return text(`${tabTag(tab.id!)}: no network requests captured yet (capturing starts when the agent first controls the tab).`);
    return text(`${tabTag(tab.id!)}:\n${entries.slice(-LAST).map((e) => `${e.method} ${e.status ?? (e.failed ? `FAILED ${e.failed}` : '…')} ${e.type ?? ''} ${e.url.slice(0, 300)}`).join('\n')}`);
  }),
};
