// Production smoke test against the deployed gateway:
// a real Chromium with the production extension connects, then the full
// ChatGPT path (registration, consent with the connection code, token, MCP
// tool calls) drives a page with cross-origin iframes.
//
//   node scripts/pack-extension.mjs && node --experimental-strip-types scripts/live-check.mjs

import { chromium, request as http } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixtures } from '../tests/fixtures/server.mjs';
import { autoApprove } from '../tests/support/prompts.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gateway = /"PUBLIC_URL"\s*:\s*"([^"]+)"/.exec(fs.readFileSync(path.join(root, 'worker/wrangler.jsonc'), 'utf8'))[1];
const ext = path.join(root, 'extension/unpacked');
const step = (m) => console.log(`✓ ${m}`);
const fail = (m) => {
  throw new Error(m);
};

const fixtures = await startFixtures();
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'cma-live-')), {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const api = await http.newContext({ baseURL: gateway });
let popup;
let stopApprover = () => {};
try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  // Stand-in user: approves the on-page confirmation that sensitive clicks ("Gửi") now require.
  stopApprover = autoApprove(ctx, sw);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(fixtures.url);

  popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`);
  await popup.locator('#login').click();
  await popup.locator('#status-text', { hasText: /Connected|Đã kết nối/ }).waitFor({ timeout: 30_000 });
  const code = (await popup.locator('#code').textContent()).trim();
  step(`extension connected to ${gateway} with code ${code.slice(0, 2)}***`);

  const redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect';
  const reg = await (await api.post('/oauth/register', {
    data: { client_name: 'ChatGPT', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] },
  })).json();
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const resource = `${gateway}/mcp`;
  const q = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: redirectUri, state: 'live', code_challenge: challenge, code_challenge_method: 'S256', scope: 'browser', resource });
  const consent = await (await api.get(`/authorize?${q}`)).text();
  const handle = /name="handle" value="([^"]+)"/.exec(consent)?.[1] ?? fail('no consent handle');
  const approve = await api.post('/authorize', { form: { handle, decision: 'approve', code }, maxRedirects: 0 });
  if (approve.status() !== 302) fail(`consent returned ${approve.status()}`);
  const authCode = new URL(approve.headers().location).searchParams.get('code');
  const tokens = await (await api.post('/oauth/token', {
    form: { grant_type: 'authorization_code', code: authCode, redirect_uri: redirectUri, client_id: reg.client_id, code_verifier: verifier, resource },
  })).json();
  if (!tokens.access_token) fail('no access token');
  step('ChatGPT-style OAuth with the connection code issued an access token');

  let id = 0;
  const call = async (name, args = {}) => {
    const res = await api.post('/mcp', {
      headers: { authorization: `Bearer ${tokens.access_token}`, accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
      data: { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } },
    });
    const raw = await res.text();
    const msg = JSON.parse((raw.split('\n').find((l) => l.startsWith('data: ')) ?? raw).replace(/^data: /, ''));
    const text = msg.result.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    if (msg.result.isError) fail(`${name}: ${text}`);
    return text;
  };
  const refOf = (snap, label) => /ref=(f?\d*e\d+)/.exec(snap.split('\n').find((l) => l.includes(label) && l.includes('[ref=')) ?? '')?.[1] ?? fail(`no ref for ${label}`);

  const tabs = await call('browser_tabs', { action: 'list' });
  const tabId = Number(/\[(\d+)\] Fixture Home/.exec(tabs)?.[1] ?? fail('fixture tab not listed'));
  await call('browser_tabs', { action: 'select', tabId });
  const snap = await call('browser_snapshot');
  step(`snapshot over Cloudflare (${snap.length} chars, includes cross-origin frame: ${snap.includes('Form trong iframe')})`);
  let r = await call('browser_type', { ref: refOf(snap, 'Email trong iframe'), text: 'live@cloudflare.vn' });
  r = await call('browser_click', { ref: refOf(snap, 'Gửi iframe') });
  if (!(await call('browser_get_text')).includes('Đã gửi: live@cloudflare.vn')) fail('cross-origin iframe form did not submit');
  step('typed and clicked inside the cross-origin iframe through the live gateway');
  r = await call('browser_click', { ref: refOf(snap, 'Nút lồng') });
  if (!(await call('browser_get_text')).includes('Lồng OK')) fail('nested iframe click failed');
  step('clicked inside the nested iframe');
  const shot = await api.post('/mcp', {
    headers: { authorization: `Bearer ${tokens.access_token}`, accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    data: { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name: 'browser_screenshot', arguments: { fullPage: true } } },
  });
  if (!(await shot.text()).includes('"type":"image"')) fail('no screenshot');
  step('full-page screenshot returned through the gateway');

  await popup.locator('#logout').click();
  step('disconnected the test Chrome (its code is retired)');
  console.log('\nLIVE CHECK PASSED');
} finally {
  stopApprover();
  await api.dispose();
  await ctx.close();
  await fixtures.close();
}
