// Reads a tab and renders the snapshot for one agent: the single path used by browser_snapshot
// and by the snapshot every action appends.

import { DEFAULT_AGENT } from '../tools/agent-id';
import { composeSnapshot, type ComposeOptions } from './compose';
import { renderSnapshot, type Rendered, type SnapshotMode } from './render';
import { runningAgent } from './session';

export interface CaptureOptions extends ComposeOptions {
  mode: SnapshotMode;
  /** Characters of snapshot text to show at most. */
  cap: number;
}

export async function captureSnapshot(agent: string, tabId: number, opts: CaptureOptions): Promise<Rendered> {
  const full = await composeSnapshot(tabId, opts);
  const url = (await chrome.tabs.get(tabId).catch(() => null))?.url ?? '';
  const view = `${opts.ref ?? ''}|${opts.depth ?? ''}|${opts.interactiveOnly ? 'interactive' : ''}`;
  return renderSnapshot({ agent, tabId, url, view }, full, opts.mode, opts.cap);
}

/** The agent whose call is running on this tab right now (actions do not carry it down to afterAction). */
export const agentOnTab = (tabId: number): string => runningAgent(tabId) ?? DEFAULT_AGENT;
