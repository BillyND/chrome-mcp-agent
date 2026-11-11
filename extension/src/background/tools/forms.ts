// Form tools: fill many fields at once, choose <select> options.

import { frameCall } from '../frames';
import { clickTarget, fillTarget } from './input';
import { locate } from './locate';
import { afterAction } from './page-summary';
import { glide } from './overlay';
import { prepareTab } from './tab';
import { checkAbort, sleep, tabTool, type Args } from './types';

export const formTools = {
  browser_fill_form: tabTool(async (args, ctx) => {
    const tab = await prepareTab(ctx, 'Điền form');
    const tabId = tab.id!;
    const done: string[] = [];
    for (const field of (args.fields ?? []) as Args[]) {
      checkAbort(ctx);
      const t = await locate(tabId, field.ref);
      await glide(tabId, t.x, t.y);
      const value = field.value;
      const isToggle = t.prep.inputType === 'checkbox' || t.prep.inputType === 'radio' || t.prep.checked !== undefined;
      if (t.prep.tag === 'select') {
        const values = Array.isArray(value) ? value.map(String) : [String(value)];
        done.push(await frameCall<string>(tabId, t.frameId, { cmd: 'select-option', ref: t.local, values }));
      } else if (isToggle) {
        const want = value === true || value === 'true' || value === 'on' || value === 'yes';
        if (t.prep.checked !== want) await clickTarget(tabId, t);
        done.push(`${t.prep.label} → ${want ? 'checked' : 'unchecked'}`);
      } else {
        const str = Array.isArray(value) ? value.join(', ') : String(value);
        await fillTarget(tabId, t, str, ctx);
        done.push(`${t.prep.label} = ${JSON.stringify(str.slice(0, 60))}`);
      }
      await sleep(60);
    }
    return afterAction(tab, `Filled ${done.length} field(s):\n${done.map((d) => `- ${d}`).join('\n')}`);
  }),

  browser_select_option: tabTool(async (args, ctx) => {
    const tab = await prepareTab(ctx, `Chọn ${args.values?.join(', ')}`);
    const t = await locate(tab.id!, args.ref);
    await glide(tab.id!, t.x, t.y);
    const res = await frameCall<string>(tab.id!, t.frameId, { cmd: 'select-option', ref: t.local, values: (args.values ?? []).map(String) });
    return afterAction(tab, `${res} in ${t.prep.label}.`);
  }),
};
