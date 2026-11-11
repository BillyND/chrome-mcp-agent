// While an agent is recording, each of its successful actions becomes a workflow step.

import { TOOL_BY_NAME } from '../../../../shared/tools';
import { redactDeep } from '../secrets/redact';
import { loadSecrets } from '../secrets/store';
import { ToolError, type Args, type ToolCtx } from '../tools/types';
import { LOCATOR_KEY, mapRefs, stepLabel } from './args';
import { recordLocator } from './locate';
import type { Step } from './store';

export interface Recording {
  name: string;
  description?: string;
  steps: Step[];
  /** Actions that could not be recorded, reported when recording stops. */
  skipped: string[];
}

const recordings = new Map<string, Recording>();

/** Tools that are about the session, not the page: never recorded. */
const NOT_RECORDED = new Set(['browser_tabs', 'browser_windows', 'browser_workflow', 'browser_secrets_list', 'browser_read_more']);

/** Actions, plus waiting (a replay needs it as much as the original run did). */
export function shouldRecord(tool: string): boolean {
  if (NOT_RECORDED.has(tool)) return false;
  return tool === 'browser_wait_for' || TOOL_BY_NAME.get(tool)?.readOnly === false;
}

export function startRecording(agent: string, name: string, description?: string): void {
  if (recordings.has(agent)) throw new ToolError(`Already recording "${recordings.get(agent)!.name}". Call stop_recording first.`);
  recordings.set(agent, { name, description, steps: [], skipped: [] });
}

export function stopRecording(agent: string): Recording {
  const rec = recordings.get(agent);
  if (!rec) throw new ToolError('Not recording. Call start_recording first.');
  recordings.delete(agent);
  return rec;
}

export const currentRecording = (agent: string): Recording | undefined => recordings.get(agent);

/**
 * Called before a tool runs, while its refs still point at live elements. Returns what to call once
 * the tool succeeded (adds the step), or undefined when this call is not recorded.
 */
export async function beginStep(agent: string, tool: string, args: Args, ctx: ToolCtx): Promise<(() => void) | undefined> {
  const rec = recordings.get(agent);
  if (!rec || !shouldRecord(tool)) return undefined;
  const { tabId: _tab, ...rest } = args;
  try {
    const withLocators = (await mapRefs(rest, async (ref) => ({ [LOCATOR_KEY]: await recordLocator(ctx.tabId, ref) }))) as Record<string, unknown>;
    const stored = redactDeep(withLocators, await loadSecrets());
    return () => void rec.steps.push({ tool, args: stored, label: stepLabel(tool, stored) });
  } catch (e) {
    rec.skipped.push(`${tool}: ${(e as Error).message}`);
    return undefined;
  }
}
