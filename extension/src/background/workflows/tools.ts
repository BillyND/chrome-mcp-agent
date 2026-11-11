// browser_workflow: record what an agent does and replay it later.

import { freeTool, text, ToolError, type Args } from '../tools/types';
import { PARAM_NAME, parametrize, stepLabel } from './args';
import { currentRecording, startRecording, stopRecording } from './recorder';
import { runWorkflow, type StepRunner } from './run';
import { deleteWorkflow, loadWorkflows, saveWorkflow, type Step, WORKFLOW_NAME, type Workflow } from './store';

const nameOf = (args: Args): string => {
  const name = String(args.name ?? '').trim();
  if (!WORKFLOW_NAME.test(name)) throw new ToolError('name is required: 1-60 letters, digits, spaces, - or _.');
  return name;
};

async function find(name: string): Promise<Workflow> {
  const wf = (await loadWorkflows())[name];
  if (!wf) throw new ToolError(`No saved workflow named "${name}".`);
  return wf;
}

/** Parameter name -> literal value, validated. */
function paramsOf(given: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries((given ?? {}) as Record<string, unknown>)) {
    if (!PARAM_NAME.test(name)) throw new ToolError(`Parameter name "${name}" must be letters, digits or _ (max 30).`);
    out[name] = String(value);
  }
  return out;
}

async function stop(agent: string, given: unknown) {
  const rec = currentRecording(agent);
  if (!rec) throw new ToolError('Not recording. Call start_recording first.');
  if (!rec.steps.length) {
    stopRecording(agent);
    throw new ToolError(`Nothing was recorded for "${rec.name}": no successful action ran while recording.${rec.skipped.length ? ` Could not record: ${rec.skipped.join('; ')}` : ''}`);
  }
  const params = paramsOf(given);
  const used = new Set<string>();
  const steps = rec.steps.map((step) => {
    const converted = parametrize(step.args, params);
    converted.used.forEach((u) => used.add(u));
    const args = converted.value as Step['args'];
    return { ...step, args, label: stepLabel(step.tool, args) };
  });
  const unused = Object.keys(params).filter((p) => !used.has(p));
  if (unused.length) throw new ToolError(`Parameter ${unused.map((u) => `"${u}"`).join(', ')} does not match any value used while recording; recording is still on. Fix params or call stop_recording without them.`);
  stopRecording(agent);
  await saveWorkflow({ name: rec.name, description: rec.description, params, steps, savedAt: Date.now() });
  const note = rec.skipped.length ? `\nNot recorded: ${rec.skipped.join('; ')}` : '';
  return text(`Saved workflow "${rec.name}" with ${steps.length} step(s)${Object.keys(params).length ? ` and parameter(s) ${Object.keys(params).join(', ')}` : ''}:\n${steps.map((s, i) => `${i + 1}. ${s.label}`).join('\n')}${note}`);
}

async function list(name?: string) {
  const all = await loadWorkflows();
  if (name) {
    const wf = all[name];
    if (!wf) throw new ToolError(`No saved workflow named "${name}".`);
    return text(JSON.stringify({ name: wf.name, description: wf.description, params: wf.params, steps: wf.steps.map((s) => s.label) }));
  }
  return text(JSON.stringify({ workflows: Object.values(all).map((w) => ({ name: w.name, description: w.description, params: w.params, steps: w.steps.length })) }));
}

/** `runStep` runs one call without recording it (injected so this module does not depend on the tool registry). */
export const workflowTools = (runStep: StepRunner) => ({
  browser_workflow: {
    // Its own lane: a replay calls other tools for the same agent and must not wait behind itself.
    ...freeTool(async (args, ctx) => {
      const agent = ctx.agent;
      switch (args.action) {
        case 'start_recording': {
          const name = nameOf(args);
          startRecording(agent, name, args.description ? String(args.description) : undefined);
          return text(`Recording "${name}". Do the task now; each successful action is saved. Call browser_workflow stop_recording when done (params {"city":"Hà Nội"} turns values you typed into parameters).`);
        }
        case 'stop_recording':
          return stop(agent, args.params);
        case 'list':
          return list(args.name ? nameOf(args) : undefined);
        case 'run':
          return runWorkflow(await find(nameOf(args)), args.params as Record<string, unknown> | undefined, agent, runStep, ctx);
        case 'delete': {
          const name = nameOf(args);
          if (!(await deleteWorkflow(name))) throw new ToolError(`No saved workflow named "${name}".`);
          return text(`Deleted workflow "${name}".`);
        }
        default:
          throw new ToolError('action must be start_recording, stop_recording, list, run or delete.');
      }
    }),
    lane: 'workflow',
  },
});
