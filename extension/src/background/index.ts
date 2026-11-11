// Service worker entry: wires the connection, tool execution, popup and login.

import type { RuntimeMessage } from '../messages';
import { detachAll, installCdpListeners } from './cdp';
import { connect, disconnect, onToolCall, reconnectNow, send } from './connection';
import { handleFrameIdentified } from './frames';
import { GATEWAY_URL, getAccount, getAgentTab, logActivity, notify, pausedLoaded, popupState, setAccount, setPaused, setStatus, state } from './state';
import { runTool, showAgentBar } from './tools';

const KEEPALIVE_ALARM = 'keepalive';

installCdpListeners();

// Tool calls run one at a time so mouse and keyboard input never interleave.
let queue: Promise<void> = Promise.resolve();

onToolCall((msg) => {
  queue = queue.then(async () => {
    await pausedLoaded;
    const started = Date.now();
    const result = state.paused
      ? { content: [{ type: 'text' as const, text: 'The user pressed Stop in Chrome. Do not continue; ask the user what to do.' }], isError: true }
      : await runTool(msg.tool, msg.args);
    send({ type: 'result', id: msg.id, content: result.content, isError: result.isError });
    const first = result.content.find((c) => c.type === 'text');
    await logActivity({
      t: started,
      tool: msg.tool,
      summary: first?.type === 'text' ? first.text.split('\n')[0].slice(0, 140) : 'screenshot',
      ok: !result.isError,
    });
  });
});

/** Registers this Chrome with the gateway and gets its connection code. */
async function register(password = ''): Promise<void> {
  setStatus('connecting');
  let res: Response;
  try {
    res = await fetch(`${GATEWAY_URL}/ext/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
  } catch {
    setStatus('signed-out', 'network');
    return;
  }
  const body = (await res.json().catch(() => ({}))) as { token?: string; code?: string; error?: string };
  if (!res.ok || !body.token || !body.code) {
    state.needsPassword = body.error === 'password_required' || body.error === 'wrong_password';
    setStatus('not-allowed', body.error === 'wrong_password' ? 'wrong_password' : state.needsPassword ? undefined : 'server');
    return;
  }
  state.needsPassword = false;
  await setAccount({ token: body.token, code: body.code });
  await reconnectNow();
}

async function stop() {
  await setPaused(true);
  state.abort.abort();
  state.abort = new AbortController();
  const tabId = await getAgentTab();
  if (tabId !== undefined) await showAgentBar(tabId, '').catch(() => {});
  await detachAll();
  notify();
}

async function resume() {
  await setPaused(false);
  const tabId = await getAgentTab();
  if (tabId !== undefined) await showAgentBar(tabId, 'Sẵn sàng').catch(() => {});
  notify();
}

chrome.runtime.onMessage.addListener((msg: RuntimeMessage, _sender, sendResponse) => {
  switch (msg?.type) {
    case 'frame-identified':
      handleFrameIdentified(msg);
      return false;
    case 'get-state':
      void popupState().then(sendResponse);
      return true;
    case 'connect':
      void register(msg.password);
      return false;
    case 'logout':
      void (async () => {
        const account = await getAccount();
        disconnect();
        await detachAll();
        if (account) {
          await fetch(`${GATEWAY_URL}/ext/forget`, { method: 'POST', headers: { Authorization: `Bearer ${account.token}` } }).catch(() => {});
        }
        await setAccount(null);
        setStatus('signed-out');
      })();
      return false;
    case 'stop':
      void stop();
      return false;
    case 'resume':
      void resume();
      return false;
    case 'reconnect':
      void reconnectNow();
      return false;
  }
  return false;
});

chrome.runtime.onInstalled.addListener(async (details) => {
  await chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
  if (details.reason === 'install') {
    await chrome.tabs.create({ url: GATEWAY_URL });
  }
  void connect();
});

chrome.runtime.onStartup.addListener(() => void connect());

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) void connect();
});

self.addEventListener('online', () => void reconnectNow());
self.addEventListener('offline', () => setStatus('offline', 'offline'));

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if ((await getAgentTab()) === tabId) await chrome.storage.session.remove('agentTabId');
});

void chrome.alarms.get(KEEPALIVE_ALARM).then((a) => {
  if (!a) void chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
});
void connect();
