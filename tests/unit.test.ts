import { describe, expect, it } from 'vitest';
import { macCommands, parseShortcut } from '../extension/src/background/keys';
import { agentLabel, GROUP_COLORS, pickColor } from '../extension/src/background/tools/agent-id';
import { Scheduler } from '../extension/src/background/tools/scheduler';
import { signDeviceToken, verifyDeviceToken } from '../worker/src/device-token';
import { newCode, normalizeCode } from '../worker/src/pairing';
import { TOOLS, TOOL_BY_NAME } from '../shared/tools';

const SECRET = 'unit-test-secret-0123456789abcdef0123';

describe('device tokens', () => {
  it('round-trips the device id', async () => {
    const token = await signDeviceToken(SECRET, 'Device-ABC');
    expect(await verifyDeviceToken(SECRET, token)).toBe('device-abc');
  });

  it('rejects a token signed with another secret', async () => {
    const token = await signDeviceToken('another-secret-0123456789abcdef0123', 'a@b.c');
    expect(await verifyDeviceToken(SECRET, token)).toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const token = await signDeviceToken(SECRET, 'a@b.c');
    const [, sig] = token.split('.');
    const forged = btoa(JSON.stringify({ sub: 'boss@b.c', iat: 0, exp: 9e9 })).replace(/=+$/, '');
    expect(await verifyDeviceToken(SECRET, `${forged}.${sig}`)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await signDeviceToken(SECRET, 'a@b.c', Date.now() - 400 * 24 * 3600 * 1000);
    expect(await verifyDeviceToken(SECRET, token)).toBeNull();
  });

  it('rejects garbage', async () => {
    expect(await verifyDeviceToken(SECRET, 'not-a-token')).toBeNull();
    expect(await verifyDeviceToken(SECRET, '')).toBeNull();
  });
});

describe('connection codes', () => {
  it('generates readable codes', () => {
    for (let i = 0; i < 50; i++) expect(newCode()).toMatch(/^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);
  });
  it('accepts sloppy typing and rejects junk', () => {
    expect(normalizeCode('k7qx2 mn4pd')).toBe('K7QX2-MN4PD');
    expect(normalizeCode('K7QX2MN4PD')).toBe('K7QX2-MN4PD');
    expect(normalizeCode('K7QX2-MN4P')).toBeNull();
    expect(normalizeCode('K7QX2-MN4P0')).toBeNull(); // 0 is not in the alphabet
  });
});

describe('shortcuts', () => {
  it('parses modifiers and keys', () => {
    const s = parseShortcut('Control+Shift+K');
    expect(s.modifiers).toEqual(['Control', 'Shift']);
    expect(s.key.code).toBe('KeyK');
    expect(parseShortcut('Enter').key.keyCode).toBe(13);
    expect(parseShortcut('cmd+a').modifiers).toEqual(['Meta']);
    expect(parseShortcut('Control++').key.key).toBe('+');
  });
  it('rejects unknown names with a helpful message', () => {
    expect(() => parseShortcut('Hyper+K')).toThrow(/Unknown modifier/);
    expect(() => parseShortcut('Banana')).toThrow(/Unknown key/);
  });
  it('maps macOS editing shortcuts to commands', () => {
    expect(macCommands(['Meta'], parseShortcut('a').key)).toEqual(['selectAll']);
    expect(macCommands(['Meta', 'Shift'], parseShortcut('z').key)).toEqual(['redo']);
    expect(macCommands(['Control'], parseShortcut('a').key)).toBeUndefined();
  });
});

describe('tool catalog', () => {
  it('has unique, spec-valid names and object schemas', () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of TOOLS) {
      expect(t.name).toMatch(/^[A-Za-z0-9_.-]{1,128}$/);
      expect((t.inputSchema as { type: string }).type).toBe('object');
      expect(t.description.length).toBeGreaterThan(20);
    }
  });
});

