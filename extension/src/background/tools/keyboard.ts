// Keyboard tools: type text (into a field or the focused element) and press shortcuts.

import { guardKey, guardTyping } from '../policy/guard';
import { fillTarget, pressKey, typeText } from './input';
import { locate } from './locate';
import { afterAction } from './page-summary';
import { glide } from './overlay';
import { prepareTab } from './tab';
import { checkAbort, sleep, tabTool } from './types';

const preview = (value: unknown) => JSON.stringify(String(value ?? '').slice(0, 80));

export const keyboardTools = {
  browser_type: tabTool(async (args, ctx) => {
    const value = String(args.text ?? '');
    const submitted = args.submit ? ' and pressed Enter' : '';
    if (!args.ref) {
      // Canvas apps (Google Sheets, Docs, Figma) take keys on a hidden focused element.
      const tab = await prepareTab(ctx, 'Gõ phím');
      await guardTyping(ctx, tab.id!, undefined, value, !!args.submit);
      await typeText(tab.id!, value, !!args.slowly, ctx);
      if (args.submit) await pressKey(tab.id!, 'Enter');
      await sleep(200);
      return afterAction(tab, `Typed ${preview(value)} into the focused element${submitted}.`);
    }
    const tab = await prepareTab(ctx, `Gõ vào ${args.element ?? args.ref}`);
    const t = await locate(tab.id!, args.ref);
    await guardTyping(ctx, tab.id!, args.ref, value, !!args.submit);
    await glide(tab.id!, t.x, t.y);
    checkAbort(ctx);
    await fillTarget(tab.id!, t, value, ctx, { clear: args.clear !== false, slowly: !!args.slowly, strict: true });
    if (args.submit) await pressKey(tab.id!, 'Enter');
    await sleep(150);
    return afterAction(tab, `Typed ${preview(value)} into ${t.prep.label}${submitted}.`);
  }),

  browser_press_key: tabTool(async (args, ctx) => {
    const tab = await prepareTab(ctx, `Nhấn ${args.key}`);
    await guardKey(ctx, tab.id!, String(args.key));
    await pressKey(tab.id!, String(args.key));
    await sleep(200);
    return afterAction(tab, `Pressed ${args.key}.`);
  }),
};
