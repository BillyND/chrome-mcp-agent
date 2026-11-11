// The accessibility snapshot composed from every frame, and the short
// "what the page looks like now" tail appended to action results.

import type { ToolContent } from '../../../../shared/protocol';
import { sessionOf } from '../cdp';
import { frameCall, identifyFrame, readyFrames, refPrefix } from '../frames';
import { pageHeader, waitForLoad } from './tab';
import { text } from './types';

export async function composeSnapshot(tabId: number, maxChars = 60_000): Promise<string> {
  const frames = await readyFrames(tabId);
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
      const s = await frameCall<string>(tabId, f.frameId, { cmd: 'snapshot', prefix: refPrefix(f.frameId) }, 15_000).catch(
        (e: Error) => `- (could not read this frame: ${e.message})`,
      );
      outlines.set(f.frameId, s);
    }),
  );
  const childByRef = new Map<string, number>();
  for (const [frameId, ref] of placements) childByRef.set(ref, frameId);
  const used = new Set<number>([0]);

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

  let out = expand(0, '', 0);
  for (const f of frames) {
    if (used.has(f.frameId) || !outlines.has(f.frameId)) continue;
    out += `\n- frame f${f.frameId} (${f.url}):\n${expand(f.frameId, '  ', 1)}`;
  }
  if (out.length > maxChars) {
    out = `${out.slice(0, maxChars)}\n- … (truncated at ${maxChars} characters; use browser_get_text or scroll and snapshot again)`;
  }
  return out;
}

/** Waits for any navigation the action started, then reports the page header and a fresh snapshot. */
export async function afterAction(tab: chrome.tabs.Tab, summary: string, snapshotChars = 12_000): Promise<ToolContent[]> {
  await waitForLoad(tab.id!, 10_000);
  const header = await pageHeader(tab);
  if (sessionOf(tab.id!)?.dialog) return text(`${summary}\n\n${header}`);
  const snap = await composeSnapshot(tab.id!, snapshotChars).catch((e: Error) => `(snapshot unavailable: ${e.message})`);
  return text(`${summary}\n\n${header}\n\nPage snapshot:\n${snap}`);
}
