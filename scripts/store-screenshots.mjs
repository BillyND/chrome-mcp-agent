// Generates the Chrome Web Store images into docs/store/screenshots: five 1280x800 screenshots and the
// 440x280 / 1400x560 promo tiles, from the real extension running against a local gateway.
//
//   E2E_PORT=8815 E2E_FIXTURE_PORT=4700 HELMSMAN_PORT=47915 node scripts/pack-extension.mjs --dev
//   E2E_PORT=8815 E2E_FIXTURE_PORT=4700 node --experimental-strip-types scripts/store-screenshots.mjs
//
// Starts `wrangler dev` itself when nothing answers on E2E_PORT and stops it again at the end.

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloudCall } from '../tests/fixtures/helpers.ts';
import { readPrompts, answerPrompt } from '../tests/support/prompts.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ext = path.join(root, 'extension/unpacked');
const outDir = path.join(root, 'docs/store/screenshots');
const port = process.env.E2E_PORT ?? '8815';
const gateway = `http://localhost:${port}`;
const demoPort = Number(process.env.E2E_FIXTURE_PORT ?? 4700) + 7;
const prodUrl = /"PUBLIC_URL"\s*:\s*"([^"]+)"/.exec(fs.readFileSync(path.join(root, 'worker/wrangler.jsonc'), 'utf8'))[1];
const DEVICE = 'store-shots';
const call = (name, args = {}) => cloudCall(gateway, DEVICE, name, args);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(outDir, { recursive: true });

// ---- gateway ------------------------------------------------------------------------------------
let wrangler;
const up = () => fetch(`${gateway}/health`).then((r) => r.ok, () => false);
if (!(await up())) {
  wrangler = spawn('npx', ['wrangler', 'dev', '--config', 'worker/wrangler.jsonc', '--port', port, '--ip', '127.0.0.1', '--var', `PUBLIC_URL:${gateway}`], { cwd: root, stdio: 'ignore' });
  for (let i = 0; i < 120 && !(await up()); i++) await sleep(1000);
  if (!(await up())) throw new Error('gateway did not start');
}

