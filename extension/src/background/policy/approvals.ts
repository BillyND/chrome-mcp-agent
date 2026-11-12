// Questions for the user: an on-page prompt in the tab (drawn by the content script's overlay), or the
// popup when the page cannot show one. The call that asked waits here until the user answers, the
// timeout passes, the tab goes away, or Stop is pressed.

import type { Choice, PromptKind, PromptSpec } from '../../messages';
import { frameCall, readyFrames } from '../frames';
import { notify, setPendingCount } from '../state';
import { STOPPED, ToolError } from '../tools/types';

interface Pending {
  spec: PromptSpec;
  tabId: number;
  /** Tab currently drawing the prompt: the asking tab, or the tab in front when the asking one cannot show it. */
  shownOn?: number;
  resolve: (choice: Choice) => void;
}

const pending = new Map<string, Pending>();

const CHOICES: Record<PromptKind, Choice[]> = {
  site: ['always', 'once', 'decline'],
  sensitive: ['approve', 'decline'],
  handback: ['done', 'decline'],
};

export const pendingPrompts = (): PromptSpec[] => [...pending.values()].map((p) => p.spec);

/** Records the user's answer from the page prompt or the popup. False when the question is gone or the answer is not one of its choices. */
export function answer(id: string, choice: Choice): boolean {
  const p = pending.get(id);
  if (!p || !p.spec.choices.includes(choice)) return false;
  p.resolve(choice);
  return true;
}

async function drawOn(tabId: number, spec: PromptSpec): Promise<boolean> {
  // A tab opened in the background may not have the content script yet; readyFrames injects it.
  await readyFrames(tabId).catch(() => {});
  return frameCall(tabId, 0, { cmd: 'overlay', action: { type: 'prompt', prompt: spec } }, 3000).then(() => true, () => false);
}

/** Draws the prompt on the asking tab, or on the tab in front when that one is blank, a chrome:// page or gone. */
async function show(p: Pending): Promise<boolean> {
  const [front] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  for (const tabId of new Set([p.tabId, front?.id])) {
    if (tabId !== undefined && tabId >= 0 && (await drawOn(tabId, p.spec))) {
      p.shownOn = tabId;
      return true;
    }
  }
  return false;
}

const isInFront = async (tabId: number | undefined): Promise<boolean> =>
  tabId !== undefined && !!(await chrome.tabs.get(tabId).catch(() => null))?.active;

export interface Question {
  tabId: number;
  kind: PromptKind;
  agent: string;
  host: string;
  label?: string;
  category?: string;
}

/**
 * Asks and waits. Resolves with the user's choice, or "timeout" when nobody answered in time.
 * Throws the Stop message when the user pressed Stop meanwhile.
 */
export async function ask(q: Question, signal: AbortSignal, timeoutMs: number): Promise<Choice | 'timeout'> {
  const spec: PromptSpec = { id: crypto.randomUUID(), kind: q.kind, agent: q.agent, host: q.host, label: q.label ?? '', category: q.category ?? '', choices: CHOICES[q.kind] };
  let onAbort = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let entry: Pending | undefined;
  try {
    return await new Promise<Choice | 'timeout'>((resolve, reject) => {
      entry = { spec, tabId: q.tabId, resolve };
      pending.set(spec.id, entry);
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
      onAbort = () => reject(new ToolError(STOPPED));
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
      setPendingCount(pending.size);
      notify();
      const shown = entry;
      void show(shown).then(async (drawn) => {
        // The popup is the fallback when no page can show the prompt, and when the user is not looking at the tab that does.
        if ((!drawn || !(await isInFront(shown.shownOn))) && pending.has(spec.id)) void chrome.action.openPopup?.().catch(() => {});
      });
    });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    pending.delete(spec.id);
    setPendingCount(pending.size);
    for (const tabId of new Set([q.tabId, entry?.shownOn])) {
      if (tabId !== undefined) void frameCall(tabId, 0, { cmd: 'overlay', action: { type: 'prompt-end', id: spec.id } }, 1500).catch(() => {});
    }
    notify();
  }
}

// A page that navigates loses its prompt: draw it again once the new page is ready. A closed tab declines.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status !== 'complete') return;
  for (const p of pending.values()) if (p.tabId === tabId || p.shownOn === tabId) void show(p);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const p of pending.values()) if (p.tabId === tabId) p.resolve('decline');
});
