// Turns a saved workflow (as the extension lists it) into MCP prompt data. Pure, so it is unit tested.

export interface WorkflowSummary {
  name: string;
  description?: string;
  /** Parameter name -> the value recorded with (used when a run omits it). */
  params?: Record<string, string>;
  /** Number of steps (list) or the human-readable steps (detail). */
  steps?: number | string[];
}

/** Parses the JSON the extension returns for `browser_workflow list`; anything else means "no workflows". */
export function parseWorkflowList(text: string | undefined): WorkflowSummary[] {
  try {
    const parsed = JSON.parse(text ?? '') as { workflows?: WorkflowSummary[] };
    return Array.isArray(parsed.workflows) ? parsed.workflows.filter((w) => typeof w?.name === 'string') : [];
  } catch {
    return [];
  }
}

export function parseWorkflowDetail(text: string | undefined): WorkflowSummary | undefined {
  try {
    const parsed = JSON.parse(text ?? '') as WorkflowSummary;
    return typeof parsed?.name === 'string' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function promptArguments(w: WorkflowSummary) {
  return Object.entries(w.params ?? {}).map(([name, example]) => ({
    name,
    description: `Value for {{param:${name}}} (recorded with "${example}"; omit to use that).`,
    required: false,
  }));
}

/** A ready-to-follow instruction for the model. */
export function workflowInstruction(w: WorkflowSummary, args: Record<string, string> = {}): string {
  const params = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined && v !== ''));
  const call = JSON.stringify({ action: 'run', name: w.name, ...(Object.keys(params).length ? { params } : {}) });
  const steps = Array.isArray(w.steps) ? w.steps.map((s, i) => `${i + 1}. ${s}`).join('\n') : '';
  return [
    `Run the saved Helmsman workflow "${w.name}"${w.description ? `: ${w.description}` : '.'}`,
    `Call browser_workflow with ${call}. It replays every step with fresh element lookups and stops at the first step that fails.`,
    steps && `Steps it performs:\n${steps}`,
    'If a step fails, take a browser_snapshot, finish the remaining steps by hand with the normal browser tools, and tell the user what changed on the page.',
  ]
    .filter(Boolean)
    .join('\n\n');
}
