// The agent bar and animated cursor drawn by the content script of the top frame.

import type { OverlayAction } from '../../messages';
import { frameCall } from '../frames';
import { state } from '../state';

const lastCursor = new Map<number, { x: number; y: number }>();

export async function overlay(tabId: number, action: OverlayAction) {
  await frameCall(tabId, 0, { cmd: 'overlay', action }, 3000).catch(() => {});
}

/** Removes the cursor and bar (Stop). */
export async function hideAgentBar(tabId: number) {
  await overlay(tabId, { type: 'hide' });
}

export async function showAgentBar(tabId: number, label: string) {
  await overlay(tabId, { type: 'show', label, paused: state.paused, cursor: lastCursor.get(tabId) });
}

/** Keeps the bar and cursor out of a capture, and always puts them back. */
export async function withOverlayConcealed<T>(tabId: number, fn: () => Promise<T>): Promise<T> {
  await overlay(tabId, { type: 'conceal' });
  try {
    return await fn();
  } finally {
    await overlay(tabId, { type: 'reveal' });
  }
}

/** Glides the cursor to a point; the duration scales with the distance travelled. */
export async function glide(tabId: number, x: number, y: number) {
  const prev = lastCursor.get(tabId);
  const dist = prev ? Math.hypot(prev.x - x, prev.y - y) : 500;
  const durationMs = Math.round(Math.min(900, Math.max(360, 320 + dist * 0.5)));
  await overlay(tabId, { type: 'avoid', x, y });
  await overlay(tabId, { type: 'move', x, y, durationMs });
  lastCursor.set(tabId, { x, y });
}

/** Moves the cursor to the end of a drag without the long glide. */
export async function settleCursor(tabId: number, x: number, y: number) {
  await overlay(tabId, { type: 'move', x, y, durationMs: 300 });
  lastCursor.set(tabId, { x, y });
}

chrome.tabs.onRemoved.addListener((tabId) => lastCursor.delete(tabId));
