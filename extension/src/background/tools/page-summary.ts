// The short "what the page looks like now" tail appended to action results.

import type { ToolContent } from '../../../../shared/protocol';
import { sessionOf } from '../cdp';
import { agentOnTab, captureSnapshot } from '../snapshot/capture';
import { pageHeader, waitForLoad } from './tab';
import { text } from './types';

/** Waits for any navigation the action started, then reports the page header and a fresh snapshot. */
export async function afterAction(tab: chrome.tabs.Tab, summary: string, snapshotChars = 12_000): Promise<ToolContent[]> {
  await waitForLoad(tab.id!, 10_000);
  const header = await pageHeader(tab);
  if (sessionOf(tab.id!)?.dialog) return text(`${summary}\n\n${header}`);
  // Once the agent has a snapshot of this tab, only what changed since then is worth sending.
  const snap = await captureSnapshot(agentOnTab(tab.id!), tab.id!, { mode: 'auto', cap: snapshotChars }).then(
    (r) => `${r.title}:\n${r.text}`,
    (e: Error) => `Page snapshot:\n(snapshot unavailable: ${e.message})`,
  );
  return text(`${summary}\n\n${header}\n\n${snap}`);
}
