// browser_navigate: open a URL, go back/forward or reload.

import { attach } from '../cdp';
import { afterAction } from './page-summary';
import { showAgentBar } from './overlay';
import { liveTab, pageHeader, waitForLoad } from './tab';
import { checkAbort, tabTool, text, ToolError } from './types';

export const navigationTools = {
  browser_navigate: tabTool(async (args, ctx) => {
    checkAbort(ctx);
    const tab = await liveTab(ctx);
    const action = (args.action as string) ?? 'goto';
    await showAgentBar(tab.id!, action === 'goto' ? `Mở ${args.url}` : action).catch(() => {});
    if (action === 'back') await chrome.tabs.goBack(tab.id!).catch(() => { throw new ToolError('There is no previous page.'); });
    else if (action === 'forward') await chrome.tabs.goForward(tab.id!).catch(() => { throw new ToolError('There is no next page.'); });
    else if (action === 'reload') await chrome.tabs.reload(tab.id!);
    else {
      if (!args.url) throw new ToolError('url is required.');
      let url = String(args.url).trim();
      if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
      await chrome.tabs.update(tab.id!, { url });
    }
    await waitForLoad(tab.id!, 40_000);
    const fresh = await chrome.tabs.get(tab.id!);
    if (/^(chrome|edge):/.test(fresh.url ?? '')) return text(await pageHeader(fresh));
    await attach(tab.id!);
    await showAgentBar(tab.id!, 'Đã mở trang');
    return afterAction(fresh, `Navigated (${action}).`, 20_000);
  }),
};
