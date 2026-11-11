// Between refs and locators: describe a ref's element while recording, find it again while replaying.

import { type Candidate, describeLocator, type Fingerprint, framePathOf, type Locator, pickBest } from '../../locator';
import { frameCall, parseRef, readyFrames, refPrefix } from '../frames';
import { checkAbort, sleep, ToolError, type ToolCtx } from '../tools/types';

export async function recordLocator(tabId: number, ref: string): Promise<Locator> {
  const { frameId, local } = parseRef(ref);
  const [fp, frames] = await Promise.all([
    frameCall<Fingerprint & { nth: number }>(tabId, frameId, { cmd: 'describe-ref', ref: local }),
    readyFrames(tabId),
  ]);
  return { ...fp, frame: framePathOf(frames, frameId) };
}

const LOOKUP_MS = 4000;

/** Finds the element a locator describes in any frame of the tab, waiting briefly for pages that are still drawing. */
export async function resolveLocator(tabId: number, want: Locator, ctx: Pick<ToolCtx, 'signal'>): Promise<string> {
  const deadline = Date.now() + LOOKUP_MS;
  for (;;) {
    checkAbort(ctx);
    const frames = await readyFrames(tabId);
    const found = await Promise.all(
      frames.map(async (f): Promise<Candidate[]> => {
        const hits = await frameCall<Array<Omit<Candidate, 'frame'>>>(tabId, f.frameId, { cmd: 'find-by-locator', locator: want, prefix: refPrefix(f.frameId) }).catch(() => []);
        const frame = framePathOf(frames, f.frameId);
        return hits.map((h) => ({ ...h, frame }));
      }),
    );
    const best = pickBest(want, found.flat());
    if (best) return best.ref;
    if (Date.now() >= deadline) break;
    await sleep(300);
  }
  throw new ToolError(`Could not find ${describeLocator(want)} on the page${want.frame.length ? ` (inside an iframe)` : ''}. The page may have changed since the workflow was recorded.`);
}