/** A task the test finishes by hand, recording when it starts. */
function controlled(log: string[], name: string) {
  let finish!: (v?: unknown) => void;
  let fail!: (e: unknown) => void;
  const done = new Promise((res, rej) => {
    finish = res;
    fail = rej;
  });
  return { task: () => (log.push(`start ${name}`), done), finish: () => finish(name), fail: (e: unknown) => fail(e) };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('scheduler', () => {
  it('runs tasks on different lanes at the same time', async () => {
    const log: string[] = [];
    const s = new Scheduler(6);
    const a = controlled(log, 'a');
    const b = controlled(log, 'b');
    const pa = s.run('tab:1', a.task);
    const pb = s.run('tab:2', b.task);
    await tick();
    expect(log).toEqual(['start a', 'start b']);
    a.finish();
    b.finish();
    await Promise.all([pa, pb]);
  });

  it('runs tasks on one lane strictly in arrival order', async () => {
    const log: string[] = [];
    const s = new Scheduler(6);
    const [a, b, c] = ['a', 'b', 'c'].map((n) => controlled(log, n));
    const all = [s.run('tab:1', a.task), s.run('tab:1', b.task), s.run('tab:1', c.task)];
    await tick();
    expect(log).toEqual(['start a']);
    a.finish();
    await tick();
    expect(log).toEqual(['start a', 'start b']);
    b.finish();
    await tick();
    c.finish();
    await Promise.all(all);
    expect(log).toEqual(['start a', 'start b', 'start c']);
  });

  it('lets other lanes pass a busy lane without breaking order inside it', async () => {
    const log: string[] = [];
    const s = new Scheduler(6);
    const [a1, a2, b1] = [controlled(log, 'a1'), controlled(log, 'a2'), controlled(log, 'b1')];
    const all = [s.run('a', a1.task), s.run('a', a2.task), s.run('b', b1.task)];
    await tick();
    expect(log).toEqual(['start a1', 'start b1']); // a2 waits for a1, b1 does not
    a1.finish();
    b1.finish();
    await tick();
    a2.finish();
    await Promise.all(all);
    expect(log).toEqual(['start a1', 'start b1', 'start a2']);
  });

  it('never runs more than the cap and starts waiting lanes as slots free up', async () => {
    const log: string[] = [];
    const s = new Scheduler(2);
    const tasks = [1, 2, 3, 4].map((n) => controlled(log, `t${n}`));
    const all = tasks.map((t, i) => s.run(`lane${i}`, t.task));
    await tick();
    expect(log).toEqual(['start t1', 'start t2']);
    expect(s.stats).toEqual({ running: 2, queued: 2 });
    tasks[1].finish();
    await tick();
    expect(log).toEqual(['start t1', 'start t2', 'start t3']);
    tasks[0].finish();
    tasks[2].finish();
    await tick();
    tasks[3].finish();
    await Promise.all(all);
    expect(s.stats).toEqual({ running: 0, queued: 0 });
  });

  it('keeps going after a task fails and passes the error to its caller only', async () => {
    const log: string[] = [];
    const s = new Scheduler(6);
    const bad = controlled(log, 'bad');
    const next = controlled(log, 'next');
    const pBad = s.run('tab:1', bad.task);
    const pNext = s.run('tab:1', next.task);
    await tick();
    bad.fail(new Error('boom'));
    await expect(pBad).rejects.toThrow('boom');
    await tick();
    expect(log).toEqual(['start bad', 'start next']);
    next.finish();
    await expect(pNext).resolves.toBe('next');
    await expect(s.run('tab:1', () => { throw new Error('sync'); })).rejects.toThrow('sync');
    await expect(s.run('tab:1', async () => 'still works')).resolves.toBe('still works');
  });

  it('cancels only the tasks that have not started', async () => {
    const log: string[] = [];
    const s = new Scheduler(6);
    const running = controlled(log, 'running');
    const waiting = controlled(log, 'waiting');
    const pRunning = s.run('tab:1', running.task);
    const pWaiting = s.run('tab:1', waiting.task);
    await tick();
    const caught = pWaiting.catch((e: Error) => e.message);
    expect(s.cancelPending(new Error('stopped'))).toBe(1);
    expect(await caught).toBe('stopped');
    running.finish();
    await expect(pRunning).resolves.toBe('running');
    expect(log).toEqual(['start running']);
  });

  it('serializes a burst of tasks per lane while lanes overlap', async () => {
    const s = new Scheduler(6);
    const active = new Map<string, number>();
    let overlapInLane = false;
    let maxTotal = 0;
    const work = (lane: string) => async () => {
      active.set(lane, (active.get(lane) ?? 0) + 1);
      if (active.get(lane)! > 1) overlapInLane = true;
      maxTotal = Math.max(maxTotal, [...active.values()].reduce((x, y) => x + y, 0));
      await new Promise((r) => setTimeout(r, 3));
      active.set(lane, active.get(lane)! - 1);
    };
    await Promise.all(Array.from({ length: 60 }, (_, i) => s.run(`tab:${i % 4}`, work(`tab:${i % 4}`))));
    expect(overlapInLane).toBe(false);
    expect(maxTotal).toBeGreaterThan(1);
    expect(maxTotal).toBeLessThanOrEqual(4);
  });
});

describe('agent identity', () => {
  it('shows a short readable label per kind of id', () => {
    expect(agentLabel('local:claude-code')).toBe('claude-code');
    expect(agentLabel('ChatGPT#9f8e7d6c')).toBe('ChatGPT');
    expect(agentLabel('default')).toBe('AI');
    expect(agentLabel('a-very-long-agent-name-indeed')).toHaveLength(14);
    expect(agentLabel('  ')).toBe('agent');
  });

  it('gives an agent the same colour every time and avoids colours in use', () => {
    expect(pickColor('ChatGPT#1', [])).toBe(pickColor('ChatGPT#1', []));
    const first = pickColor('x', []);
    const second = pickColor('x', [first]);
    expect(second).not.toBe(first);
    const used = GROUP_COLORS.slice(0, 8);
    expect(used).not.toContain(pickColor('y', used));
    expect(GROUP_COLORS).toContain(pickColor('y', [...GROUP_COLORS])); // all taken: still a valid colour
  });
});

describe('tool catalog for agents', () => {
  it('has the new tools with strict schemas', () => {
    for (const name of ['browser_find', 'browser_extract', 'browser_pdf', 'browser_emulate', 'browser_cookies', 'browser_history', 'browser_windows', 'browser_select_text', 'browser_clipboard']) {
      const tool = TOOL_BY_NAME.get(name)!;
      expect(tool, name).toBeDefined();
      expect((tool.inputSchema as { additionalProperties: boolean }).additionalProperties).toBe(false);
    }
  });

  it('marks pure reads read-only and everything that changes state as not', () => {
    for (const name of ['browser_snapshot', 'browser_find', 'browser_extract', 'browser_history', 'browser_get_text', 'browser_screenshot']) {
      expect(TOOL_BY_NAME.get(name)!.readOnly, name).toBe(true);
    }
    for (const name of ['browser_click', 'browser_type', 'browser_cookies', 'browser_emulate', 'browser_windows', 'browser_pdf', 'browser_clipboard']) {
      expect(TOOL_BY_NAME.get(name)!.readOnly, name).toBe(false);
    }
  });

  it('lets every tab-bound tool take a tabId', () => {
    for (const name of ['browser_snapshot', 'browser_click', 'browser_find', 'browser_extract', 'browser_pdf', 'browser_emulate', 'browser_wait_for']) {
      expect((TOOL_BY_NAME.get(name)!.inputSchema as { properties: Record<string, unknown> }).properties.tabId, name).toBeDefined();
    }
  });
});
