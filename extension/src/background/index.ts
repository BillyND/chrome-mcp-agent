// Service worker entry: wires the connection, tool execution, popup and login.

import type { RuntimeMessage } from '../messages';
import { detachAll, installCdpListeners } from './cdp';
import { cloud, local, onToolCall, setLocalMode } from './connection';
import { handleFrameIdentified } from './frames';
import type { ToolContent } from '../../../shared/protocol';
import { answer, pendingPrompts } from './policy/approvals';
import { OPEN_TAG } from './policy/untrusted';
import { normalizeRuleHost } from './policy/site-rules';
import { getSettings, setRule, setScriptsEverywhere, sitesView } from './policy/store';
import { GATEWAY_URL, clearActivity, getAccount, getAgentTab, logActivity, notify, popupState, setAccount, setPaused, setStatus, state } from './state';
import { agentLabel, DEFAULT_AGENT } from './tools/agent-id';
import { hideAgentBar, runTool, showAgentBar } from './tools';

const KEEPALIVE_ALARM = 'keepalive';

const connectAll = () => {
  void cloud.connect();
  void local.connect();
};

installCdpListeners();

// Calls arrive from the cloud and the local server alike and run concurrently;
// runTool serialises what must not interleave (mouse and keyboard input) per agent.

onToolCall(async (msg, endpoint) => {
  const started = Date.now();
  const result = await runTool(msg.tool, msg.args, msg.agent);
  endpoint.send({ type: 'result', id: msg.id, content: result.content, isError: result.isError });
  await logActivity({
    t: started,
    tool: msg.tool,
    summary: summaryOf(result.content),
    ok: !result.isError,
    agent: agentLabel(msg.agent ?? DEFAULT_AGENT),
    ...result.audit,
  });
});

/** The first line of what the tool returned (inside the envelope when there is one), for the activity log. */
function summaryOf(content: ToolContent[]): string {
  const texts = content.flatMap((c) => (c.type === 'text' ? [c.text] : []));
  const wrapped = texts.find((t) => t.includes(OPEN_TAG));
  const body = wrapped ? wrapped.slice(wrapped.indexOf(OPEN_TAG) + OPEN_TAG.length) : (texts[0] ?? '');
  return (body.split('\n').find((l) => l.trim()) ?? 'screenshot').slice(0, 140);
}

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
  await cloud.reconnectNow();
}

/** Window after Stop during which new calls are refused, so the agent drops its queued steps. */
const STOP_GRACE_MS = 8_000;

/** On-page Stop: cancel what is running and end this task, without turning the agent off. */
async function stop() {
  state.stoppedUntil = Date.now() + STOP_GRACE_MS;
  state.abort.abort();
  state.abort = new AbortController();
  const tabId = await getAgentTab();
  if (tabId !== undefined) await hideAgentBar(tabId).catch(() => {});
  await detachAll();
  notify();
}

/** Popup switch off: cancel everything and refuse calls until it is turned back on. */
async function pause() {
  await setPaused(true);
  state.abort.abort();
  state.abort = new AbortController();
  const tabId = await getAgentTab();
  if (tabId !== undefined) await showAgentBar(tabId, '').catch(() => {});
  await detachAll();
  notify();
}

async function resume() {
  state.stoppedUntil = 0;
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
      void Promise.all([popupState(), sitesView(), getSettings()]).then(([s, sites, settings]) => sendResponse({ ...s, sites, scriptsEverywhere: settings.scriptsEverywhere, pending: pendingPrompts() }));
      return true;
    case 'approval-decision':
      // Page prompts and the popup answer through here; the page script runs in an isolated world, so a web page cannot.
      answer(msg.id, msg.choice);
      return false;
    case 'set-site-rule': {
      const host = normalizeRuleHost(msg.host);
      if (host) void setRule(host, msg.action).then(notify);
      return false;
    }
    case 'set-scripts-everywhere':
      void setScriptsEverywhere(msg.enabled === true).then(notify);
      return false;
    case 'clear-log':
      void clearActivity();
      return false;
    case 'open-audit':
      void chrome.tabs.create({ url: chrome.runtime.getURL('audit.html') });
      return false;
    case 'connect':
      void register(msg.password);
      return false;
    case 'logout':
      void (async () => {
        const account = await getAccount();
        cloud.disconnect();
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
    case 'pause':
      void pause();
      return false;
    case 'resume':
      void resume();
      return false;
    case 'reconnect':
      void cloud.reconnectNow();
      return false;
    case 'set-local':
      void setLocalMode(msg.enabled);
      return false;
  }
  return false;
});

chrome.runtime.onInstalled.addListener(async (details) => {
  await chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
  if (details.reason === 'install') {
    await chrome.tabs.create({ url: GATEWAY_URL });
  }
  connectAll();
});

chrome.runtime.onStartup.addListener(connectAll);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) connectAll();
});

self.addEventListener('online', () => void cloud.reconnectNow());
self.addEventListener('offline', () => setStatus('offline', 'offline'));

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if ((await getAgentTab()) === tabId) await chrome.storage.session.remove('agentTabId');
});

void chrome.alarms.get(KEEPALIVE_ALARM).then((a) => {
  if (!a) void chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
});
connectAll();
