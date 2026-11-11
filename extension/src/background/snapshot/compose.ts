// The accessibility snapshot of a tab, composed from the outline of every frame: each iframe line
// is replaced by the outline of the frame it hosts.

import { frameCall, identifyFrame, parseRef, readyFrames, refPrefix, type FrameInfo } from '../frames';

export interface ComposeOptions {
  /** Only this element and what it contains (it may be inside an iframe). */
  ref?: string;
  depth?: number;
  interactiveOnly?: boolean;
}

/** `root` and every frame below it. */
function subtree(frames: FrameInfo[], root: number): FrameInfo[] {
  const byId = new Map(frames.map((f) => [f.frameId, f]));
  const inside = (f: FrameInfo): boolean => {
    for (let cur: FrameInfo | undefined = f, i = 0; cur && i < 30; cur = byId.get(cur.parentFrameId), i++) if (cur.frameId === root) return true;
    return false;
  };
  return frames.filter(inside);
}

/** The whole snapshot text, not cut: callers apply their own budget. */
export async function composeSnapshot(tabId: number, opts: ComposeOptions = {}): Promise<string> {
  const scoped = opts.ref ? parseRef(opts.ref) : undefined;
  const all = await readyFrames(tabId);
  const rootFrame = scoped?.frameId ?? 0;
  const frames = scoped ? subtree(all, rootFrame) : all;
  if (scoped && !frames.some((f) => f.frameId === rootFrame)) throw new Error(`The frame of ${opts.ref} is gone. Take a new browser_snapshot.`);

  const placements = new Map<number, string>(); // child frameId -> iframe ref (with parent prefix)
  await Promise.all(
    frames
      .filter((f) => f.frameId !== 0)
      .map(async (f) => {
        const p = await identifyFrame(tabId, f.frameId);
        if (p) placements.set(f.frameId, refPrefix(p.parentFrameId) + p.iframeRef);
      }),
  );
  const outlines = new Map<number, string>();
  await Promise.all(
    frames.map(async (f) => {
      const request = {
        cmd: 'snapshot' as const,
        prefix: refPrefix(f.frameId),
        ref: f.frameId === rootFrame ? scoped?.local : undefined,
        depth: opts.depth,
        interactiveOnly: opts.interactiveOnly,
      };
      try {
        outlines.set(f.frameId, await frameCall<string>(tabId, f.frameId, request, 15_000));
      } catch (e) {
        // A scoped read of a vanished element must fail loudly; a frame that merely did not answer is noted in place.
        if (scoped && f.frameId === rootFrame) throw e;
        outlines.set(f.frameId, `- (could not read this frame: ${(e as Error).message})`);
      }
    }),
  );
  const childByRef = new Map<string, number>();
  for (const [frameId, ref] of placements) childByRef.set(ref, frameId);
  const used = new Set<number>([rootFrame]);

  const expand = (frameId: number, indent: string, depth: number): string => {
    const body = outlines.get(frameId) ?? '';
    return body
      .split('\n')
      .map((line) => {
        const m = /^(\s*)⟦frame:([^⟧]+)⟧$/.exec(line);
        if (!m) return indent + line;
        const child = childByRef.get(m[2]);
        if (child === undefined || depth > 8) return `${indent}${m[1]}- (frame content not available)`;
        used.add(child);
        const inner = expand(child, indent + m[1], depth + 1);
        return inner.trim() ? inner : `${indent}${m[1]}- (empty frame)`;
      })
      .join('\n');
  };

  let out = expand(rootFrame, '', 0);
  if (!scoped) {
    for (const f of frames) {
      if (used.has(f.frameId) || !outlines.has(f.frameId)) continue;
      // With a depth limit an iframe line can be shown without its content: that frame is hidden, not lost.
      if (opts.depth !== undefined && placements.has(f.frameId)) continue;
      out += `\n- frame f${f.frameId} (${f.url}):\n${expand(f.frameId, '  ', 1)}`;
    }
  }
  return out;
}
