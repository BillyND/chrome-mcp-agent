// Saved workflows, kept in chrome.storage.local on this machine.

export interface Step {
  tool: string;
  /** Tool arguments; element refs are replaced by locators. */
  args: Record<string, unknown>;
  label: string;
}

export interface Workflow {
  name: string;
  description?: string;
  /** Parameter name -> the value it had when recorded (the default for a run that omits it). */
  params: Record<string, string>;
  steps: Step[];
  savedAt: number;
}

const KEY = 'workflows';

export const WORKFLOW_NAME = /^[\p{L}\p{N} _-]{1,60}$/u;

export async function loadWorkflows(): Promise<Record<string, Workflow>> {
  return ((await chrome.storage.local.get(KEY))[KEY] as Record<string, Workflow> | undefined) ?? {};
}

// Read-modify-write is chained so two saves never overwrite each other.
let writes: Promise<unknown> = Promise.resolve();
function update<T>(change: (all: Record<string, Workflow>) => T): Promise<T> {
  const run = writes.then(async () => {
    const all = await loadWorkflows();
    const result = change(all);
    await chrome.storage.local.set({ [KEY]: all });
    return result;
  });
  writes = run.catch(() => {});
  return run;
}

export const saveWorkflow = (wf: Workflow) => update((all) => void (all[wf.name] = wf));
export const deleteWorkflow = (name: string) => update((all) => delete all[name]);
