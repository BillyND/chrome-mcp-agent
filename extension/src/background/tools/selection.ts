// Text selection and a per-agent clipboard. The clipboard lives in the extension, so one agent's
// copy never overwrites another's, and pasting works without any clipboard permission.

import { send } from '../cdp';
import { callAllFrames, frameCall, parseRef } from '../frames';
import { guardTyping } from '../policy/guard';
import { fillTarget, typeText } from './input';
import { locate } from './locate';
import { afterAction } from './page-summary';
import { glide } from './overlay';
import { prepareTab, tabTag } from './tab';
import { tabTool, text, ToolError } from './types';

const clipboards = new Map<string, string>();

async function currentSelection(tabId: number): Promise<string> {
  const answers = await callAllFrames<string>(tabId, () => ({ cmd: 'get-selection' }), 3000);
  return answers.map((a) => a.value).find((v) => v.length > 0) ?? '';
}

export const selectionTools = {
  browser_select_text: tabTool(async (args, ctx) => {
    const tab = await prepareTab(ctx, 'Chọn văn bản');
    const scoped = args.ref ? parseRef(args.ref) : undefined;
    let selected: string;
    if (scoped) {
      selected = await frameCall<string>(tab.id!, scoped.frameId, { cmd: 'select-text', ref: scoped.local, text: args.text });
    } else {
      // Without a ref the text can be in any frame: take the first that contains it.
      const answers = await callAllFrames<string | null>(tab.id!, () => ({ cmd: 'select-text', text: args.text }));
      selected = answers.map((a) => a.value).find(Boolean) ?? '';
      if (!selected) throw new ToolError(`"${args.text}" was not found on the page.`);
    }
    return text(`${tabTag(tab.id!)}: selected ${selected.length} character(s):\n${selected.slice(0, 2000)}${selected.length > 2000 ? '\n…' : ''}\n\nUse browser_clipboard with action "copy" to keep it.`);
  }),

  browser_clipboard: tabTool(async (args, ctx) => {
    const tab = await prepareTab(ctx, 'Clipboard');
    const tabId = tab.id!;
    const action = String(args.action ?? 'read');
    if (action === 'copy') {
      const selected = args.text ? String(args.text) : await currentSelection(tabId);
      if (!selected) throw new ToolError('Nothing is selected. Use browser_select_text first, or pass text.');
      clipboards.set(ctx.agent, selected);
      // Also offer it to the system clipboard when the page is allowed to (best effort).
      await send(tabId, 'Runtime.evaluate', { expression: `navigator.clipboard?.writeText(${JSON.stringify(selected)}).catch(()=>{})`, userGesture: true }).catch(() => {});
      return text(`${tabTag(tabId)}: copied ${selected.length} character(s) to your clipboard.`);
    }
    if (action === 'paste') {
      const value = args.text !== undefined ? String(args.text) : clipboards.get(ctx.agent);
      if (value === undefined) throw new ToolError('Your clipboard is empty. Use action "copy" first or pass text.');
      await guardTyping(ctx, tabId, args.ref ? String(args.ref) : undefined, value);
      if (args.ref) {
        const t = await locate(tabId, String(args.ref));
        await glide(tabId, t.x, t.y);
        await fillTarget(tabId, t, value, ctx, { clear: false });
      } else {
        await typeText(tabId, value, false, ctx);
      }
      return afterAction(tab, `Pasted ${value.length} character(s).`);
    }
    return text(`${tabTag(tabId)}: your clipboard holds ${clipboards.get(ctx.agent)?.length ?? 0} character(s):\n${clipboards.get(ctx.agent) ?? ''}`);
  }),
};
