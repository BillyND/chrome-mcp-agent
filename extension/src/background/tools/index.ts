// Tool registry and the entry point the service worker calls for every tool call.
//
// Scheduling: calls on different tabs run in parallel (up to MAX_PARALLEL at once);
// calls on the same tab run one after another in arrival order, so mouse and keyboard
// input on a tab never interleave. Calls without a tab queue per agent.

import type { ToolContent } from '../../../../shared/protocol';
import { pausedLoaded, state } from '../state';
import { DEFAULT_AGENT } from './agent-id';
import { browserDataTools } from './browser-data';
import { captureTools } from './capture';
import { devtoolsLogTools } from './devtools-logs';
import { dialogFileTools } from './dialogs-files';
import { emulationTools } from './emulation';
import { formTools } from './forms';
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
};

export const TOOL_NAMES = Object.keys(TOOLS);

const scheduler = new Scheduler(MAX_PARALLEL);

const failure = (message: string) => ({ content: text(message), isError: true as const });

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  agent: string = DEFAULT_AGENT,
): Promise<{ content: ToolContent[]; isError?: boolean }> {
  await pausedLoaded;
  if (state.paused) return failure(STOPPED);
  const spec = TOOLS[name];
  if (!spec) return failure(`Unknown tool ${name}.`);

  // Pressing Stop drops every call still waiting its turn; the running ones notice at their next step.
  const signal = state.abort.signal;
  const onStop = () => scheduler.cancelPending(new ToolError(STOPPED));
  signal.addEventListener('abort', onStop, { once: true });
  try {
    const input = (args ?? {}) as Args;
    const ctx: ToolCtx = { agent, tabId: -1, signal };
    let lane = `agent:${agent}`;
    if (spec.scope === 'tab') {
      const tab = await resolveTab(agent, input.tabId);
      ctx.tabId = tab.id!;
      lane = `tab:${tab.id}`;
    }
    const content = await scheduler.run(lane, () => {
      if (state.paused || signal.aborted) throw new ToolError(STOPPED);
      return spec.run(input, ctx);
    });
    return { content };
  } catch (e) {
    return failure(e instanceof Error ? e.message : String(e));
  } finally {
    signal.removeEventListener('abort', onStop);
  }
}
