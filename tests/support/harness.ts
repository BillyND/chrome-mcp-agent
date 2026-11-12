// Shared plumbing for the end-to-end suites: a real Chromium with the extension loaded and
// signed in, the fixture sites, and MCP tool calls exactly as an AI client sends them.

import { chromium, expect, type BrowserContext, type Worker } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cloudCall, refOf } from '../fixtures/helpers';
import { FIXTURE_PORT, startFixtures } from '../fixtures/server.mjs';
import { autoApprove } from './prompts';

export const SITE_A = `http://localhost:${FIXTURE_PORT}`;

export const GATEWAY = `http://localhost:${process.env.E2E_PORT ?? 8787}`;
export const DEVICE = 'e2e-device';
const EXT = path.resolve('extension/unpacked');

export { refOf };

/** One MCP tool call; `agent` selects which AI client the gateway says is calling. */
export const call = (name: string, args: Record<string, unknown> = {}, agent?: string) => cloudCall(GATEWAY, DEVICE, name, args, agent);

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
  /** Stops the stand-in user that approves confirmations (see startHarness). */
  stopApprover: () => void;
}

/**
 * Starts Chromium with the extension. By default a stand-in user clicks the approving button of every
 * on-page prompt (sensitive actions such as "Gửi" must be approved); pass `approve: false` to answer prompts in the test.
 */
export async function startHarness({ approve = true }: { approve?: boolean } = {}): Promise<Harness> {
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
  // A service worker cannot message itself: send "reconnect" from an extension page, like the popup does.
  {
    const page = await ctx.newPage();
    await page.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`);
    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'reconnect' }));
    await page.close();
  }
  await expect.poll(async () => (await call('browser_tabs', { action: 'list' })).isError ?? false, { timeout: 30_000 }).toBe(false);
  return { ctx, sw, fixtures, stopApprover: approve ? autoApprove(ctx, sw) : () => {} };
}

export async function stopHarness(h?: Harness) {
  h?.stopApprover();
  await h?.ctx.close();
  await h?.fixtures.close();
}
