// Service worker entry: wires the connection, tool execution, popup and login.

import type { RuntimeMessage } from '../messages';
import { detachAll, installCdpListeners } from './cdp';
import { connect, disconnect, onToolCall, reconnectNow, send } from './connection';
import { handleFrameIdentified } from './frames';
import { GATEWAY_URL, getAgentTab, logActivity, notify, popupState, setAccount, setStatus, state } from './state';
import { runTool, showAgentBar } from './tools';

const KEEPALIVE_ALARM = 'keepalive';

installCdpListeners();

// Tool calls run one at a time so mouse and keyboard input never interleave.
let queue: Promise<void> = Promise.resolve();

onToolCall((msg) => {
  queue = queue.then(async () => {
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

async function login(): Promise<void> {
  const redirect = chrome.identity.getRedirectURL();
  const url = `${GATEWAY_URL}/ext/login?redirect_uri=${encodeURIComponent(redirect)}`;
  let back: string | undefined;
  try {
    back = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  } catch (e) {
    setStatus('signed-out', `Đăng nhập chưa xong: ${(e as Error).message}`);
    return;
  }
  const params = new URLSearchParams(new URL(back!).hash.slice(1));
  if (params.get('error') === 'not_allowed') {
    setStatus('not-allowed', `${params.get('email')} chưa được cho phép dùng Chrome MCP Agent. Nhờ người quản lý thêm email này.`);
    return;
  }
  const token = params.get('token');
  const email = params.get('email');
  if (!token || !email) {
    setStatus('signed-out', 'Đăng nhập bị huỷ.');
    return;
  }
  await setAccount({ token, email, name: params.get('name') || undefined });
  setStatus('connecting');
  await reconnectNow();
}

async function stop() {
  state.paused = true;
  state.abort.abort();
  state.abort = new AbortController();
  const tabId = await getAgentTab();
  if (tabId !== undefined) await showAgentBar(tabId, '').catch(() => {});
  await detachAll();
  notify();
}

async function resume() {
  state.paused = false;
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
    case 'login':
      void login();
      return false;
    case 'logout':
      void (async () => {
        disconnect();
        await detachAll();
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
    case 'set-enabled':
      void (async () => {
        await chrome.storage.local.set({ enabled: msg.enabled });
        if (msg.enabled) await reconnectNow();
        else {
          disconnect();
          await detachAll();
          setStatus('offline', 'Bạn đã tắt quyền điều khiển trong extension.');
        }
      })();
      return false;
  }
  return false;
});

chrome.runtime.onInstalled.addListener(async (details) => {
  await chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
  if (details.reason === 'install') {
    await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?welcome=1') });
  }
  void connect();
});

chrome.runtime.onStartup.addListener(() => void connect());

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) void connect();
});

self.addEventListener('online', () => void reconnectNow());
self.addEventListener('offline', () => setStatus('offline', 'Máy đang mất mạng.'));

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if ((await getAgentTab()) === tabId) await chrome.storage.session.remove('agentTabId');
});

void chrome.alarms.get(KEEPALIVE_ALARM).then((a) => {
  if (!a) void chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
});
void connect();
