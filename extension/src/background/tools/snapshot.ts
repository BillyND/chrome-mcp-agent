// browser_snapshot: the page as an accessibility tree with refs, whole or scoped, full or as a diff.

import { limitFor } from '../output/limit';
import { captureSnapshot } from '../snapshot/capture';
import { pageHeader, prepareTab } from './tab';
import { tabTool, text } from './types';

/** Room for the title line and a note next to the snapshot inside the output budget. */
const TITLE_SLACK = 220;

export const snapshotTools = {
  browser_snapshot: tabTool(async (args, ctx) => {
    const tab = await prepareTab(ctx, 'Đọc trang');
    const header = await pageHeader(tab);
    const cap = Math.max(500, limitFor(args) - header.length - TITLE_SLACK);
    const snap = await captureSnapshot(ctx.agent, tab.id!, {
      mode: args.mode === 'diff' ? 'diff' : 'full',
      cap,
      ref: args.ref ? String(args.ref) : undefined,
      depth: args.depth === undefined ? undefined : Math.max(0, Number(args.depth)),
      interactiveOnly: !!args.interactiveOnly,
    });
    return text(`${header}\n\n${snap.title}:\n${snap.text}`);
  }),
};
