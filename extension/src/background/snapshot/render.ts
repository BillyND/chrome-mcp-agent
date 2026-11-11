// Decides what an agent gets for a snapshot: the full tree or a diff against what it saw last, cut to
// the output budget. Remembers what it showed so the next diff starts from the right place.

import { truncateWithHandle } from '../output/limit';
import { baselines, type Baseline } from './baselines';
import { diffSnapshots, formatDiff } from './diff';

export type SnapshotMode = 'full' | 'diff' | 'auto';

/** A diff is only used when it is clearly smaller than the full snapshot. */
export const DIFF_WORTH = 0.8;

export interface SnapshotView {
  agent: string;
  tabId: number;
  url: string;
  /** Which kind of snapshot this is (whole page, one subtree, interactive only...): diffs only compare like with like. */
  view: string;
}

export interface Plan {
  kind: 'full' | 'diff';
  /** Text to show; for "full" it is the whole snapshot, not yet cut. */
  body: string;
  /** Why a requested diff turned into a full snapshot. */
  note?: string;
}

/** Pure choice between diff and full. `cap` is how many characters of a full snapshot would be shown. */
export function planSnapshot(prev: Baseline | undefined, url: string, lines: string[], mode: SnapshotMode, cap: number): Plan {
  const full = lines.join('\n');
  if (mode === 'full') return { kind: 'full', body: full };
  const requested = mode === 'diff';
  if (!prev || prev.url !== url) return { kind: 'full', body: full, note: requested ? '(no earlier snapshot of this page in this tab: showing the full snapshot)' : undefined };
  const diff = diffSnapshots(prev.lines, lines);
  const text = diff ? formatDiff(diff) : undefined;
  if (text !== undefined && text.length <= Math.min(full.length, cap) * DIFF_WORTH) return { kind: 'diff', body: text };
  return { kind: 'full', body: full, note: requested ? '(the diff would not be smaller: showing the full snapshot)' : undefined };
}

/** The first `chars` characters of `lines` joined with newlines, as whole lines. */
export function linesWithin(lines: string[], chars: number): string[] {
  let used = 0;
  const kept: string[] = [];
  for (const line of lines) {
    const next = used + line.length + (kept.length ? 1 : 0);
    if (next > chars) break;
    kept.push(line);
    used = next;
  }
  return kept;
}

export interface Rendered {
  /** Label for the snapshot and the text itself (cut to `cap`, with a note and handle when it was longer). */
  title: string;
  text: string;
}

/** Plans, cuts to `cap` characters and records what the agent now knows. */
export function renderSnapshot(at: SnapshotView, full: string, mode: SnapshotMode, cap: number): Rendered {
  const lines = full.split('\n');
  const plan = planSnapshot(baselines.get(at.tabId, at.agent, at.view), at.url, lines, mode, cap);
  if (plan.kind === 'diff') {
    baselines.set(at.tabId, at.agent, at.view, { url: at.url, lines });
    return { title: 'Page snapshot', text: plan.body };
  }
  const cut = truncateWithHandle(at.agent, plan.body, cap);
  // The agent only knows the part it was shown; the rest will show up as new in a later diff.
  baselines.set(at.tabId, at.agent, at.view, { url: at.url, lines: cut.truncated ? linesWithin(lines, cut.shown) : lines });
  return { title: plan.note ? `Page snapshot ${plan.note}` : 'Page snapshot', text: cut.text };
}
