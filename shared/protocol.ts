// Wire protocol between the gateway (Durable Object) and the extension.

export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

export type HubToExtension =
  /**
   * `agent` identifies the calling AI client (an OAuth client id for the cloud gateway,
   * `local:<name>` for the local server). Each agent gets its own default tab, and calls
   * from different agents on different tabs run in parallel.
   */
  | { type: 'call'; id: string; tool: string; args: Record<string, unknown>; agent?: string }
  | { type: 'hello' };

export type ExtensionToHub =
  | { type: 'result'; id: string; content: ToolContent[]; isError?: boolean }
  | { type: 'chunk'; id: string; index: number; total: number; data: string }
  | { type: 'status'; version: string; userAgent: string };

/** WebSocket subprotocol; the device token rides as a second subprotocol `auth.<token>`. */
export const PROTOCOL = 'cma.v1';
export const AUTH_PROTOCOL_PREFIX = 'auth.';

/** Results larger than this are sent in chunks (Workers accept 1 MiB per message). */
export const CHUNK_SIZE = 512 * 1024;

/** Heartbeat text the runtime answers with "pong" without waking the Durable Object. */
export const PING = 'ping';
export const PING_INTERVAL_MS = 20_000;
