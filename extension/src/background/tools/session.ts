// browser_done: the agent says it has finished, so its cursor and bar go away and Chrome's
// "is debugging" bar closes now instead of after the idle timeouts.

import { detach } from '../cdp';
import { tabsOf } from './agents';
import { hideAgentBar } from './overlay';
import { freeTool, text } from './types';

export const sessionTools = {
  browser_done: freeTool(async (_args, ctx) => {
    const tabs = await tabsOf(ctx.agent);
    await Promise.all(tabs.map(async (tabId) => {
      await hideAgentBar(tabId);
      await detach(tabId);
    }));
    return text(`Finished: released ${tabs.length} tab${tabs.length === 1 ? '' : 's'}. They stay open for the user; any later browser call starts again.`);
  }),
};
