// End-to-end: real Chromium with the extension, the gateway under `wrangler dev`,
// and MCP tool calls exactly as ChatGPT sends them.

import { chromium, expect, request as http, test, type BrowserContext } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFixtures } from './fixtures/server.mjs';

const GATEWAY = 'http://localhost:8787';
const DEVICE = 'e2e-device';
const EXT = path.resolve('extension/unpacked');

let ctx: BrowserContext;
let fixtures: { url: string; close: () => Promise<unknown> };
let rpcId = 0;

interface ToolResult {
  content: Array<{ type: string; text?: string; data?: string }>;
  isError?: boolean;
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult & { text: string }> {
  const res = await fetch(`${GATEWAY}/dev/mcp?device=${DEVICE}`, {
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

/** Width and height from a base64 JPEG's SOF marker. */
function jpegSize(b64: string): { width: number; height: number } {
  const b = Buffer.from(b64, 'base64');
  for (let i = 2; i < b.length; ) {
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc2) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  throw new Error('not a JPEG');
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
  const token = await (await fetch(`${GATEWAY}/dev/token?device=${DEVICE}`)).text();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cma-e2e-'));
  ctx = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    // Retina like most Macs (a real scale factor, not Playwright's emulation): screenshots must still be in CSS pixels.
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--force-device-scale-factor=2', '--window-size=1280,800'],
    viewport: null, // real window metrics, no Playwright emulation layered over the extension's debugger
  });
  let [sw] = ctx.serviceWorkers();
  sw ??= await ctx.waitForEvent('serviceworker');
  await sw.evaluate(async (t) => {
    await chrome.storage.local.set({ account: { token: t, code: 'E2E00-00000' } });
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

test('canvas apps: Google-Sheets-like grid and paint canvas inside nested iframes', async () => {
  await call('browser_navigate', { url: 'http://localhost:4100/sheet-host.html' });
  let snap = (await call('browser_snapshot')).text;
  const grid = refOf(snap, 'size=600x264', 'canvas');
  expect(grid).toMatch(/^f\d+e\d+$/); // inside the cross-origin iframe
  const paint = refOf(snap, 'size=400x140', 'canvas'); // inside the nested iframe
  expect(paint).not.toBe(grid);

  // Viewport screenshot is in CSS pixels and says how to use it.
  const shot = await call('browser_screenshot');
  const [, vw, vh] = /Viewport (\d+)x(\d+) px/.exec(shot.text)!;
  expect(Number(vw)).toBeGreaterThan(1000);
  expect(jpegSize(shot.content.find((c) => c.type === 'image')!.data!)).toEqual({ width: Number(vw), height: Number(vh) });

  // Select cell C4 (column C = x 300..400, row 4 = y 96..120 on the grid canvas) and type like a user.
  let r = await call('browser_mouse_xy', { ref: grid, x: 350, y: 108 });
  expect(r.text).toContain('Chọn ô C4');
  r = await call('browser_type', { text: 'Xin chào Sheets', submit: true });
  expect(r.text).toContain('Đã ghi C4 = Xin chào Sheets');
  // Enter moved the selection down: keep typing.
  r = await call('browser_type', { text: '12345', submit: true });
  expect(r.text).toContain('Đã ghi C5 = 12345');

  // Element screenshot coordinates map to the same ref.
  const cell = await call('browser_screenshot', { ref: grid });
  expect(cell.text).toContain(`ref "${grid}"`);

  // Paint canvas in the nested iframe: click and drag in element coordinates.
  r = await call('browser_mouse_xy', { ref: paint, x: 40, y: 30 });
  // Within a pixel: frames sit at fractional offsets and Retina rounds to device pixels.
  const [px, py] = /Vẽ tại (\d+),(\d+)/.exec(r.text)!.slice(1).map(Number);
  expect(Math.abs(px - 40)).toBeLessThanOrEqual(1);
  expect(Math.abs(py - 30)).toBeLessThanOrEqual(1);
  r = await call('browser_mouse_xy', { ref: paint, action: 'drag', x: 20, y: 20, toX: 300, toY: 110 });
  const drag = /Kéo từ (\d+),(\d+) đến (\d+),(\d+)/.exec(r.text)!.slice(1).map(Number);
  [20, 20, 300, 110].forEach((v, i) => expect(Math.abs(drag[i] - v)).toBeLessThanOrEqual(1));

  // Raw viewport coordinates work too (top page heading area).
  r = await call('browser_mouse_xy', { x: 5, y: 5 });
  expect(r.isError).toBeFalsy();
  r = await call('browser_mouse_xy', { x: 99999, y: 5 });
  expect(r.isError).toBe(true);
  await call('browser_navigate', { url: fixtures.url });
});

test('Turning the control switch off pauses the agent until it is turned back on', async () => {
  const [sw] = ctx.serviceWorkers();
  // Drive the same messages the popup and the in-page Stop button send.
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`);
  const allow = popup.locator('#enabled');
  await expect(allow).toHaveAttribute('aria-checked', 'true');
  await allow.click();
  await expect(allow).toHaveAttribute('aria-checked', 'false');
  let r = await call('browser_snapshot');
  expect(r.isError).toBe(true);
  expect(r.text).toContain('pressed Stop');
  await expect(popup.locator('#status-text')).toHaveText('Paused');
  await popup.setViewportSize({ width: 360, height: 640 });
  await popup.screenshot({ path: 'test-results/popup.png' });
  await allow.click();
  await expect(allow).toHaveAttribute('aria-checked', 'true');
  await expect(popup.locator('#status-text')).toHaveText('Connected');
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
  expect(r.isError, r.text).toBeFalsy();
  await expect(page.locator('#status-text')).toHaveText('Connected', { timeout: 15_000 });
  await page.close();
});

test('ChatGPT connects with the connection code shown in the extension', async () => {
  const [sw] = ctx.serviceWorkers();
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`);
  // A fresh device: sign the e2e account out, then connect from the popup like a user would.
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'logout' }));
  await expect(popup.locator('#signed-in')).toBeHidden();
  await popup.locator('#login').click();
  await expect(popup.locator('#code')).not.toHaveText('E2E00-00000', { timeout: 15_000 });
  await expect(popup.locator('#code')).toHaveText(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/, { timeout: 15_000 });
  await expect(popup.locator('#status-text')).toHaveText('Connected', { timeout: 15_000 });
  const code = (await popup.locator('#code').textContent())!;
  await popup.setViewportSize({ width: 360, height: 600 });
  await popup.screenshot({ path: 'test-results/popup-code.png' });

  // The ChatGPT side: dynamic registration, consent page with the code, token exchange, tool call.
  // A fresh client IP per run so the wrong-code limiter (per IP, 10 minutes) starts from zero.
  const api = await http.newContext({ baseURL: GATEWAY, extraHTTPHeaders: { 'cf-connecting-ip': `10.0.${Date.now() % 250}.${Math.floor(Math.random() * 250)}` } });
  const redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect';
  const reg = await (await api.post('/oauth/register', {
    data: { client_name: 'ChatGPT', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] },
  })).json();
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const resource = `${GATEWAY}/mcp`;
  const query = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: redirectUri, state: 's1', code_challenge: challenge, code_challenge_method: 'S256', scope: 'browser', resource });
  const consent = await (await api.get(`/authorize?${query}`)).text();
  expect(consent).toContain('Mã kết nối');
  const handle = /name="handle" value="([^"]+)"/.exec(consent)![1];

  const wrong = await api.post('/authorize', { form: { handle, decision: 'approve', code: 'AAAAA-AAAAA', client_name: 'ChatGPT' }, maxRedirects: 0 });
  expect(wrong.status()).toBe(400);
  expect(await wrong.text()).toContain('Mã kết nối không đúng');

  const ok = await api.post('/authorize', { form: { handle, decision: 'approve', code: code.toLowerCase().replace('-', ' ') }, maxRedirects: 0 });
  expect(ok.status()).toBe(302);
  const back = new URL(ok.headers()['location']);
  expect(back.origin + back.pathname).toBe(redirectUri);
  const tokens = await (await api.post('/oauth/token', {
    form: { grant_type: 'authorization_code', code: back.searchParams.get('code')!, redirect_uri: redirectUri, client_id: reg.client_id, code_verifier: verifier, resource },
  })).json();
  expect(tokens.access_token).toBeTruthy();

  const res = await api.post('/mcp', {
    headers: { authorization: `Bearer ${tokens.access_token}`, accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'browser_tabs', arguments: { action: 'list' } } },
  });
  const raw = await res.text();
  expect(raw).toContain('Fixture Home');
  expect(raw).not.toContain('"isError":true');

  // Disconnecting the Chrome revokes what ChatGPT was given.
  await popup.locator('#logout').click();
  await expect(popup.locator('#login')).toBeVisible();
  const after = await api.post('/mcp', {
    headers: { authorization: `Bearer ${tokens.access_token}`, accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    data: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  });
  expect(after.status()).toBe(401);
  await api.dispose();
  await popup.close();
});
