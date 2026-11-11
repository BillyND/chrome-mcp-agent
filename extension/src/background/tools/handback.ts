// browser_request_user: hand the tab to the person for something only they should do (logging in,
// solving a CAPTCHA, entering payment details) and wait until they say they are done.

import { ask } from '../policy/approvals';
import { getSettings } from '../policy/store';
import { hostOf } from '../policy/site-rules';
import { agentLabel } from './agent-id';
import { afterAction } from './page-summary';
import { prepareTab } from './tab';
import { tabTool, ToolError, TrustedError } from './types';

async function bringToFront(tab: chrome.tabs.Tab) {
  await chrome.tabs.update(tab.id!, { active: true });
  if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
}

export const handbackTools = {
  browser_request_user: tabTool(async (args, ctx) => {
    const reason = String(args.reason ?? '').trim().slice(0, 200);
    if (!reason) throw new ToolError('reason is required: tell the user in one sentence what you need them to do.');
    const tab = await prepareTab(ctx, 'Cần bạn giúp');
    await bringToFront(tab);
    const settings = await getSettings();
    const choice = await ask(
      { tabId: tab.id!, kind: 'handback', agent: agentLabel(ctx.agent), host: hostOf(tab.url ?? ''), label: reason },
      ctx.signal,
      settings.handbackTimeoutMs,
    );
    if (choice === 'done') {
      ctx.notes.push('The user says they are done.');
      return afterAction(tab, 'The user finished and handed the page back. Check the result below before continuing.');
    }
    ctx.audit.outcome = 'declined';
    ctx.audit.approval = choice === 'timeout' ? 'timeout' : 'declined';
    throw new TrustedError(
      choice === 'timeout'
        ? `The user did not respond within ${Math.round(settings.handbackTimeoutMs / 60_000)} minutes. Stop and tell the user in chat what you need.`
        : 'The user declined to help with this. Stop this task and ask them in chat how to continue.',
    );
  }),
};
