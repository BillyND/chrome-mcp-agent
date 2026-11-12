// Captures every Helmsman screen from the production build and writes a gallery page to
// worker/public/preview/ (served by the gateway at /preview/), so the UI can be reviewed
// from any device.
//   node scripts/pack-extension.mjs && node scripts/ui-preview.mjs && npx wrangler deploy --config worker/wrangler.jsonc

import { chromium } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'worker', 'public', 'preview');
const ext = path.join(root, 'extension', 'unpacked');
const gateway = /"PUBLIC_URL"\s*:\s*"([^"]+)"/.exec(fs.readFileSync(path.join(root, 'worker/wrangler.jsonc'), 'utf8'))[1];
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const shots = []; // { group, title, file, width }

const page = (bg, fg) => `<!doctype html><meta charset="utf-8"><body style="margin:0;background:${bg};color:${fg};font:16px system-ui">
<h2 style="margin:24px">Demo page</h2><p style="margin:0 24px">Helmsman cursor, Stop bar and prompts on a ${bg === '#fff' ? 'light' : 'dark'} page.</p>
<button style="margin:24px;padding:10px 16px">Gửi</button></body>`;
const srv = http.createServer((q, s) => {
  s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  s.end(q.url.includes('dark') ? page('#0b0b0e', '#fafafa') : page('#fff', '#09090b'));
}).listen(4960);

const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'uip-')), {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--force-device-scale-factor=2'],
  viewport: null,
});
const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
const id = new URL(sw.url()).host;
const setPrefs = (lang, theme) => sw.evaluate((p) => chrome.storage.local.set({ prefs: p }), { lang, theme });
const save = async (target, group, title, file, width) => {
  await target.screenshot({ path: path.join(out, file) });
  shots.push({ group, title, file, width });
};

// Popup: signed out, signed in, sections open, in every theme and language.
const popup = await ctx.newPage();
await popup.setViewportSize({ width: 400, height: 900 });
for (const theme of ['light', 'dark']) {
  for (const lang of ['vi', 'en']) {
    await setPrefs(lang, theme);
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.waitForTimeout(500);
    const signedIn = await popup.locator('#signed-in').count();
    if (!signedIn) {
      await save(popup.locator('body > #root'), 'Popup', `Chưa kết nối · ${lang.toUpperCase()} · ${theme}`, `popup-out-${lang}-${theme}.png`, 400);
      await popup.locator('#login').click();
      await popup.locator('#code').waitFor({ timeout: 20_000 });
      await popup.waitForTimeout(600);
    }
    await save(popup.locator('body > #root'), 'Popup', `Đã kết nối · ${lang.toUpperCase()} · ${theme}`, `popup-in-${lang}-${theme}.png`, 400);
    for (const sel of ['#access', '#local', '#sites', '#secrets']) {
      const header = popup.locator(`${sel} button`).first();
      if (await header.count()) await header.click();
    }
    await popup.waitForTimeout(300);
    await popup.locator('#site-action').click();
    await popup.waitForTimeout(250);
    await save(popup, 'Popup', `Chọn quy tắc trang · ${lang.toUpperCase()} · ${theme}`, `popup-site-action-${lang}-${theme}.png`, 400);
    await popup.keyboard.press('Escape');
    for (const menu of ['lang', 'theme']) {
      await popup.locator(`#${menu}-menu`).click();
      await popup.waitForTimeout(250);
      await save(popup, 'Popup', `Menu ${menu === 'lang' ? 'ngôn ngữ' : 'giao diện'} · ${lang.toUpperCase()} · ${theme}`, `popup-${menu}-${lang}-${theme}.png`, 400);
      await popup.keyboard.press('Escape');
    }
    await save(popup.locator('body > #root'), 'Popup', `Mở các mục · ${lang.toUpperCase()} · ${theme}`, `popup-open-${lang}-${theme}.png`, 400);
  }
}

