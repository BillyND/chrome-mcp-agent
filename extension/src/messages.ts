// Messages between the background service worker and the content script that
// runs in every frame. Requests go background -> frame via chrome.tabs.sendMessage
// with a frameId; the frame answers through sendResponse.

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
  | { cmd: 'snapshot'; prefix: string }
  | { cmd: 'identify-child'; nonce: string }
  | { cmd: 'announce-to-parent'; nonce: string }
  | { cmd: 'prepare'; ref: string; scroll: boolean }
  | { cmd: 'focus-and-select'; ref: string; clear: boolean }
  | { cmd: 'select-option'; ref: string; values: string[] }
  | { cmd: 'set-files'; ref: string; files: Array<{ name: string; mimeType: string; base64: string }> }
  | { cmd: 'get-text'; ref?: string }
  | { cmd: 'has-text'; text: string }
  | { cmd: 'mark-for-eval'; ref: string; nonce: string }
  | { cmd: 'scroll-element'; ref?: string; dx: number; dy: number }
  | { cmd: 'scroll-info' }
  | { cmd: 'arm-click-probe'; ref: string }
  | { cmd: 'read-click-probe' }
  | { cmd: 'synthetic-click'; ref: string; button: string; clickCount: number; modifiers: string[] }
  | { cmd: 'synthetic-pointer'; ref: string; from: { x: number; y: number }; to?: { x: number; y: number }; button: string; clickCount: number }
  | { cmd: 'overlay'; action: OverlayAction };

export type OverlayAction =
  | { type: 'show'; label: string; paused: boolean }
  | { type: 'move'; x: number; y: number; durationMs: number }
  | { type: 'click'; x: number; y: number }
  | { type: 'hide' }
  | { type: 'avoid'; x: number; y: number };

export type FrameResponse<T = unknown> = { ok: true; value: T } | { ok: false; error: string };

/** content -> background (runtime messages). */
export type RuntimeMessage =
  | { type: 'frame-identified'; nonce: string; offset: { x: number; y: number }; iframeRef: string }
  | { type: 'stop' }
  | { type: 'resume' }
  | { type: 'connect'; password?: string }
  | { type: 'logout' }
  | { type: 'reconnect' }
  | { type: 'set-local'; enabled: boolean }
  | { type: 'get-state' };

export interface ActivityEntry {
  t: number;
  tool: string;
  summary: string;
  ok: boolean;
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
}
