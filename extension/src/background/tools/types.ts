// Shared types and tiny helpers for every tool family.

import type { ToolContent } from '../../../../shared/protocol';
import type { ActivityEntry } from '../../messages';
import { state } from '../state';

export type Args = Record<string, any>;

/** What a running tool knows about its caller. */
export interface ToolCtx {
  /** Stable id of the AI client that made the call. */
  agent: string;
  /** Tab the call was scheduled on (tab-scoped tools only). */
  tabId: number;
  /** Aborted when the user presses Stop; captured when the call started. */
  signal: AbortSignal;
  /** What the safety layer learned about this call, for the audit log. */
  audit: Pick<ActivityEntry, 'host' | 'outcome' | 'approval'>;
  /** Statements by Helmsman itself (not page content) added to the result outside the untrusted envelope. */
  notes: string[];
}

export type ToolFn = (args: Args, ctx: ToolCtx) => Promise<ToolContent[]>;

/** "tab": runs on the resolved tab, serialized with other calls on it. "free": no particular tab. */
export interface ToolSpec {
  run: ToolFn;
  scope: 'tab' | 'free';
}

export const tabTool = (run: ToolFn): ToolSpec => ({ run, scope: 'tab' });
export const freeTool = (run: ToolFn): ToolSpec => ({ run, scope: 'free' });

export class ToolError extends Error {}

/** A failure whose message Helmsman wrote itself (policy refusals, the user's answers); it never quotes a page, so it is not wrapped as untrusted. */
export class TrustedError extends ToolError {}

export const STOPPED = 'The user pressed Stop in Chrome. Stop working and ask the user how to continue.';

export const text = (t: string): ToolContent[] => [{ type: 'text', text: t }];
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const isMac = navigator.userAgent.includes('Mac');

/** Throws when the user pressed Stop; call between steps of long operations. */
export function checkAbort(ctx: Pick<ToolCtx, 'signal'>) {
  if (state.paused || ctx.signal.aborted) throw new ToolError(STOPPED);
}
