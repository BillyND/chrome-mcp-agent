// What a click at a top-level viewport point would land on, however deeply the point sits inside
// iframes (cross-origin ones included): walk down from the top frame, one <iframe> at a time.

import type { ElementFacts, PointProbe } from '../../messages';
import { frameCall, identifyFrame, readyFrames, type FrameInfo } from '../frames';

const MAX_DEPTH = 20;

/** The child frame of `parentId` that sits in the <iframe> `iframeRef`, with where its viewport starts inside the parent's. */
async function childAt(tabId: number, frames: FrameInfo[], parentId: number, iframeRef: string) {
  const placed = await Promise.all(
    frames.filter((f) => f.parentFrameId === parentId).map(async (f) => ({ frameId: f.frameId, placement: await identifyFrame(tabId, f.frameId) })),
  );
  const hit = placed.find((p) => p.placement?.iframeRef === iframeRef);
  return hit && { frameId: hit.frameId, offset: hit.placement!.offset };
}

/** Facts about the element under the point, or null when it cannot be told (a frame that does not answer, a blank page). */
export async function factsAtPoint(tabId: number, x: number, y: number): Promise<ElementFacts | null> {
  const frames = await readyFrames(tabId);
  let frameId = 0;
  let point = { x, y };
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const probe = await frameCall<PointProbe>(tabId, frameId, { cmd: 'probe-point', point }).catch(() => null);
    if (!probe) return null;
    if ('facts' in probe) return probe.facts;
    const child = await childAt(tabId, frames, frameId, probe.iframe);
    if (!child) return null;
    point = { x: point.x - child.offset.x, y: point.y - child.offset.y };
    frameId = child.frameId;
  }
  return null;
}
