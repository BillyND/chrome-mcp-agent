// Shared plumbing for the end-to-end suites: a real Chromium with the extension loaded and
// signed in, the fixture sites, and MCP tool calls exactly as an AI client sends them.

import { chromium, expect, type BrowserContext, type Worker } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFixtures } from '../fixtures/server.mjs';

export const GATEWAY = `http://localhost:${process.env.E2E_PORT ?? 8787}`;
export const DEVICE = 'e2e-device';
const EXT = path.resolve('extension/unpacked');

export interface ToolResult {
  content: Array<{ type: string; text?: string; data?: string }>;
  isError?: boolean;
}

let rpcId = 0;

/** One MCP tool call; `agent` selects which AI client the gateway says is calling. */
export async function call(name: string, args: Record<string, unknown> = {}, agent?: string): Promise<ToolResult & { text: string }> {
  const query = new URLSearchParams({ device: DEVICE, ...(agent ? { agent } : {}) });
  const res = await fetch(`${GATEWAY}/dev/mcp?${query}`, {
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
export function jpegSize(b64: string): { width: number; height: number } {
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
export function refOf(snapshot: string, label: string, role?: string): string {
  const line = snapshot.split('\n').find((l) => l.includes(label) && /\[ref=/.test(l) && (!role || l.includes(`- ${role}`)));
  const m = line && /ref=(f?\d*e\d+)/.exec(line);
  if (!m) throw new Error(`No ref for ${role ?? ''} "${label}" in snapshot:\n${snapshot}`);
  return m[1];
}

/** Tab id from a result's "Tab 12" or "Opened tab 12" text. */
export function tabIdOf(text: string): number {
  const m = /(?:Tab|tab) (\d+)/.exec(text);
  if (!m) throw new Error(`No tab id in: ${text}`);
  return Number(m[1]);
}

export interface Harness {
  ctx: BrowserContext;
  sw: Worker;
  fixtures: { url: string; close: () => Promise<unknown> };
}

export async function startHarness(): Promise<Harness> {
  const fixtures = await startFixtures();
  const token = await (await fetch(`${GATEWAY}/dev/token?device=${DEVICE}`)).text();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cma-e2e-'));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
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
  return { ctx, sw, fixtures };
}

export async function stopHarness(h?: Harness) {
  await h?.ctx.close();
  await h?.fixtures.close();
}
