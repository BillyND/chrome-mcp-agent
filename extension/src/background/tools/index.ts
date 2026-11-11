// Tool registry and the entry point the service worker calls for every tool call.
//
// Scheduling: calls on different tabs run in parallel (up to MAX_PARALLEL at once);
// calls on the same tab run one after another in arrival order, so mouse and keyboard
// input on a tab never interleave. Calls without a tab queue per agent.

import type { ToolContent } from '../../../../shared/protocol';
import { finish, failureText, siteGate } from '../policy/guard';
import { targetUrlsOf } from '../policy/site-rules';
import type { ActivityEntry } from '../../messages';
import { pausedLoaded, state } from '../state';
import { DEFAULT_AGENT } from './agent-id';
import { browserDataTools } from './browser-data';
import { captureTools } from './capture';
import { devtoolsLogTools } from './devtools-logs';
import { dialogFileTools } from './dialogs-files';
import { emulationTools } from './emulation';
import { formTools } from './forms';
import { handbackTools } from './handback';
import { keyboardTools } from './keyboard';
import { mouseTools } from './mouse';
import { navigationTools } from './navigation';
import { pageDataTools } from './page-data';
import { Scheduler } from './scheduler';
import { selectionTools } from './selection';
import { snapshotTools } from './snapshot';
import { tabsTools } from './tabs';
import { resolveTab } from './tab';
import { STOPPED, text, ToolError, type Args, type ToolCtx, type ToolSpec } from './types';
import { waitTools } from './wait';

export { showAgentBar } from './overlay';

const MAX_PARALLEL = 6;

const TOOLS: Record<string, ToolSpec> = {
  ...tabsTools,
  ...navigationTools,
  ...snapshotTools,
  ...mouseTools,
  ...keyboardTools,
  ...formTools,
  ...captureTools,
  ...pageDataTools,
  ...waitTools,
  ...selectionTools,
  ...dialogFileTools,
  ...devtoolsLogTools,
  ...emulationTools,
  ...browserDataTools,
  ...handbackTools,
};

export const TOOL_NAMES = Object.keys(TOOLS);

const scheduler = new Scheduler(MAX_PARALLEL);

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
  /** What the safety layer saw, for the audit log. */
  audit: Pick<ActivityEntry, 'host' | 'outcome' | 'approval'>;
}

const failure = (message: string, audit: ToolResult['audit'] = {}): ToolResult => ({ content: text(message), isError: true, audit: { outcome: 'error', ...audit } });

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  agent: string = DEFAULT_AGENT,
): Promise<ToolResult> {
  await pausedLoaded;
  if (state.paused) return failure(STOPPED);
  const spec = TOOLS[name];
  if (!spec) return failure(`Unknown tool ${name}.`);

  // Pressing Stop drops every call still waiting its turn; the running ones notice at their next step.
  const signal = state.abort.signal;
  const onStop = () => scheduler.cancelPending(new ToolError(STOPPED));
  signal.addEventListener('abort', onStop, { once: true });
  const ctx: ToolCtx = { agent, tabId: -1, signal, audit: {}, notes: [] };
  try {
    const input = (args ?? {}) as Args;
    let lane = `agent:${agent}`;
    if (spec.scope === 'tab') {
      const tab = await resolveTab(agent, input.tabId);
      ctx.tabId = tab.id!;
      lane = `tab:${tab.id}`;
    }
    const targets = targetUrlsOf(name, input);
    const content = await scheduler.run(lane, async () => {
      if (state.paused || signal.aborted) throw new ToolError(STOPPED);
      // Site rules come first: nothing touches the tab, or opens a target URL, before they pass.
      // A tab sitting on a blocked site may still be navigated away.
      const tab = ctx.tabId >= 0 && !(name === 'browser_navigate' && targets.length) ? await chrome.tabs.get(ctx.tabId).catch(() => null) : null;
      if (tab?.url) await siteGate(ctx, tab.url);
      for (const url of targets) await siteGate(ctx, url);
      return finish(ctx, name, await spec.run(input, ctx));
    });
    return { content, audit: { outcome: 'ok', ...ctx.audit } };
  } catch (e) {
    return failure(failureText(e), ctx.audit);
  } finally {
    signal.removeEventListener('abort', onStop);
  }
}