// Audit page.
for (const theme of ['light', 'dark']) {
  await setPrefs('vi', theme);
  const audit = await ctx.newPage();
  await audit.setViewportSize({ width: 1000, height: 560 });
  await audit.goto(`chrome-extension://${id}/audit.html`);
  await audit.waitForTimeout(600);
  await save(audit, 'Audit log', `Audit log · ${theme}`, `audit-${theme}.png`, 1000);
  await audit.close();
}

// On-page cursor, Stop bar and prompts.
const tabIdOf = (url) => sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0].id, url);
const overlay = (tabId, action) => sw.evaluate(async ({ tabId, action }) => chrome.tabs.sendMessage(tabId, { cmd: 'overlay', action }, { frameId: 0 }), { tabId, action });
for (const mode of ['light', 'dark']) {
  await setPrefs('vi', 'light');
  const url = `http://localhost:4960/${mode}`;
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 900, height: 520 });
  await p.goto(url);
  await p.waitForTimeout(600);
  const tabId = await tabIdOf(url);
  await overlay(tabId, { type: 'show', label: '', paused: false });
  await overlay(tabId, { type: 'move', x: 80, y: 140, durationMs: 200 });
  await p.waitForTimeout(500);
  await save(p, 'Trên trang web', `Con trỏ + thanh Dừng · trang ${mode === 'light' ? 'sáng' : 'tối'}`, `page-cursor-${mode}.png`, 900);
  for (const [kind, title, extra] of [
    ['sensitive', 'Xác nhận thao tác nhạy cảm', { label: 'Gửi', category: 'send', choices: ['approve', 'decline'] }],
    ['handback', 'AI nhờ bạn đăng nhập / captcha', { label: 'Please sign in to continue', category: '', choices: ['done', 'decline'] }],
  ]) {
    const pid = crypto.randomUUID();
    await overlay(tabId, { type: 'prompt', prompt: { id: pid, kind, agent: 'claude-code', host: 'mail.google.com', ...extra } });
    await p.waitForTimeout(500);
    await save(p, 'Trên trang web', `${title} · trang ${mode === 'light' ? 'sáng' : 'tối'}`, `page-${kind}-${mode}.png`, 900);
    await overlay(tabId, { type: 'prompt-end', id: pid });
  }
  await p.close();
}
await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'logout' }));
await ctx.close();

// A short video of the real cursor: gliding between targets, clicking, and swaying while it waits.
const videoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uip-video-'));
const vctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'uip-')), {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 640, height: 400 },
  recordVideo: { dir: videoDir, size: { width: 640, height: 400 } },
});
const vsw = vctx.serviceWorkers()[0] ?? (await vctx.waitForEvent('serviceworker'));
await vsw.evaluate(() => chrome.storage.local.set({ prefs: { lang: 'vi', theme: 'light' } }));
const demo = vctx.pages()[0] ?? (await vctx.newPage());
for (const mode of ['light', 'dark']) {
  const url = `http://localhost:4960/${mode}`;
  await demo.goto(url);
  await demo.waitForTimeout(500);
  const tabId = await vsw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0].id, url);
  const act = (action) => vsw.evaluate(async ({ tabId, action }) => chrome.tabs.sendMessage(tabId, { cmd: 'overlay', action }, { frameId: 0 }), { tabId, action });
  await act({ type: 'show', label: '', paused: false });
  for (const [x, y, rest] of [[60, 140, 3500], [420, 90, 1200], [300, 300, 3500], [60, 140, 1500]]) {
    await act({ type: 'move', x, y, durationMs: 650 });
    await act({ type: 'click', x, y });
    await demo.waitForTimeout(rest);
  }
}
const videoPath = await demo.video().path();
await vctx.close();
fs.copyFileSync(videoPath, path.join(out, 'cursor-demo.webm'));
shots.unshift({ group: 'Con trỏ (video)', title: 'Con trỏ thật: lướt tới, bấm, rồi lắc nhẹ khi đứng yên · trang sáng và tối', file: 'cursor-demo.webm', width: 640, video: true });
srv.close();

