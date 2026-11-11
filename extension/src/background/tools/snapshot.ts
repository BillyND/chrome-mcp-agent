// browser_snapshot: the page as an accessibility tree with refs.

import { composeSnapshot } from './page-summary';
import { pageHeader, prepareTab } from './tab';
import { tabTool, text } from './types';

export const snapshotTools = {
  browser_snapshot: tabTool(async (args, ctx) => {
    const tab = await prepareTab(ctx, 'Đọc trang');
    const snap = await composeSnapshot(tab.id!, args.maxChars ?? 60_000);
    return text(`${await pageHeader(tab)}\n\nPage snapshot:\n${snap}`);
  }),
};
