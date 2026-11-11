// browser_wait_for: wait for time, text, a selector or the network to settle.

import { waitNetworkIdle } from '../cdp';
import { callAllFrames } from '../frames';
import { afterAction } from './page-summary';
import { prepareTab } from './tab';
import { checkAbort, sleep, tabTool, ToolError } from './types';

export const waitTools = {
  browser_wait_for: tabTool(async (args, ctx) => {
    const tab = await prepareTab(ctx, 'Đang chờ');
    const tabId = tab.id!;
    const conditions: Array<{ describe: string; met: () => Promise<boolean> }> = [];
    const anyFrame = async (request: Parameters<typeof callAllFrames<boolean>>[1]) =>
      (await callAllFrames<boolean>(tabId, request, 3000)).some((a) => a.value);
    if (args.text) conditions.push({ describe: `"${args.text}" to appear`, met: () => anyFrame(() => ({ cmd: 'has-text', text: String(args.text) })) });
    if (args.textGone) conditions.push({ describe: `"${args.textGone}" to disappear`, met: async () => !(await anyFrame(() => ({ cmd: 'has-text', text: String(args.textGone) }))) });
    if (args.selector) conditions.push({ describe: `selector ${args.selector} to appear`, met: () => anyFrame(() => ({ cmd: 'has-selector', selector: String(args.selector), visible: true })) });
    if (args.selectorGone) conditions.push({ describe: `selector ${args.selectorGone} to disappear`, met: async () => !(await anyFrame(() => ({ cmd: 'has-selector', selector: String(args.selectorGone), visible: false }))) });

    if (args.time) {
      const ms = Math.min(Number(args.time), 30) * 1000;
      for (let waited = 0; waited < ms; waited += 250) {
        checkAbort(ctx);
        await sleep(250);
      }
      if (!conditions.length && !args.networkIdle) return afterAction(tab, `Waited ${args.time}s.`);
    }

    const timeoutMs = Math.min(Number(args.timeout ?? 20), 50) * 1000;
    const deadline = Date.now() + timeoutMs;
    const timedOut = () => new ToolError(`Timed out after ${timeoutMs / 1000}s waiting for ${conditions.map((c) => c.describe).concat(args.networkIdle ? ['the network to go idle'] : []).join(' and ')}.`);
    const allMet = async () => (await Promise.all(conditions.map((c) => c.met()))).every(Boolean);
    while (conditions.length && !(await allMet())) {
      checkAbort(ctx);
      if (Date.now() >= deadline) throw timedOut();
      await sleep(400);
    }
    if (args.networkIdle && !(await waitNetworkIdle(tabId, 500, Math.max(1000, deadline - Date.now()), () => checkAbort(ctx)))) throw timedOut();
    const what = conditions.map((c) => c.describe.replace(' to appear', ' is on the page').replace(' to disappear', ' is gone')).concat(args.networkIdle ? ['network is idle'] : []);
    return afterAction(tab, `${what.join('; ')}.`);
  }),
};
