// Line diff between two snapshots. Refs are stable, so an unchanged element is an identical line;
// the diff names what appeared, vanished or changed and counts everything else as unchanged.

export interface SnapshotDiff {
  /** New lines, in page order. */
  added: string[];
  removed: string[];
  /** The new version of lines that kept their ref (or their kind and indent) but changed. */
  changed: string[];
  unchanged: number;
  /** Changes in page order, ready to print: each entry is a marker and the line. */
  entries: Array<{ mark: '+' | '-' | '~'; line: string }>;
}

type Op = { op: '=' | '-' | '+'; line: string };

/** Beyond this many edits the snapshots are too different for a diff to help. */
const MAX_EDITS = 1000;

/** Myers' O(ND) diff. Returns null when more than `maxEdits` lines differ. */
function myers(a: string[], b: string[], maxEdits: number): Op[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, maxEdits);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return null;
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && prev[off + k - 1] < prev[off + k + 1]) ? k + 1 : k - 1;
    const prevX = prev[off + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ op: '=', line: a[x - 1] });
      x--;
      y--;
    }
    if (x === prevX) ops.push({ op: '+', line: b[y - 1] });
    else ops.push({ op: '-', line: a[x - 1] });
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    ops.push({ op: '=', line: a[x - 1] });
    x--;
    y--;
  }
  return ops.reverse();
}

const REF = /\[ref=([^\]]+)\]/;
/** What makes two lines "the same element": its ref, else its indentation and kind (`text`, `heading`...). */
function identity(line: string): string {
  const ref = REF.exec(line)?.[1];
  if (ref) return `ref:${ref}`;
  const m = /^(\s*)- ([a-z]+)/.exec(line);
  return m ? `${m[1].length}:${m[2]}` : line;
}

/** Null when the snapshots differ too much to diff usefully. */
export function diffSnapshots(prev: string[], next: string[]): SnapshotDiff | null {
  let start = 0;
  while (start < prev.length && start < next.length && prev[start] === next[start]) start++;
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--;
    endNext--;
  }
  const middle = myers(prev.slice(start, endPrev), next.slice(start, endNext), MAX_EDITS);
  if (!middle) return null;

  const diff: SnapshotDiff = { added: [], removed: [], changed: [], unchanged: 0, entries: [] };
  diff.unchanged = start + (prev.length - endPrev);
  // A run of consecutive edits is one hunk: inside it a removed and an added line of the same element are one change.
  for (let i = 0; i < middle.length; ) {
    if (middle[i].op === '=') {
      diff.unchanged++;
      i++;
      continue;
    }
    const hunk: Op[] = [];
    while (i < middle.length && middle[i].op !== '=') hunk.push(middle[i++]);
    const removals = new Map<string, Array<{ line: string; paired: boolean }>>();
    const removedAll: Array<{ line: string; paired: boolean }> = [];
    for (const o of hunk) {
      if (o.op !== '-') continue;
      const entry = { line: o.line, paired: false };
      removedAll.push(entry);
      const key = identity(o.line);
      removals.set(key, [...(removals.get(key) ?? []), entry]);
    }
    const adds: Array<{ line: string; pair?: boolean }> = [];
    for (const o of hunk) {
      if (o.op !== '+') continue;
      const match = removals.get(identity(o.line))?.find((r) => !r.paired);
      if (match) match.paired = true;
      adds.push({ line: o.line, pair: !!match });
    }
    for (const r of removedAll) {
      if (r.paired) continue;
      diff.removed.push(r.line);
      diff.entries.push({ mark: '-', line: r.line });
    }
    for (const a of adds) {
      if (a.pair) {
        diff.changed.push(a.line);
        diff.entries.push({ mark: '~', line: a.line });
      } else {
        diff.added.push(a.line);
        diff.entries.push({ mark: '+', line: a.line });
      }
    }
  }
  return diff;
}

export function formatDiff(d: SnapshotDiff): string {
  const stats = `+${d.added.length} −${d.removed.length} ~${d.changed.length} lines; unchanged: ${d.unchanged}`;
  if (!d.entries.length) return `Snapshot diff (no changes; unchanged: ${d.unchanged} lines)`;
  return `Snapshot diff (${stats}). + new, - removed, ~ changed; every other line is as in your last snapshot of this tab.\n${d.entries.map((e) => `${e.mark} ${e.line}`).join('\n')}`;
}
