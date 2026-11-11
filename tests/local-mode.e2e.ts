// End-to-end for local mode: the bundled local MCP server (spawned like an AI
// client would, speaking MCP over stdio), the extension in real Chromium, and
// the cloud gateway at the same time.

import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { TOOLS } from '../shared/tools';
import { cloudCall, refOf } from './fixtures/helpers';
import { StdioMcpClient } from './fixtures/mcp-stdio-client';
import { startFixtures } from './fixtures/server.mjs';

const GATEWAY = `http://localhost:${process.env.E2E_PORT ?? 8787}`;
const LOCAL_PORT = Number(process.env.HELMSMAN_PORT ?? 47821);
/** The protocol tests use their own server so they never touch the port Chromium's extension is dialling. */
const PROTO_PORT = LOCAL_PORT + 1;
const DEVICE = 'e2e-local-device';
const EXT = path.resolve('extension/unpacked');

// ---------------------------------------------------------------------------
// The wire protocol, with a fake extension standing in for Chrome.

/** Stand-in for the extension: connects like it does and queues the messages it receives. */
class FakeExtension {
  inbox: Array<Record<string, unknown>> = [];
  private waiting: Array<(m: Record<string, unknown>) => void> = [];
  closeCode?: number;
  private constructor(readonly ws: WebSocket) {
    ws.on('message', (d) => {
      const text = d.toString();
      if (text === 'pong') return;
      const msg = JSON.parse(text);
      const w = this.waiting.shift();
      if (w) w(msg);
      else this.inbox.push(msg);
    });
    ws.on('close', (code) => (this.closeCode = code));
  }

  /** Dials the server the extension does (an empty origin sends none), retrying while the server process is still starting. */
  static async connect(port: number, origin = 'chrome-extension://fakeextensionid', pathname = ''): Promise<FakeExtension> {
    for (let attempt = 0; ; attempt++) {
      try {
        const ws = new WebSocket(`ws://127.0.0.1:${port}${pathname}`, 'cma.v1', { ...(origin ? { origin } : {}) });
        await new Promise<void>((resolve, reject) => {
          ws.once('open', () => resolve());
          ws.once('error', reject);
          ws.once('unexpected-response', (_req, res) => reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { statusCode: res.statusCode })));
        });
        return new FakeExtension(ws);
      } catch (e) {
        if ((e as { statusCode?: number }).statusCode || attempt > 40) throw e;
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  }

  next(): Promise<Record<string, unknown>> {
    const queued = this.inbox.shift();
    return queued ? Promise.resolve(queued) : new Promise((resolve) => this.waiting.push(resolve));
  }

