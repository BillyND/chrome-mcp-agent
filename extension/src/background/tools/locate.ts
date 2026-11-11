// Turning a snapshot ref into a point on screen, across iframes.

import type { PrepareResult } from '../../messages';
import { frameCall, frameOffset, identifyFrame, parseRef, readyFrames } from '../frames';
import { ToolError } from './types';

export interface Target {
  frameId: number;
  local: string;
  prep: PrepareResult;
  /** Top-level viewport point. */
  x: number;
  y: number;
}

export async function locate(tabId: number, ref: string, scroll = true): Promise<Target> {
  const { frameId, local } = parseRef(ref);
  await readyFrames(tabId);
  if (frameId !== 0) {
    // Scroll ancestors so the iframe itself is on screen before measuring.
    let current = frameId;
    for (let i = 0; i < 20 && current !== 0; i++) {
      const placement = await identifyFrame(tabId, current);
      if (!placement) break;
      await frameCall(tabId, placement.parentFrameId, { cmd: 'prepare', ref: placement.iframeRef, scroll: true }).catch(() => {});
      current = placement.parentFrameId;
    }
  }
  let prep: PrepareResult;
  try {
    prep = await frameCall<PrepareResult>(tabId, frameId, { cmd: 'prepare', ref: local, scroll });
  } catch (e) {
    const msg = (e as Error).message;
    if (/no longer on the page|did not answer|Could not establish/i.test(msg)) {
      throw new ToolError(`Element ${ref} is gone (the page changed). Take a new browser_snapshot and use the new ref.`);
    }
    throw new ToolError(msg);
  }
  const offset = frameId === 0 ? { x: 0, y: 0 } : await frameOffset(tabId, frameId);
  return { frameId, local, prep, x: Math.round(offset.x + prep.point.x), y: Math.round(offset.y + prep.point.y) };
}

/** The element's box in top-level viewport coordinates. */
export function elementBox(t: Target) {
  const ox = t.x - t.prep.point.x;
  const oy = t.y - t.prep.point.y;
  return { x: t.prep.rect.x + ox, y: t.prep.rect.y + oy, width: t.prep.rect.width, height: t.prep.rect.height };
}