// Web pages served by the gateway.
const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  const web = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2, colorScheme: theme, locale: 'vi-VN' });
  await web.addInitScript((t) => { localStorage.setItem('cma-theme', t); localStorage.setItem('cma-lang', 'vi'); }, theme);
  for (const [route, title] of [['/', 'Trang chủ'], ['/privacy', 'Chính sách quyền riêng tư']]) {
    await web.goto(gateway + route);
    await web.waitForTimeout(500);
    await web.screenshot({ path: path.join(out, `web${route.replace(/\W/g, '') || 'home'}-${theme}.png`), fullPage: true });
    shots.push({ group: 'Trang web', title: `${title} · ${theme}`, file: `web${route.replace(/\W/g, '') || 'home'}-${theme}.png`, width: 1100 });
  }
  // Consent page, reached exactly like ChatGPT does.
  const reg = await (await fetch(`${gateway}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'ChatGPT', redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'] }),
  })).json();
  const q = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect', state: 'p', code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', code_challenge_method: 'S256', scope: 'browser', resource: `${gateway}/mcp` });
  await web.goto(`${gateway}/authorize?${q}`);
  await web.waitForTimeout(500);
  await web.screenshot({ path: path.join(out, `web-consent-${theme}.png`), fullPage: true });
  shots.push({ group: 'Trang web', title: `Trang nhập mã kết nối · ${theme}`, file: `web-consent-${theme}.png`, width: 1100 });
  await web.close();
}
await browser.close();

const groups = [...new Set(shots.map((s) => s.group))];
const esc = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Helmsman UI preview</title><style>
:root{--bg:#fafafa;--fg:#09090b;--muted:#71717a;--border:#e4e4e7;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#09090b;--fg:#fafafa;--muted:#a1a1aa;--border:#27272a;--card:#18181b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif}
main{max-width:1200px;margin:0 auto;padding:24px 16px 64px}h1{font-size:24px;margin:0 0 4px}.sub{color:var(--muted);margin:0 0 20px}
nav{display:flex;gap:6px;flex-wrap:wrap;position:sticky;top:0;background:var(--bg);padding:10px 0;z-index:1;border-bottom:1px solid var(--border);margin-bottom:20px}
nav a{color:var(--fg);text-decoration:none;border:1px solid var(--border);border-radius:999px;padding:6px 12px;font-size:13px;background:var(--card)}
h2{font-size:18px;margin:28px 0 12px}.grid{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}
figure{margin:0;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:10px;max-width:100%}
figure img,figure video{display:block;max-width:100%;height:auto;border-radius:8px}figcaption{color:var(--muted);font-size:13px;margin-top:8px}
</style></head><body><main><h1>Helmsman — xem trước giao diện</h1><p class="sub">Chụp từ bản đang chạy (${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Saigon' })}).</p>
<p class="sub"><a href="/demo" style="color:inherit;font-weight:600">▶ Xem con trỏ chạy thật (demo HTML)</a></p>
<nav>${groups.map((g) => `<a href="#${encodeURIComponent(g)}">${esc(g)}</a>`).join('')}</nav>
${groups.map((g) => `<h2 id="${encodeURIComponent(g)}">${esc(g)}</h2><div class="grid">${shots.filter((s) => s.group === g).map((s) => `<figure style="width:${Math.min(s.width, 1100) / (s.width > 600 ? 1 : 1)}px">${s.video ? `<video src="${s.file}" autoplay loop muted playsinline controls></video>` : `<img loading="lazy" src="${s.file}" alt="${esc(s.title)}">`}<figcaption>${esc(s.title)}</figcaption></figure>`).join('')}</div>`).join('')}
</main></body></html>`;
fs.writeFileSync(path.join(out, 'index.html'), html);
console.log(`Wrote ${shots.length} screenshots to worker/public/preview/`);
