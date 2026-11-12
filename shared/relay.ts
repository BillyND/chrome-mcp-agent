// The relay core shared by the cloud Durable Object and the local MCP server:
// it turns "run this tool in the browser" into a message on the extension's
// link and settles the matching result, with timeouts, chunk reassembly, a
// grace wait while the extension reconnects, and a single resend of read-only
// calls whose link died. Runtime-agnostic: no Workers or Node APIs.

import type { ExtensionToHub, HubToExtension, ToolContent } from './protocol';

export interface CallResult {
  content: ToolContent[];
  isError?: boolean;
}

/** Anything that can carry a text message to the browser (a WebSocket on either runtime). */
export interface RelayLink {
  send(data: string): void;
}

export interface CallRequest {
  tool: string;
  args: Record<string, unknown>;
  agent?: string;
  timeoutMs: number;
  safeToRepeat: boolean;
}

export interface RelayOptions<L extends RelayLink> {
  /** The live link to the browser right now, if any. */
  current: () => L | undefined;
  /** Error text for a call that found no browser within the grace period. */
  notConnected: string;
  /** How long a call waits for the browser to (re)connect. Default 20s. */
  graceMs?: number;
  /** Wire format of a call on a given link; defaults to the extension protocol's `call` message. */
  encode?: (id: string, req: CallRequest, link: L) => string;
}

interface Pending<L> {
  link: L;
  req: CallRequest;
  /** Read-only calls are safe to send again when the link they went out on dies. */
  retryable: boolean;
  resolve: (r: CallResult) => void;
  timer: ReturnType<typeof setTimeout>;
  chunks?: string[];
  received?: number;
}

export const DEFAULT_GRACE_MS = 20_000;

export const errorResult = (text: string): CallResult => ({ content: [{ type: 'text', text }], isError: true });

export function parseExtensionMessage(raw: string | ArrayBuffer): ExtensionToHub | undefined {
  if (typeof raw !== 'string') return undefined;
  try {
    return JSON.parse(raw) as ExtensionToHub;
  } catch {
    return undefined;
  }
}

export const encodeCall = (id: string, r: CallRequest): string =>
  JSON.stringify({ type: 'call', id, tool: r.tool, args: r.args, agent: r.agent } satisfies HubToExtension);

export class Relay<L extends RelayLink> {
  private pending = new Map<string, Pending<L>>();
  private waiters: Array<() => void> = [];
  private graceMs: number;

  constructor(private opts: RelayOptions<L>) {
    this.graceMs = opts.graceMs ?? DEFAULT_GRACE_MS;
  }

  /** Tell the relay a new link is up so waiting calls can go out. */
  connected(): void {
    const waiters = this.waiters;
    this.waiters = [];
    waiters.forEach((w) => w());
  }

  private waitForLink(): Promise<L | undefined> {
    const now = this.opts.current();
    if (now) return Promise.resolve(now);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== done);
        resolve(undefined);
      }, this.graceMs);
      const done = () => {
        clearTimeout(timer);
        resolve(this.opts.current());
      };
      this.waiters.push(done);
    });
  }

  /** Run one tool in the browser. Never rejects: failures come back as error results. */
  async call(tool: string, args: Record<string, unknown>, timeoutMs: number, safeToRepeat = false, agent?: string): Promise<CallResult> {
    const link = await this.waitForLink();
    if (!link) return errorResult(this.opts.notConnected);
    const id = crypto.randomUUID();
    const req: CallRequest = { tool, args, agent, timeoutMs, safeToRepeat };
    return new Promise<CallResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(errorResult(`The browser did not finish "${tool}" within ${Math.round(timeoutMs / 1000)}s. Take a snapshot to see the current state.`));
      }, timeoutMs);
      this.pending.set(id, { link, req, retryable: safeToRepeat, resolve, timer });
      this.dispatch(id, link);
    });
  }

  private dispatch(id: string, link: L): void {
    const p = this.pending.get(id);
    if (!p) return;
    p.link = link;
    p.chunks = undefined;
    p.received = 0;
    try {
      link.send((this.opts.encode ?? encodeCall)(id, p.req, link));
    } catch {
      this.lost(link, 'dropped');
    }
  }

  /** A result or chunk arrived from the browser. */
  receive(msg: ExtensionToHub): void {
    if (msg.type === 'status') return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    if (msg.type === 'chunk') {
      p.chunks ??= new Array<string>(msg.total);
      if (p.chunks[msg.index] === undefined) p.received = (p.received ?? 0) + 1;
      p.chunks[msg.index] = msg.data;
      if ((p.received ?? 0) < msg.total) return;
      // The chunks carry the whole `result` message; keep only the result fields.
      const { content, isError } = JSON.parse(p.chunks.join('')) as CallResult;
      this.settle(msg.id, { content, isError });
      return;
    }
    this.settle(msg.id, { content: msg.content, isError: msg.isError });
  }

  /**
   * A link died or was replaced: resend its read-only calls once the browser is
   * back, fail the rest. `replaced` means the browser itself reconnected.
   */
  lost(link: L, reason: 'replaced' | 'dropped'): void {
    for (const [id, p] of this.pending) {
      if (p.link !== link) continue;
      if (p.retryable) {
        p.retryable = false; // at most one resend
        void this.waitForLink().then((next) => {
          if (next && next !== link) this.dispatch(id, next);
          else this.settle(id, errorResult('Lost the connection to Chrome. Try again in a moment.'));
        });
        continue;
      }
      this.settle(
        id,
        errorResult(
          reason === 'replaced'
            ? 'The command was interrupted because Chrome reconnected. Take a snapshot to check whether it completed.'
            : 'The connection to Chrome dropped while the command was running. Take a snapshot to check whether it completed.',
        ),
      );
    }
  }

  private settle(id: string, result: CallResult): void {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
    p.resolve(result);
  }
}
