// Talking to the content script in each frame, mapping iframe elements to
// frames (works across origins), and converting frame coordinates to the
// top-level viewport coordinates that CDP input events use.

import type { FrameRequest, FrameResponse, RuntimeMessage } from '../messages';

const FRAME_TIMEOUT_MS = 8_000;

export interface FrameInfo {
  frameId: number;
  parentFrameId: number;
  url: string;
}

/** Parses "e12" (top frame) or "f7e3" (frame 7) into frame and local ref. */
export function parseRef(ref: string): { frameId: number; local: string } {
  const m = /^(?:f(\d+))?(e\d+)$/.exec(ref.trim());
  if (!m) throw new Error(`"${ref}" is not a valid ref. Use a ref like "e12" or "f3e7" from browser_snapshot.`);
  return { frameId: m[1] ? Number(m[1]) : 0, local: m[2] };
}

export function refPrefix(frameId: number): string {
  return frameId === 0 ? '' : `f${frameId}`;
}

export async function frameCall<T>(tabId: number, frameId: number, req: FrameRequest, timeoutMs = FRAME_TIMEOUT_MS): Promise<T> {
  const res = await Promise.race([
    chrome.tabs.sendMessage(tabId, req, { frameId }) as Promise<FrameResponse<T> | undefined>,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('The page is not responding (it may be busy, frozen, or blocked by an open dialog).')),
        timeoutMs,
      ),
    ),
  ]);
  if (!res) throw new Error('The frame did not answer. The page may have navigated; take a new snapshot.');
  if (!res.ok) throw new Error(res.error);
  return res.value;
}

async function pingFrame(tabId: number, frameId: number): Promise<boolean> {
  try {
    await frameCall(tabId, frameId, { cmd: 'ping' }, 1500);
    return true;
  } catch {
    return false;
  }
}

/** Lists frames and makes sure each has the content script (tabs opened before install don't). */
export async function readyFrames(tabId: number): Promise<FrameInfo[]> {
  const frames = ((await chrome.webNavigation.getAllFrames({ tabId })) ?? []).filter(
    (f) => !f.errorOccurred && !/^(chrome|devtools|chrome-extension|edge):/.test(f.url),
  );
  const status = await Promise.all(frames.map((f) => pingFrame(tabId, f.frameId)));
  const missing = frames.filter((_, i) => !status[i]).map((f) => f.frameId);
  if (missing.length) {
    await chrome.scripting
      .executeScript({ target: { tabId, frameIds: missing }, files: ['content.js'] })
      .catch(() => {});
  }
  const ready = await Promise.all(frames.map((f, i) => (status[i] ? true : pingFrame(tabId, f.frameId))));
  return frames
    .filter((_, i) => ready[i])
    .map((f) => ({ frameId: f.frameId, parentFrameId: f.parentFrameId, url: f.url }));
}

// ---- frame identification ---------------------------------------------------

const waiting = new Map<string, (m: Extract<RuntimeMessage, { type: 'frame-identified' }>) => void>();

export function handleFrameIdentified(msg: Extract<RuntimeMessage, { type: 'frame-identified' }>) {
  waiting.get(msg.nonce)?.(msg);
}

export interface FramePlacement {
  parentFrameId: number;
  iframeRef: string;
  offset: { x: number; y: number };
}

/** Asks a child frame to announce itself to its parent; the parent reports which <iframe> it is. */
export async function identifyFrame(tabId: number, frameId: number): Promise<FramePlacement | null> {
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  const parentFrameId = frames?.find((f) => f.frameId === frameId)?.parentFrameId;
  if (parentFrameId === undefined || parentFrameId < 0) return null;
  const nonce = crypto.randomUUID();
  const result = new Promise<FramePlacement | null>((resolve) => {
    const timer = setTimeout(() => {
      waiting.delete(nonce);
      resolve(null);
    }, 2500);
    waiting.set(nonce, (m) => {
      clearTimeout(timer);
      waiting.delete(nonce);
      resolve({ parentFrameId, iframeRef: m.iframeRef, offset: m.offset });
    });
  });
  await frameCall(tabId, frameId, { cmd: 'announce-to-parent', nonce }).catch(() => {});
  return result;
}

/** Offset of a frame's viewport inside the top-level viewport, in CSS pixels. */
export async function frameOffset(tabId: number, frameId: number): Promise<{ x: number; y: number }> {
  let x = 0;
  let y = 0;
  let current = frameId;
  for (let depth = 0; current !== 0 && depth < 20; depth++) {
    const placement = await identifyFrame(tabId, current);
    if (!placement) throw new Error('Could not locate the iframe on the page (it may be hidden or still loading).');
    x += placement.offset.x;
    y += placement.offset.y;
    current = placement.parentFrameId;
  }
  return { x, y };
}

/** Sends the same kind of request to every frame of the tab; frames that fail to answer are skipped. */
export async function callAllFrames<T>(
  tabId: number,
  request: (frame: FrameInfo) => FrameRequest,
  timeoutMs?: number,
): Promise<Array<{ frame: FrameInfo; value: T }>> {
  const frames = await readyFrames(tabId);
  const answers = await Promise.all(
    frames.map((frame) => frameCall<T>(tabId, frame.frameId, request(frame), timeoutMs).then((value) => ({ frame, value }), () => null)),
  );
  return answers.filter((a): a is { frame: FrameInfo; value: T } => a !== null);
}