  send(msg: unknown) {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
}

test.describe('local server protocol', () => {
  test.describe.configure({ mode: 'serial' });
  let a: StdioMcpClient;
  let b: StdioMcpClient;

  test.beforeAll(async () => {
    a = new StdioMcpClient('proto-a', PROTO_PORT);
    b = new StdioMcpClient('proto-b', PROTO_PORT);
    await a.initialize();
    await b.initialize();
  });
  test.afterAll(async () => {
    await Promise.all([a?.close(), b?.close()]);
  });

  test('only the extension origin may connect', async () => {
    await expect(FakeExtension.connect(PROTO_PORT, 'http://evil.example')).rejects.toMatchObject({ statusCode: 403 });
    await expect(FakeExtension.connect(PROTO_PORT, '')).rejects.toMatchObject({ statusCode: 403 });
    // Web pages cannot join as a peer either; peers are Node processes without an Origin.
    await expect(FakeExtension.connect(PROTO_PORT, 'chrome-extension://fakeextensionid', '/peer')).rejects.toMatchObject({ statusCode: 403 });
    const ext = await FakeExtension.connect(PROTO_PORT);
    ext.ws.close();
  });

  test('forwards calls with the agent id, reassembles chunked results and answers pings', async () => {
    const ext = await FakeExtension.connect(PROTO_PORT);
    ext.send('ping');
    const pong = new Promise((resolve) => ext.ws.once('message', (d) => resolve(d.toString())));
    expect(await pong).toBe('pong');

    // Called from the process that owns the port...
    const own = a.call('browser_tabs', { action: 'list' });
    const msgA = await ext.next();
    expect(msgA).toMatchObject({ type: 'call', tool: 'browser_tabs', args: { action: 'list' }, agent: 'local:proto-a' });
    const big = 'x'.repeat(900);
    const raw = JSON.stringify({ type: 'result', id: msgA.id, content: [{ type: 'text', text: big }] });
    const third = Math.ceil(raw.length / 3);
    for (let i = 0; i < 3; i++) ext.send({ type: 'chunk', id: msgA.id, index: i, total: 3, data: raw.slice(i * third, (i + 1) * third) });
    expect((await own).text).toBe(big);

    // ...and from a second process, which shares the same extension connection.
    const peer = b.call('browser_snapshot');
    const msgB = await ext.next();
    expect(msgB).toMatchObject({ type: 'call', tool: 'browser_snapshot', agent: 'local:proto-b' });
    ext.send({ type: 'result', id: msgB.id, content: [{ type: 'text', text: 'from peer' }], isError: false });
    expect((await peer).text).toBe('from peer');
    ext.ws.close();
  });

  test('a newer extension connection replaces the older one and interrupts its calls', async () => {
    const first = await FakeExtension.connect(PROTO_PORT);
    const pending = a.call('browser_click', { ref: 'e1' });
    await first.next();
    const second = await FakeExtension.connect(PROTO_PORT);
    await expect.poll(() => first.closeCode).toBe(4000);
    const r = await pending;
    expect(r.isError).toBe(true);
    expect(r.text).toContain('Chrome reconnected');
    // The new connection serves later calls.
    const next = b.call('browser_tabs', { action: 'list' });
    const msg = await second.next();
    second.send({ type: 'result', id: msg.id, content: [{ type: 'text', text: 'ok' }] });
    expect((await next).text).toBe('ok');
    second.ws.close();
  });

  test('exposes exactly the cloud tool catalog', async () => {
    expect((await a.listTools()).map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
  });
});

// ---------------------------------------------------------------------------
// The real extension in Chromium.

test.describe('local mode in Chromium', () => {
  test.describe.configure({ mode: 'serial' });
  let ctx: BrowserContext;
  let fixtures: { url: string; close: () => Promise<unknown> };
  let popup: Page;
  let extOrigin: string;
  const clients: StdioMcpClient[] = [];
  const cloud = (name: string, args: Record<string, unknown> = {}) => cloudCall(GATEWAY, DEVICE, name, args);
  const client = (name: string) => {
    const c = new StdioMcpClient(name, LOCAL_PORT);
    clients.push(c);
    return c;
  };
  const localStatus = () => popup.locator('#local-status');

  test.beforeAll(async () => {
    fixtures = await startFixtures();
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cma-e2e-local-'));
    ctx = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--window-size=1280,800'],
      viewport: null,
    });
    let [sw] = ctx.serviceWorkers();
    sw ??= await ctx.waitForEvent('serviceworker');
    extOrigin = new URL(sw.url()).host;
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    page.on('dialog', () => {});
    await page.goto(fixtures.url);
    popup = await ctx.newPage();
    await popup.goto(`chrome-extension://${extOrigin}/popup.html`);
  });

  test.afterAll(async () => {
    await Promise.all(clients.map((c) => c.close()));
    await ctx?.close();
    await fixtures?.close();
  });

  test('local mode works without a cloud account: waits for the server, then connects', async () => {
    // No account yet: the popup still offers the cloud Connect button, but nothing forces the user to click it.
    await expect(popup.locator('#login')).toBeVisible();
    await popup.locator('#local-enabled').click();
    await expect(localStatus()).toHaveAttribute('data-status', 'connecting');
    await expect(localStatus()).toContainText('Waiting for local server');

    const a = client('e2e-a');
    await a.initialize();
    await expect(localStatus()).toHaveAttribute('data-status', 'connected', { timeout: 20_000 });
    await expect(popup.locator('#status-text')).toHaveText('Connected');
    await expect(popup.locator('#local-config')).toContainText('helmsman-mcp');
    await popup.setViewportSize({ width: 360, height: 420 });
    await popup.screenshot({ path: 'test-results/popup-local.png' });
  });

  test('an MCP client drives the page: snapshot, click and type inside a cross-origin iframe', async () => {
    const a = clients[0];
    expect((await a.listTools()).map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
    const tabs = await a.call('browser_tabs', { action: 'list' });
    const tabId = Number(/\[(\d+)\] Fixture Home/.exec(tabs.text)?.[1]);
    expect(tabId).toBeGreaterThan(0);
    await a.call('browser_tabs', { action: 'select', tabId });

    let r = await a.call('browser_snapshot');
    expect(r.text).toContain('Form trong iframe');
    r = await a.call('browser_click', { element: 'Tăng', ref: refOf(r.text, 'Tăng', 'button') });
    expect(r.text).toContain('Đếm: 1');

    const emailRef = refOf(r.text, 'Email trong iframe', 'textbox');
    expect(emailRef).toMatch(/^f\d+e\d+$/);
    r = await a.call('browser_type', { element: 'Email trong iframe', ref: emailRef, text: 'local@vidu.vn' });
    r = await a.call('browser_click', { ref: refOf(r.text, 'Gửi iframe', 'button') });
    expect(r.text).toContain('Đã gửi: local@vidu.vn');
  });

  test('two local clients work at the same time through one extension connection', async () => {
    const [a] = clients;
    const b = client('e2e-b');
    await b.initialize();
    const [sa, sb] = await Promise.all([a.call('browser_snapshot'), b.call('browser_snapshot')]);
    expect(sa.isError, sa.text).toBeFalsy();
    expect(sb.isError, sb.text).toBeFalsy();
    expect(sb.text).toContain('Trang thử nghiệm');
    // B acts, A sees the effect.
    const r = await b.call('browser_click', { ref: refOf(sb.text, 'Tăng', 'button') });
    expect(r.text).toContain('Đếm: 2');
    expect((await a.call('browser_snapshot')).text).toContain('Đếm: 2');
  });

  test('the extension serves the cloud and the local server at once, each call answered on its own endpoint', async () => {
    const token = await (await fetch(`${GATEWAY}/dev/token?device=${DEVICE}`)).text();
    const [sw] = ctx.serviceWorkers();
    await sw.evaluate((t) => chrome.storage.local.set({ account: { token: t, code: 'E2E00-00000' } }), token);
    await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'reconnect' }));
    await expect.poll(async () => (await cloud('browser_tabs', { action: 'list' })).isError ?? false, { timeout: 30_000 }).toBe(false);
    await expect(popup.locator('#signed-in')).toBeVisible();
    await expect(localStatus()).toHaveAttribute('data-status', 'connected');

    const [a, b] = clients;
    const results = await Promise.all([
      cloud('browser_tabs', { action: 'list' }),
      a.call('browser_tabs', { action: 'list' }),
      b.call('browser_tabs', { action: 'list' }),
      cloud('browser_snapshot'),
      a.call('browser_snapshot'),
    ]);
    for (const r of results) {
      expect(r.isError, r.text).toBeFalsy();
      expect(r.text).toContain('Fixture Home');
    }
  });

  test('restarting the local server: a waiting client takes over and the extension reconnects', async () => {
    const [a, b] = clients;
    await a.kill(); // the process that owned the port goes away
    // b's call waits for the new owner (itself) and the extension to come back.
    const r = await b.call('browser_tabs', { action: 'list' });
    expect(r.isError, r.text).toBeFalsy();
    await expect(localStatus()).toHaveAttribute('data-status', 'connected', { timeout: 20_000 });
    // The cloud endpoint never noticed.
    expect((await cloud('browser_tabs', { action: 'list' })).isError).toBeFalsy();

    // Everything goes away, then a brand-new server starts.
    await b.kill();
    await expect(localStatus()).toHaveAttribute('data-status', 'connecting', { timeout: 20_000 });
    const c = client('e2e-c');
    await c.initialize();
    const again = await c.call('browser_tabs', { action: 'list' });
    expect(again.isError, again.text).toBeFalsy();
    await expect(localStatus()).toHaveAttribute('data-status', 'connected', { timeout: 20_000 });
  });

  test('turning local mode off disconnects it while the cloud keeps working', async () => {
    await popup.locator('#local-enabled').click();
    await expect(localStatus()).toHaveCount(0);
    await expect(popup.locator('#local-enabled')).toHaveAttribute('aria-checked', 'false');
    expect((await cloud('browser_tabs', { action: 'list' })).isError).toBeFalsy();
    await expect(popup.locator('#status-text')).toHaveText('Connected');
  });
});
