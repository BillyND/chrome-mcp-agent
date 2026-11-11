// chrome.debugger (Chrome DevTools Protocol) per tab: attach on demand, keep
// buffers of console messages, network requests and the open JS dialog, and
// detach after a quiet period so the "debugging" bar goes away.

const IDLE_DETACH_MS = 3 * 60_000;
const BUFFER_LIMIT = 300;

export interface ConsoleEntry {
  level: string;
  text: string;
  url?: string;
  t: number;
}
export interface NetworkEntry {
  id: string;
  method: string;
  url: string;
  type?: string;
  status?: number;
  failed?: string;
  t: number;
}
export interface DialogInfo {
  type: string;
  message: string;
  defaultPrompt?: string;
}

interface TabSession {
  console: ConsoleEntry[];
  network: Map<string, NetworkEntry>;
  dialog?: DialogInfo;
  idleTimer?: ReturnType<typeof setTimeout>;
  dragData?: unknown;
  /** Request ids still loading, for "network idle" waits. */
  inflight: Set<string>;
  lastNetworkAt: number;
  /** Emulation overrides vanish on detach, so a session that carries any stays attached. */
  pinned?: boolean;
}

const sessions = new Map<number, TabSession>();
const attaching = new Map<number, Promise<void>>();

export function sessionOf(tabId: number): TabSession | undefined {
  return sessions.get(tabId);
}

function touch(tabId: number) {
  const s = sessions.get(tabId);
  if (!s) return;
  clearTimeout(s.idleTimer);
  if (s.pinned) return;
  s.idleTimer = setTimeout(() => void detach(tabId), IDLE_DETACH_MS);
}

/** Keeps (or stops keeping) the debugger attached regardless of idleness. */
export function pinSession(tabId: number, pinned: boolean) {
  const s = sessions.get(tabId);
  if (!s) return;
  s.pinned = pinned;
  touch(tabId);
}

/** Resolves once the tab has had no request in flight for `quietMs`, or false when `timeoutMs` passes first. */
export async function waitNetworkIdle(tabId: number, quietMs: number, timeoutMs: number, shouldStop: () => void): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    shouldStop();
    const s = sessions.get(tabId);
    if (!s || (s.inflight.size === 0 && Date.now() - s.lastNetworkAt >= quietMs)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

export async function attach(tabId: number): Promise<void> {
  if (sessions.has(tabId)) {
    touch(tabId);
    return;
  }
  let pending = attaching.get(tabId);
  if (!pending) {
    pending = (async () => {
      try {
        await chrome.debugger.attach({ tabId }, '1.3');
      } catch (e) {
        const msg = (e as Error).message ?? String(e);
        if (!/already attached/i.test(msg)) {
          throw new Error(
            /Cannot access|chrome:\/\/|extensions gallery|webstore/i.test(msg)
              ? 'Chrome does not allow extensions to control this page (chrome:// pages, the Web Store and other extensions). Open a normal website tab instead.'
              : `Could not take control of the tab: ${msg}`,
          );
        }
      }
      sessions.set(tabId, { console: [], network: new Map(), inflight: new Set(), lastNetworkAt: Date.now() });
      await Promise.all([
        send(tabId, 'Page.enable'),
        send(tabId, 'Runtime.enable'),
        send(tabId, 'Network.enable', { maxTotalBufferSize: 0, maxResourceBufferSize: 0 }).catch(() => {}),
        // Background tabs behave as focused, so input, rendering and screenshots work without bringing them to the front.
        send(tabId, 'Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {}),
      ]);
      touch(tabId);
    })().finally(() => attaching.delete(tabId));
    attaching.set(tabId, pending);
  }
  return pending;
}

export async function detach(tabId: number): Promise<void> {
  const s = sessions.get(tabId);
  if (s) clearTimeout(s.idleTimer);
  sessions.delete(tabId);
  await chrome.debugger.detach({ tabId }).catch(() => {});
}

export async function detachAll(): Promise<void> {
  await Promise.all([...sessions.keys()].map((id) => detach(id)));
}

export async function send<T = any>(tabId: number, method: string, params?: object): Promise<T> {
  touch(tabId);
  try {
    return (await chrome.debugger.sendCommand({ tabId }, method, params)) as T;
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    if (/not attached|Detached/i.test(msg)) {
      sessions.delete(tabId);
      await attach(tabId);
      return (await chrome.debugger.sendCommand({ tabId }, method, params)) as T;
    }
    throw new Error(`${method}: ${msg}`);
  }
}

type Listener = (tabId: number, method: string, params: any) => void;
const extraListeners = new Set<Listener>();
export function onEvent(fn: Listener): () => void {
  extraListeners.add(fn);
  return () => extraListeners.delete(fn);
}

export function installCdpListeners() {
  chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId !== undefined) {
      const s = sessions.get(source.tabId);
      if (s) clearTimeout(s.idleTimer);
      sessions.delete(source.tabId);
    }
  });

  chrome.debugger.onEvent.addListener((source, method, params: any) => {
    const tabId = source.tabId;
    if (tabId === undefined) return;
    for (const fn of extraListeners) fn(tabId, method, params);
    const s = sessions.get(tabId);
    if (!s) return;
    switch (method) {
      case 'Runtime.consoleAPICalled': {
        const text = (params.args ?? [])
          .map((a: any) => (a.value !== undefined ? String(a.value) : (a.description ?? a.type)))
          .join(' ');
        s.console.push({ level: params.type, text: text.slice(0, 2000), t: Date.now() });
        break;
      }
      case 'Runtime.exceptionThrown': {
        const d = params.exceptionDetails ?? {};
        s.console.push({ level: 'error', text: (d.exception?.description ?? d.text ?? 'Uncaught error').slice(0, 2000), url: d.url, t: Date.now() });
        break;
      }
      case 'Network.requestWillBeSent':
        if (params.type !== 'EventSource' && params.type !== 'Ping') s.inflight.add(params.requestId);
        s.lastNetworkAt = Date.now();
        s.network.set(params.requestId, {
          id: params.requestId,
          method: params.request.method,
          url: params.request.url,
          type: params.type,
          t: Date.now(),
        });
        break;
      case 'Network.responseReceived': {
        const e = s.network.get(params.requestId);
        if (e) e.status = params.response.status;
        // Once headers are in, the request counts as settled for idle detection (bodies may stream on).
        s.inflight.delete(params.requestId);
        s.lastNetworkAt = Date.now();
        break;
      }
      case 'Network.loadingFailed': {
        const e = s.network.get(params.requestId);
        if (e) e.failed = params.errorText;
        s.inflight.delete(params.requestId);
        s.lastNetworkAt = Date.now();
        break;
      }
      case 'Network.loadingFinished':
        s.inflight.delete(params.requestId);
        s.lastNetworkAt = Date.now();
        break;
      case 'Page.frameNavigated':
        if (!params.frame?.parentId) s.inflight.clear();
        break;
      case 'Page.javascriptDialogOpening':
        s.dialog = { type: params.type, message: params.message, defaultPrompt: params.defaultPrompt };
        break;
      case 'Page.javascriptDialogClosed':
        s.dialog = undefined;
        break;
      case 'Input.dragIntercepted':
        s.dragData = params.data;
        break;
    }
    if (s.console.length > BUFFER_LIMIT) s.console.splice(0, s.console.length - BUFFER_LIMIT);
    if (s.network.size > BUFFER_LIMIT) {
      const first = s.network.keys().next().value;
      if (first !== undefined) s.network.delete(first);
    }
  });
}
