import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CallResult, Relay, type RelayLink } from '../shared/relay';

class FakeLink implements RelayLink {
  sent: Array<Record<string, any>> = [];
  failNext = false;
  send(data: string) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('socket closed');
    }
    this.sent.push(JSON.parse(data));
  }
}

const NOT_CONNECTED = 'not connected';
const text = (r: CallResult) => (r.content[0] as { text: string }).text;

function setup(initial?: FakeLink) {
  let link = initial;
  const relay = new Relay<FakeLink>({ current: () => link, notConnected: NOT_CONNECTED, graceMs: 1000 });
  return {
    relay,
    connect(next: FakeLink) {
      link = next;
      relay.connected();
    },
    disconnect() {
      link = undefined;
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Relay', () => {
  it('sends a call with the agent id and settles on the matching result', async () => {
    const link = new FakeLink();
    const { relay } = setup(link);
    const p = relay.call('browser_click', { ref: 'e1' }, 5000, false, 'local:claude');
    await vi.advanceTimersByTimeAsync(0);
    expect(link.sent).toHaveLength(1);
    expect(link.sent[0]).toMatchObject({ type: 'call', tool: 'browser_click', args: { ref: 'e1' }, agent: 'local:claude' });
    relay.receive({ type: 'result', id: link.sent[0].id, content: [{ type: 'text', text: 'done' }] });
    expect(await p).toEqual({ content: [{ type: 'text', text: 'done' }], isError: undefined });
  });

  it('ignores results for unknown ids and status messages', async () => {
    const link = new FakeLink();
    const { relay } = setup(link);
    relay.receive({ type: 'result', id: 'nope', content: [] });
    relay.receive({ type: 'status', version: '1', userAgent: 'x' });
    const p = relay.call('t', {}, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await p).isError).toBe(true);
  });

  it('reassembles chunked results regardless of arrival order', async () => {
    const link = new FakeLink();
    const { relay } = setup(link);
    const p = relay.call('browser_snapshot', {}, 5000);
    await vi.advanceTimersByTimeAsync(0);
    const id = link.sent[0].id;
    const raw = JSON.stringify({ type: 'result', id, content: [{ type: 'text', text: 'abcdefghij' }], isError: false });
    const parts = [raw.slice(0, 20), raw.slice(20, 40), raw.slice(40)];
    for (const i of [2, 0, 1]) relay.receive({ type: 'chunk', id, index: i, total: 3, data: parts[i] });
    expect(await p).toEqual({ content: [{ type: 'text', text: 'abcdefghij' }], isError: false });
  });

  it('times out with a hint to take a snapshot', async () => {
    const { relay } = setup(new FakeLink());
    const p = relay.call('browser_wait_for', {}, 3000);
    await vi.advanceTimersByTimeAsync(3000);
    const r = await p;
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('did not finish "browser_wait_for" within 3s');
  });

  it('fails with the not-connected text after the grace period', async () => {
    const { relay } = setup();
    const p = relay.call('t', {}, 5000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(text(await p)).toBe(NOT_CONNECTED);
  });

  it('waits for the browser to connect within the grace period', async () => {
    const { relay, connect } = setup();
    const p = relay.call('t', { a: 1 }, 5000);
    await vi.advanceTimersByTimeAsync(400);
    const link = new FakeLink();
    connect(link);
    await vi.advanceTimersByTimeAsync(0);
    expect(link.sent[0]).toMatchObject({ tool: 't', args: { a: 1 } });
    relay.receive({ type: 'result', id: link.sent[0].id, content: [{ type: 'text', text: 'ok' }] });
    expect(text(await p)).toBe('ok');
  });

  it('fails a call in flight when its link is lost, saying whether Chrome reconnected', async () => {
    const link = new FakeLink();
    const { relay } = setup(link);
    const dropped = relay.call('browser_click', {}, 5000);
    const replaced = relay.call('browser_type', {}, 5000);
    await vi.advanceTimersByTimeAsync(0);
    relay.lost(link, 'dropped');
    expect(text(await dropped)).toContain('connection to Chrome dropped');
    expect(text(await replaced)).toContain('connection to Chrome dropped');
    const other = new FakeLink();
    const { relay: relay2 } = setup(other);
    const p = relay2.call('browser_click', {}, 5000);
    await vi.advanceTimersByTimeAsync(0);
    relay2.lost(other, 'replaced');
    expect(text(await p)).toContain('Chrome reconnected');
  });

  it('resends a read-only call once on the next link, but not twice', async () => {
    const first = new FakeLink();
    const { relay, connect, disconnect } = setup(first);
    const p = relay.call('browser_snapshot', {}, 10_000, true);
    await vi.advanceTimersByTimeAsync(0);
    disconnect();
    relay.lost(first, 'dropped');
    const second = new FakeLink();
    connect(second);
    await vi.advanceTimersByTimeAsync(0);
    expect(second.sent).toHaveLength(1);
    expect(second.sent[0].id).toBe(first.sent[0].id);
    // The second link dies too: no further resend.
    disconnect();
    relay.lost(second, 'dropped');
    expect(text(await p)).toContain('connection to Chrome dropped');
  });

  it('gives up on a read-only call when the browser does not come back in time', async () => {
    const link = new FakeLink();
    const { relay, disconnect } = setup(link);
    const p = relay.call('browser_snapshot', {}, 10_000, true);
    await vi.advanceTimersByTimeAsync(0);
    disconnect();
    relay.lost(link, 'dropped');
    await vi.advanceTimersByTimeAsync(1000);
    expect(text(await p)).toContain('Lost the connection to Chrome');
  });

  it('treats a throwing send as a dropped link', async () => {
    const link = new FakeLink();
    link.failNext = true;
    const { relay } = setup(link);
    const r = await relay.call('browser_click', {}, 5000);
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('connection to Chrome dropped');
  });

  it('lets the link encoder choose the wire format', async () => {
    const link = new FakeLink();
    const relay = new Relay<FakeLink>({
      current: () => link,
      notConnected: NOT_CONNECTED,
      encode: (id, req) => JSON.stringify({ type: 'relay', id, timeoutMs: req.timeoutMs }),
    });
    void relay.call('t', {}, 4321);
    await vi.advanceTimersByTimeAsync(0);
    expect(link.sent[0]).toMatchObject({ type: 'relay', timeoutMs: 4321 });
  });
});
