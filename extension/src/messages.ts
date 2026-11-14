// Messages between the background service worker and the content script that
// runs in every frame. Requests go background -> frame via chrome.tabs.sendMessage
// with a frameId; the frame answers through sendResponse.

import type { Fingerprint } from './locator';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PrepareResult {
  /** Frame-local CSS pixel point to click. */
  point: { x: number; y: number };
  rect: Rect;
  label: string;
  tag: string;
  inputType?: string;
  editable: boolean;
  checked?: boolean;
  /** Set when another element covers the target at the chosen point. */
  coveredBy?: string;
}

export type FrameRequest =
  | { cmd: 'ping' }
  | { cmd: 'snapshot'; prefix: string; ref?: string; depth?: number; interactiveOnly?: boolean }
  | { cmd: 'describe-ref'; ref: string }
  | { cmd: 'find-by-locator'; locator: Fingerprint; prefix: string }
  | { cmd: 'identify-child'; nonce: string }
  | { cmd: 'announce-to-parent'; nonce: string }
  | { cmd: 'prepare'; ref: string; scroll: boolean }
  | { cmd: 'focus-and-select'; ref: string; clear: boolean }
  | { cmd: 'select-option'; ref: string; values: string[] }
  | { cmd: 'set-files'; ref: string; files: Array<{ name: string; mimeType: string; base64: string }> }
  | { cmd: 'get-text'; ref?: string }
  | { cmd: 'has-text'; text: string }
  | { cmd: 'has-selector'; selector: string; visible: boolean }
  | { cmd: 'find-text'; text: string; caseSensitive: boolean; max: number; prefix: string }
  | { cmd: 'extract'; what: string[]; ref?: string; max: number; prefix: string; top: boolean }
  | { cmd: 'select-text'; ref?: string; text?: string }
  | { cmd: 'get-selection' }
  | { cmd: 'mark-for-eval'; ref: string; nonce: string }
  | { cmd: 'scroll-element'; ref?: string; dx: number; dy: number }
  | { cmd: 'scroll-info' }
  | { cmd: 'arm-click-probe'; ref: string }
  | { cmd: 'read-click-probe' }
  | { cmd: 'synthetic-click'; ref: string; button: string; clickCount: number; modifiers: string[] }
  | { cmd: 'synthetic-pointer'; ref: string; from: { x: number; y: number }; to?: { x: number; y: number }; button: string; clickCount: number }
  | { cmd: 'mask-secrets'; values: string[] }
  | { cmd: 'unmask-secrets' }
  | { cmd: 'detect-gates' }
  | { cmd: 'overlay'; action: OverlayAction };

/** A login field or a CAPTCHA the user must handle. */
export interface PageGates {
  password: boolean;
  captcha: boolean;
}

export type PromptKind = 'handback';
/** Answers to a handback prompt. */
export type Choice = 'done' | 'decline';

/** An on-page confirmation the user answers with a click. */
export interface PromptSpec {
  id: string;
  kind: PromptKind;
  /** The agent's id; prompt-copy turns it into a readable name. */
  agent: string;
  host: string;
  /** The reason the agent gave for asking the user to take over. */
  label: string;
  choices: Choice[];
}

export type OverlayAction =
  /** `cursor` restores the agent cursor where it was before a navigation recreated the overlay. */
  | { type: 'show'; label: string; paused: boolean; cursor?: { x: number; y: number } }
  | { type: 'move'; x: number; y: number; durationMs: number }
  | { type: 'click'; x: number; y: number }
  | { type: 'hide' }
  /** Hide the overlay for a screenshot without changing its state; `reveal` brings it back. */
  | { type: 'conceal' }
  | { type: 'reveal' }
  | { type: 'avoid'; x: number; y: number }
  | { type: 'prompt'; prompt: PromptSpec }
  | { type: 'prompt-end'; id: string };

export type FrameResponse<T = unknown> = { ok: true; value: T } | { ok: false; error: string };

/** content -> background (runtime messages). */
export type RuntimeMessage =
  | { type: 'frame-identified'; nonce: string; offset: { x: number; y: number }; iframeRef: string }
  /** On-page Stop: ends the current task only; the next request works normally. */
  | { type: 'stop' }
  /** Popup switch off: no agent may act until it is turned back on. */
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'connect'; password?: string }
  | { type: 'logout' }
  | { type: 'reconnect' }
  | { type: 'set-local'; enabled: boolean }
  | { type: 'get-state' }
  | { type: 'approval-decision'; id: string; choice: Choice }
  | { type: 'clear-log' }
  | { type: 'open-audit' };

export interface ActivityEntry {
  t: number;
  tool: string;
  summary: string;
  ok: boolean;
  /** Agent label that made the call. */
  agent?: string;
  /** Site the call acted on. */
  host?: string;
  /** How the call ended. */
  outcome?: 'ok' | 'error' | 'declined';
  /** The user's answer when the call needed one. */
  approval?: 'approved' | 'declined' | 'timeout';
}

export type ConnectionStatus = 'signed-out' | 'connecting' | 'connected' | 'offline' | 'replaced' | 'not-allowed' | 'off';

export interface PopupState {
  status: ConnectionStatus;
  code?: string;
  needsPassword: boolean;
  paused: boolean;
  gateway: string;
  log: ActivityEntry[];
  lastError?: string;
  /** Local mode: connection to an MCP server running on this machine. `connecting` means waiting for it to start. */
  local: { enabled: boolean; status: ConnectionStatus; port: number };
  /** Handback prompts waiting for the user (the popup answers them when the page can't show one). */
  pending: PromptSpec[];
}