// ---- demo shop the agent "works on" --------------------------------------------------------------
const shop = http.createServer((_, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Northwind Outfitters - Checkout</title><style>
body{margin:0;font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;background:#f4f4f5;color:#18181b}
header{background:#fff;border-bottom:1px solid #e4e4e7;padding:16px 40px;font-weight:700;font-size:20px}
main{max-width:760px;margin:36px auto;display:grid;grid-template-columns:1fr 260px;gap:28px}
form,aside{background:#fff;border:1px solid #e4e4e7;border-radius:12px;padding:24px}
label{display:block;font-size:13px;font-weight:600;margin:14px 0 4px}input{width:100%;box-sizing:border-box;height:40px;border:1px solid #d4d4d8;border-radius:8px;padding:0 12px;font:inherit}
button{margin-top:22px;height:44px;width:100%;border:0;border-radius:8px;background:#18181b;color:#fff;font:600 15px inherit;font-family:inherit;cursor:pointer}
h1{font-size:22px;margin:0 0 4px}.row{display:flex;justify-content:space-between;margin:8px 0;font-size:14px}</style></head><body>
<header>Northwind Outfitters</header><main>
<form onsubmit="event.preventDefault()"><h1>Checkout</h1><span style="color:#71717a;font-size:14px">Shipping details</span>
<label for="n">Full name</label><input id="n" name="name" placeholder="Ada Lovelace">
<label for="e">Email</label><input id="e" name="email" placeholder="ada@example.com">
<label for="a">Address</label><input id="a" name="address" placeholder="12 Analytical Way">
<button id="go" type="submit">Place order</button></form>
<aside><b>Order summary</b><div class="row"><span>Trail jacket</span><span>$129.00</span></div><div class="row"><span>Wool socks x2</span><span>$24.00</span></div><hr><div class="row"><b>Total</b><b>$153.00</b></div></aside>
</main></body></html>`);
});
await new Promise((r) => shop.listen(demoPort, r));

// ---- browser with the extension --------------------------------------------------------------------
const token = await (await fetch(`${gateway}/dev/token?device=${DEVICE}`)).text();
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'cma-shots-')), {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--force-device-scale-factor=2', '--window-size=1280,800'],
  viewport: null,
});
const compose = await (await chromium.launch({ channel: 'chromium' })).newContext({ viewport: { width: 1280, height: 800 } });
const save = (name, buf) => fs.writeFileSync(path.join(outDir, name), buf);

try {
  let [sw] = ctx.serviceWorkers();
  sw ??= await ctx.waitForEvent('serviceworker');
  const extUrl = (file) => `chrome-extension://${new URL(sw.url()).host}/${file}`;
  await sw.evaluate(async (t) => {
    await chrome.storage.local.set({ account: { token: t, code: 'K7QX2-MN4PD' }, prefs: { lang: 'en', theme: 'light' } });
  }, token);
  await sw.evaluate(() => chrome.runtime.sendMessage({ type: 'reconnect' }).catch(() => {}));
  for (let i = 0; i < 60 && (await call('browser_tabs', { action: 'list' })).isError; i++) await sleep(500);

  const shopPage = ctx.pages()[0] ?? (await ctx.newPage());
  await shopPage.goto(`http://localhost:${demoPort}/`);
  const tabId = Number(/\[(\d+)\]/.exec((await call('browser_tabs', { action: 'list' })).text)[1]);
  await call('browser_tabs', { action: 'select', tabId, activate: true });
  const snap = (await call('browser_snapshot')).text;
  const ref = (label) => new RegExp(`${label}[^\\n]*\\[ref=(e\\d+)\\]`).exec(snap)[1];

  /** Frames a screenshot like a window on a soft background with a caption, at exactly 1280x800. */
  const framed = async (file, title, subtitle, image, { maxHeight = 600 } = {}) => {
    const page = await compose.newPage();
    await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;width:1280px;height:800px;overflow:hidden;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;background:linear-gradient(135deg,#fafafa,#e4e4e7);color:#18181b;display:flex;flex-direction:column;align-items:center;padding-top:48px}
h1{font-size:38px;letter-spacing:-.02em;margin:0 0 8px}p{margin:0 0 30px;font-size:19px;color:#52525b}
img{max-height:${maxHeight}px;max-width:1120px;border-radius:14px;box-shadow:0 24px 60px rgba(24,24,27,.28),0 0 0 1px rgba(24,24,27,.08)}</style>
<h1>${title}</h1><p>${subtitle}</p><img src="data:image/png;base64,${image.toString('base64')}">`);
    save(file, await page.screenshot({ type: 'png' }));
    await page.close();
  };

  // Fill the form first so the activity list has entries.
  await call('browser_fill_form', { fields: [{ ref: ref('Full name'), value: 'Ada Lovelace' }, { ref: ref('Email'), value: 'ada@example.com' }, { ref: ref('Address'), value: '12 Analytical Way' }] });

  // 3. cursor and agent bar: capture right after an action, while the bar is up.
  await call('browser_hover', { ref: ref('Place order') });
  await shopPage.bringToFront();
  await sleep(250);
  await framed('3-agent-cursor.png', 'See what your AI is doing', 'A live cursor and a Stop button on every page the agent works on', await shopPage.screenshot({ type: 'png' }), { maxHeight: 610 });

  // 2. confirmation prompt: a sensitive click waits for the user.
  const pending = call('browser_click', { ref: ref('Place order') });
  let prompt;
  for (let i = 0; i < 40 && !prompt; i++) {
    prompt = (await readPrompts(ctx, sw)).find((p) => p.kind);
    if (!prompt) await sleep(250);
  }
  if (!prompt) throw new Error('confirmation prompt did not appear');
  await sleep(500);
  await framed('2-confirmation-prompt.png', 'Sensitive actions always ask you', 'Submit, pay, delete, post and download need your approval on the page', await shopPage.screenshot({ type: 'png' }), { maxHeight: 610 });
  await answerPrompt(ctx, sw, /Decline|Approve/).catch(() => {});
  await pending.catch(() => {});

  // 1 and 4. popup states.
  const popup = await ctx.newPage();
  await popup.goto(extUrl('popup.html'));
  await popup.locator('#status-text', { hasText: /Connected/ }).waitFor({ timeout: 30_000 });
  await popup.evaluate((url) => {
    const el = document.getElementById('mcp-url');
    if (el) el.textContent = `${url}/mcp`;
  }, prodUrl);
  await popup.locator('#root').waitFor();
  const card = popup.locator('#root');
  await framed('1-popup.png', 'Connect once, control it all', 'Connection code, one-click kill switch and a local activity log', await card.screenshot({ type: 'png' }), { maxHeight: 640 });

  await sw.evaluate(() => chrome.storage.local.set({ siteRules: { 'northwind.example': 'allow', 'mail.example.com': 'ask', 'crm.example.org': 'block' } }));
  await popup.reload();
  await popup.locator('#sites summary').first().click();
  await popup.locator('#site-rules li').first().waitFor();
  await framed('4-site-rules.png', 'You decide where the AI can go', 'Allow, ask or block any site. Banks, crypto and the Web Store are blocked by default', await popup.locator('#root').screenshot({ type: 'png' }), { maxHeight: 640 });
  await popup.close();

  // 5. landing page, straight from the gateway.
  const landing = await compose.newPage();
  await landing.goto(`${gateway}/`);
  save('5-landing.png', await landing.screenshot({ type: 'png' }));
  await landing.close();

  // Promo tiles.
  const icon = fs.readFileSync(path.join(ext, 'icons/128.png')).toString('base64');
  const tile = async (file, w, h, big) => {
    const page = await compose.newPage();
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;width:${w}px;height:${h}px;display:flex;align-items:center;justify-content:center;gap:${big ? 36 : 18}px;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;background:linear-gradient(135deg,#18181b,#3f3f46);color:#fafafa}
img{width:${big ? 160 : 84}px;height:${big ? 160 : 84}px;border-radius:${big ? 36 : 20}px}h1{margin:0;font-size:${big ? 64 : 30}px;letter-spacing:-.02em}p{margin:6px 0 0;font-size:${big ? 26 : 14}px;color:#d4d4d8;max-width:${big ? 620 : 220}px}</style>
<img src="data:image/png;base64,${icon}"><div><h1>Helmsman</h1><p>Let your AI drive your real browser, safely.</p></div>`);
    save(file, await page.screenshot({ type: 'png' }));
    await page.close();
  };
  await tile('promo-small-440x280.png', 440, 280, false);
  await tile('promo-marquee-1400x560.png', 1400, 560, true);
  console.log(`Wrote ${fs.readdirSync(outDir).length} images to ${path.relative(root, outDir)}`);
} finally {
  await ctx.close();
  await compose.browser()?.close();
  shop.close();
  wrangler?.kill('SIGTERM');
}
