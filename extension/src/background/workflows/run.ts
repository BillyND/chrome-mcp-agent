// Replaying a saved workflow: fill parameters, find each element again, run the step, stop at the first failure.

import type { ToolContent } from '../../../../shared/protocol';
import { checkAbort, text, ToolError, type Args, type ToolCtx } from '../tools/types';
import { resolveTab } from '../tools/tab';
import { applyParams, hasLocator, resolveLocators } from './args';
import { resolveLocator } from './locate';
import type { Step, Workflow } from './store';

/** Runs one tool call the way an agent's call runs, but never records it. */
export type StepRunner = (tool: string, args: Args, agent: string) => Promise<{ content: ToolContent[]; isError?: boolean }>;

const firstText = (content: ToolContent[]) => content.find((c) => c.type === 'text')?.text ?? '';

/** Parameter values for a run: the recorded defaults overridden by what the caller gave. */
export function runValues(wf: Workflow, given: Record<string, unknown> = {}): Record<string, string> {
  const unknown = Object.keys(given).filter((k) => !Object.hasOwn(wf.params, k));
  if (unknown.length) throw new ToolError(`Unknown parameter ${unknown.map((u) => `"${u}"`).join(', ')}. This workflow has: ${Object.keys(wf.params).join(', ') || 'no parameters'}.`);
  return { ...wf.params, ...Object.fromEntries(Object.entries(given).map(([k, v]) => [k, String(v)])) };
}

async function runStep(step: Step, values: Record<string, string>, agent: string, run: StepRunner, ctx: ToolCtx) {
  const args = applyParams(step.args, values);
  let concrete = args as Args;
  if (hasLocator(args)) {
    const tabId = (await resolveTab(agent)).id!;
    concrete = (await resolveLocators(args, (loc) => resolveLocator(tabId, loc, ctx))) as Args;
  }
  const result = await run(step.tool, concrete, agent);
  if (result.isError) throw new ToolError(firstText(result.content));
  return result.content;
}

export async function runWorkflow(wf: Workflow, given: Record<string, unknown> | undefined, agent: string, run: StepRunner, ctx: ToolCtx): Promise<ToolContent[]> {
  const values = runValues(wf, given);
  const done: string[] = [];
  let last: ToolContent[] = [];
  for (const [i, step] of wf.steps.entries()) {
    checkAbort(ctx);
    try {
      last = await runStep(step, values, agent, run, ctx);
    } catch (e) {
      const completed = done.length ? `Completed: ${done.join('; ')}.` : 'No step completed.';
      throw new ToolError(`Workflow "${wf.name}" stopped at step ${i + 1} of ${wf.steps.length} (${step.label}): ${(e as Error).message}\n${completed}`);
    }
    done.push(`${i + 1}. ${step.label}`);
  }
  return text(`Workflow "${wf.name}" finished: ${wf.steps.length} step(s) ran.\n${done.join('\n')}\n\nResult of the last step:\n${firstText(last)}`);
}
