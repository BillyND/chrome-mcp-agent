// End-to-end: real Chromium with the extension, the gateway under `wrangler dev`,
// and MCP tool calls exactly as ChatGPT sends them.

import { chromium, expect, test, type BrowserContext } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFixtures } from './fixtures/server.mjs';

const GATEWAY = 'http://localhost:8787';
const EMAIL = 'tester@example.com';
const EXT = path.resolve('extension/unpacked');

let ctx: BrowserContext;
let fixtures: { url: string; close: () => Promise<unknown> };
let rpcId = 0;

interface ToolResult {
  content: Array<{ type: string; text?: string; data?: string }>;
  isError?: boolean;
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult & { text: string }> {
  const res = await fetch(`${GATEWAY}/dev/mcp?email=${encodeURIComponent(EMAIL)}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
  });
  const raw = await res.text();
  const dataLine = raw.split('\n').find((l) => l.startsWith('data: ')) ?? raw;
  const msg = JSON.parse(dataLine.replace(/^data: /, ''));
  if (msg.error) throw new Error(`${name}: ${JSON.stringify(msg.error)}`);
  const result = msg.result as ToolResult;
  const text = result.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  return { ...result, text };
}

/** Finds the ref of the first snapshot line containing `label` (and optionally a role). */
function refOf(snapshot: string, label: string, role?: string): string {
  const line = snapshot.split('\n').find((l) => l.includes(label) && /\[ref=/.test(l) && (!role || l.includes(`- ${role}`)));
  const m = line && /ref=(f?\d*e\d+)/.exec(line);
  if (!m) throw new Error(`No ref for ${role ?? ''} "${label}" in snapshot:\n${snapshot}`);
  return m[1];
}

test.beforeAll(async () => {
  fixtures = await startFixtures();
  const token = await (await fetch(`${GATEWAY}/dev/token?email=${encodeURIComponent(EMAIL)}`)).text();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cma-e2e-'));
  ctx = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    viewport: { width: 1280, height: 900 },
  });
  let [sw] = ctx.serviceWorkers();
  sw ??= await ctx.waitForEvent('serviceworker');
  await sw.evaluate(async (t) => {
    await chrome.storage.local.set({ account: { token: t, email: 'tester@example.com', name: 'Tester' } });
  }, token);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  // Playwright auto-dismisses dialogs unless someone listens; leave them to the agent.
  ctx.on('page', (p) => p.on('dialog', () => {}));
  page.on('dialog', () => {});
  await page.goto(fixtures.url);
  // Reconnect with the stored account (the popup's "reconnect" message does the same).
  await sw.evaluate(() => chrome.runtime.sendMessage({ type: 'reconnect' }).catch(() => {}));
  await expect.poll(async () => (await call('browser_tabs', { action: 'list' })).isError ?? false, { timeout: 30_000 }).toBe(false);
});

test.afterAll(async () => {
  await ctx?.close();
  await fixtures?.close();
});

test('controls the page, shadow DOM, and iframes across origins', async () => {
  const tabs = await call('browser_tabs', { action: 'list' });
  const tabId = Number(/\[(\d+)\] Fixture Home/.exec(tabs.text)?.[1]);
  expect(tabId).toBeGreaterThan(0);
  await call('browser_tabs', { action: 'select', tabId });

  let snap = (await call('browser_snapshot')).text;
  expect(snap).toContain('heading "Trang thử nghiệm"');
  expect(snap).toContain('Form trong iframe'); // cross-origin frame content is inlined
  expect(snap).toContain('Nút lồng'); // nested frame inside the cross-origin frame
  expect(snap).toContain('Nút trong shadow'); // closed shadow root

  // Click
  let r = await call('browser_click', { element: 'Tăng', ref: refOf(snap, 'Tăng', 'button') });
  expect(r.isError).toBeFalsy();
  expect(r.text).toContain('Đếm: 1');
  await ctx.pages()[0].screenshot({ path: 'test-results/overlay.png' });
  expect(await ctx.pages()[0].locator('chrome-mcp-agent-overlay').count()).toBe(1);

  // Type Vietnamese text
  r = await call('browser_type', { element: 'Họ tên', ref: refOf(snap, 'Họ tên', 'textbox'), text: 'Nguyễn Văn Á' });
  expect(r.text).toContain('value="Nguyễn Văn Á"');

  // Contenteditable
  r = await call('browser_type', { element: 'Soạn thảo', ref: refOf(snap, 'Soạn thảo', 'textbox'), text: 'Dòng một' });
  expect(r.text).toContain('Dòng một');

  // Form: select + checkbox
  r = await call('browser_fill_form', {
    fields: [
      { ref: refOf(snap, 'Thành phố', 'combobox'), value: 'Hồ Chí Minh' },
      { ref: refOf(snap, 'Đồng ý điều khoản', 'checkbox'), value: true },
    ],
  });
  expect(r.isError).toBeFalsy();
  expect(r.text).toContain('value="Hồ Chí Minh"');
  expect(r.text).toMatch(/checkbox "Đồng ý điều khoản" \[checked/);

  // Closed shadow DOM
  r = await call('browser_click', { ref: refOf(snap, 'Nút trong shadow', 'button') });
  expect(r.text).toContain('Shadow OK');

  // Same-origin iframe
  r = await call('browser_click', { ref: refOf(snap, 'Nút cùng nguồn', 'button') });
  expect(r.text).toContain('Cùng nguồn OK');

  // Cross-origin iframe: type and submit
  snap = r.text;
  const emailRef = refOf(snap, 'Email trong iframe', 'textbox');
  expect(emailRef).toMatch(/^f\d+e\d+$/);
  r = await call('browser_type', { element: 'Email trong iframe', ref: emailRef, text: 'ban@vidu.vn' });
  r = await call('browser_click', { ref: refOf(r.text, 'Gửi iframe', 'button') });
  expect(r.text).toContain('Đã gửi: ban@vidu.vn');

  // Nested iframe (localhost inside 127.0.0.1 inside localhost)
  r = await call('browser_click', { ref: refOf(r.text, 'Nút lồng', 'button') });
  expect(r.text).toContain('Lồng OK');

  // Keyboard shortcut reaches the page
  await call('browser_click', { ref: refOf(r.text, 'Tăng', 'button') });
  r = await call('browser_press_key', { key: 'Shift+ArrowDown' });
  expect(r.text).toContain('Phím: Shift+ArrowDown');

  // JS dialog
  r = await call('browser_click', { ref: refOf(r.text, 'Hỏi xác nhận', 'button') });
  expect(r.text).toContain('confirm dialog is open');
  r = await call('browser_handle_dialog', { accept: true });
  expect(r.text).toContain('Xác nhận: có');

  // HTML5 drag and drop
  r = await call('browser_drag', { startRef: refOf(r.text, 'Kéo tôi'), endRef: refOf(r.text, 'Vùng thả') });
  expect(r.text).toContain('Đã thả: drag');

  // File upload from base64
  r = await call('browser_file_upload', {
    ref: refOf(r.text, 'Chọn file'),
    files: [{ name: 'ghi-chu.txt', mimeType: 'text/plain', base64: Buffer.from('xin chào').toString('base64') }],
  });
  expect(r.isError).toBeFalsy();
  r = await call('browser_get_text');
  expect(r.text).toContain('File: ghi-chu.txt = xin chào');

  // Evaluate in the top page and inside the cross-origin frame
  r = await call('browser_evaluate', { script: 'document.title' });
  expect(r.text).toContain('"Fixture Home"');
  r = await call('browser_evaluate', { script: 'return element.value + " @ " + location.origin', ref: emailRef });
  expect(r.text).toContain('ban@vidu.vn @ http://127.0.0.1:4101');

  // Scroll and wait
  r = await call('browser_scroll', { direction: 'down', amount: 1500 });
  expect(r.text).toMatch(/Now at \d+px/);
  r = await call('browser_wait_for', { text: 'Đáy trang', timeout: 5 });
  expect(r.isError).toBeFalsy();

  // Screenshot
  const shot = await call('browser_screenshot');
  expect(shot.content.some((c) => c.type === 'image' && (c.data?.length ?? 0) > 1000)).toBe(true);
  const fullShot = await call('browser_screenshot', { fullPage: true });
  expect(fullShot.content.some((c) => c.type === 'image')).toBe(true);

  // Navigation, then network capture of that navigation
  r = await call('browser_navigate', { url: 'http://127.0.0.1:4101/cross.html' });
  expect(r.text).toContain('Form trong iframe');
  r = await call('browser_network_requests', { filter: 'nested.html' });
  expect(r.text).toContain('nested.html');
  r = await call('browser_navigate', { action: 'back' });
  expect(r.text).toContain('Trang thử nghiệm');

  // Bad refs give actionable errors
  r = await call('browser_click', { ref: 'e99999' });
  expect(r.isError).toBe(true);
  expect(r.text).toContain('new browser_snapshot');
});

test('Stop pauses the agent until resumed', async () => {
  const [sw] = ctx.serviceWorkers();
  // Drive the same messages the popup and the in-page Stop button send.
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`);
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'stop' }));
  let r = await call('browser_snapshot');
  expect(r.isError).toBe(true);
  expect(r.text).toContain('pressed Stop');
  await expect(popup.locator('#paused-card')).toBeVisible();
  await popup.setViewportSize({ width: 360, height: 640 });
  await popup.screenshot({ path: 'test-results/popup.png' });
  await popup.locator('#resume').click();
  await expect(popup.locator('#paused-card')).toBeHidden();
  await popup.close();
  r = await call('browser_snapshot');
  expect(r.isError, r.text).toBeFalsy();
});

test('reconnects after the connection drops', async () => {
  const [sw] = ctx.serviceWorkers();
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`);
  // Force-drop: "reconnect" closes the socket and opens a new one, like a network blip.
  for (let i = 0; i < 3; i++) await page.evaluate(() => chrome.runtime.sendMessage({ type: 'reconnect' }));
  const r = await call('browser_tabs', { action: 'list' });
  expect(r.isError).toBeFalsy();
  await expect(page.locator('#status-text')).toHaveText('Đã kết nối', { timeout: 15_000 });
  await page.close();
});
