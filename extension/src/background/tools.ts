// Tool implementations. Each tool resolves the target tab, drives the page with
// real CDP input (so sites see trusted events), animates the agent cursor, and
// returns text the model can act on.

import type { ToolContent } from '../../../shared/protocol';
import type { OverlayAction, PrepareResult } from '../messages';
import { attach, send, sessionOf } from './cdp';
import { frameCall, frameOffset, identifyFrame, parseRef, readyFrames, refPrefix } from './frames';
import { macCommands, MODIFIER_BITS, parseShortcut } from './keys';
import { getAgentTab, setAgentTab, state } from './state';

type Args = Record<string, any>;
type ToolFn = (args: Args) => Promise<ToolContent[]>;

const text = (t: string): ToolContent[] => [{ type: 'text', text: t }];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isMac = navigator.userAgent.includes('Mac');

class ToolError extends Error {}

function checkAbort() {
  if (state.paused || state.abort.signal.aborted) {
    throw new ToolError('The user pressed Stop in Chrome. Stop working and ask the user how to continue.');
  }
}

// ---- tabs -------------------------------------------------------------------

async function resolveTab(tabId?: number): Promise<chrome.tabs.Tab> {
  if (tabId !== undefined) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new ToolError(`Tab ${tabId} does not exist. Call browser_tabs with action "list".`);
    return tab;
  }
  const agent = await getAgentTab();
  if (agent !== undefined) {
    const tab = await chrome.tabs.get(agent).catch(() => null);
    if (tab) return tab;
  }
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  // Prefer the active tab; if it is a chrome:// or extension page, use the most recently used website tab.
  const web = (t?: chrome.tabs.Tab) => !!t && /^(https?|file):/.test(t.url ?? t.pendingUrl ?? '');
  const recent = (await chrome.tabs.query({})).filter(web).sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
  const tab = web(active) ? active : (recent ?? active);
  if (!tab?.id) throw new ToolError('No open tab. Use browser_tabs with action "new".');
  await setAgentTab(tab.id);
  return tab;
}

function assertScriptable(tab: chrome.tabs.Tab) {
  const url = tab.url ?? tab.pendingUrl ?? '';
  if (/^(chrome|edge|about|devtools|chrome-extension|view-source):/.test(url) && url !== 'about:blank' ||
      /^https:\/\/chrome(webstore)?\.google\.com\/webstore/.test(url)) {
    throw new ToolError(`Chrome does not let extensions control ${url}. Navigate the tab to a normal website first (browser_navigate).`);
  }
}

async function waitForLoad(tabId: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // Give a click-triggered navigation a moment to start.
  await sleep(150);
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return;
    if (tab.status === 'complete') return;
    await sleep(200);
  }
}

async function pageHeader(tab: chrome.tabs.Tab): Promise<string> {
  const fresh = await chrome.tabs.get(tab.id!).catch(() => tab);
  const dialog = sessionOf(tab.id!)?.dialog;
  const lines = [`Tab ${fresh.id}: ${fresh.title ?? ''}`, `URL: ${fresh.url ?? ''}`];
  if (dialog) {
    lines.push(`⚠ A ${dialog.type} dialog is open: "${dialog.message}". Use browser_handle_dialog before anything else.`);
  }
  return lines.join('\n');
}

// ---- overlay ----------------------------------------------------------------

const lastCursor = new Map<number, { x: number; y: number }>();

async function overlay(tabId: number, action: OverlayAction) {
  await frameCall(tabId, 0, { cmd: 'overlay', action }, 3000).catch(() => {});
}

export async function showAgentBar(tabId: number, label: string) {
  await overlay(tabId, { type: 'show', label, paused: state.paused });
}

async function glide(tabId: number, x: number, y: number) {
  const prev = lastCursor.get(tabId);
  const dist = prev ? Math.hypot(prev.x - x, prev.y - y) : 500;
  const durationMs = Math.round(Math.min(900, Math.max(360, 320 + dist * 0.5)));
  await overlay(tabId, { type: 'avoid', x, y });
  await overlay(tabId, { type: 'move', x, y, durationMs });
  lastCursor.set(tabId, { x, y });
}

// ---- element targeting ------------------------------------------------------

interface Target {
  frameId: number;
  local: string;
  prep: PrepareResult;
  /** Top-level viewport point. */
  x: number;
  y: number;
}

async function locate(tabId: number, ref: string, scroll = true): Promise<Target> {
  const { frameId, local } = parseRef(ref);
  await readyFrames(tabId);
  if (frameId !== 0) {
    // Scroll ancestors so the iframe itself is on screen before measuring.
    let current = frameId;
    for (let i = 0; i < 20 && current !== 0; i++) {
      const placement = await identifyFrame(tabId, current);
      if (!placement) break;
      await frameCall(tabId, placement.parentFrameId, { cmd: 'prepare', ref: placement.iframeRef, scroll: true }).catch(() => {});
      current = placement.parentFrameId;
    }
  }
  let prep: PrepareResult;
  try {
    prep = await frameCall<PrepareResult>(tabId, frameId, { cmd: 'prepare', ref: local, scroll });
  } catch (e) {
    const msg = (e as Error).message;
    if (/no longer on the page|did not answer|Could not establish/i.test(msg)) {
      throw new ToolError(`Element ${ref} is gone (the page changed). Take a new browser_snapshot and use the new ref.`);
    }
    throw new ToolError(msg);
  }
  const offset = frameId === 0 ? { x: 0, y: 0 } : await frameOffset(tabId, frameId);
  return {
    frameId,
    local,
    prep,
    x: Math.round(offset.x + prep.point.x),
    y: Math.round(offset.y + prep.point.y),
  };
}

// ---- raw input ----------------------------------------------------------------

function modifierMask(mods: string[] = []): number {
  return mods.reduce((m, k) => m | (MODIFIER_BITS[k] ?? 0), 0);
}

/** Resolves when a JS dialog opens: input commands stay pending while a dialog blocks the page. */
async function dialogOpened(tabId: number, signal: { done: boolean }): Promise<void> {
  while (!signal.done) {
    if (sessionOf(tabId)?.dialog) return;
    await sleep(50);
  }
  return new Promise(() => {});
}

async function mouse(tabId: number, type: string, x: number, y: number, extra: object = {}) {
  const signal = { done: false };
  try {
    await Promise.race([send(tabId, 'Input.dispatchMouseEvent', { type, x, y, ...extra }), dialogOpened(tabId, signal)]);
  } finally {
    signal.done = true;
  }
}

async function clickAt(tabId: number, x: number, y: number, opts: { button?: string; clickCount?: number; modifiers?: string[] } = {}) {
  const button = opts.button ?? 'left';
  const modifiers = modifierMask(opts.modifiers);
  const buttons = button === 'left' ? 1 : button === 'right' ? 2 : 4;
  await mouse(tabId, 'mouseMoved', x, y, { modifiers });
  const count = opts.clickCount ?? 1;
  for (let i = 1; i <= count; i++) {
    await mouse(tabId, 'mousePressed', x, y, { button, buttons, clickCount: i, modifiers });
    await mouse(tabId, 'mouseReleased', x, y, { button, buttons: 0, clickCount: i, modifiers });
  }
  await overlay(tabId, { type: 'click', x, y });
}

/**
 * Real click on a located element. If the element never sees the press (Chrome misroutes
 * input for some nested cross-site frames), finish with a DOM-level click in its frame.
 * Returns true when the fallback was needed.
 */
async function clickTarget(tabId: number, t: Target, opts: { button?: string; clickCount?: number; modifiers?: string[] } = {}): Promise<boolean> {
  const armed = await frameCall(tabId, t.frameId, { cmd: 'arm-click-probe', ref: t.local }, 3000).then(() => true, () => false);
  await clickAt(tabId, t.x, t.y, opts);
  if (!armed || sessionOf(tabId)?.dialog) return false;
  await sleep(60);
  const hit = await frameCall<boolean>(tabId, t.frameId, { cmd: 'read-click-probe' }, 3000).catch(() => true);
  if (hit) return false;
  await frameCall(tabId, t.frameId, {
    cmd: 'synthetic-click',
    ref: t.local,
    button: opts.button ?? 'left',
    clickCount: opts.clickCount ?? 1,
    modifiers: opts.modifiers ?? [],
  }).catch(() => {});
  return true;
}

async function pressKey(tabId: number, combo: string) {
  const { modifiers, key } = parseShortcut(combo);
  const mask = modifierMask(modifiers);
  for (const m of modifiers) {
    const def = parseShortcut(m).key;
    await send(tabId, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: def.key, code: def.code, windowsVirtualKeyCode: def.keyCode, modifiers: mask });
  }
  // Text is only produced without Control/Meta/Alt, like a real keyboard.
  const producesText = key.text !== undefined && !modifiers.some((m) => m !== 'Shift');
  const keyText = producesText && modifiers.includes('Shift') ? key.text!.toUpperCase() : key.text;
  const commands = isMac ? macCommands(modifiers, key) : undefined;
  await send(tabId, 'Input.dispatchKeyEvent', {
    type: producesText ? 'keyDown' : 'rawKeyDown',
    key: key.key,
    code: key.code,
    windowsVirtualKeyCode: key.keyCode,
    text: producesText ? keyText : undefined,
    unmodifiedText: producesText ? key.text : undefined,
    modifiers: mask,
    commands,
  });
  await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: key.key, code: key.code, windowsVirtualKeyCode: key.keyCode, modifiers: mask });
  for (const m of [...modifiers].reverse()) {
    const def = parseShortcut(m).key;
    await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: def.key, code: def.code, windowsVirtualKeyCode: def.keyCode, modifiers: 0 });
  }
}

async function typeText(tabId: number, value: string, slowly: boolean) {
  if (!slowly) {
    // insertText behaves like an IME commit: fast, fires beforeinput/input, handles any Unicode (Vietnamese included).
    const lines = value.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]) await send(tabId, 'Input.insertText', { text: lines[i] });
      if (i < lines.length - 1) await pressKey(tabId, 'Shift+Enter');
    }
    return;
  }
  for (const ch of value) {
    checkAbort();
    if (ch === '\n') {
      await pressKey(tabId, 'Enter');
      continue;
    }
    const simple = /^[a-zA-Z0-9 ]$/.test(ch);
    if (simple) {
      const shift = /[A-Z]/.test(ch);
      const code = ch === ' ' ? 'Space' : /\d/.test(ch) ? `Digit${ch}` : `Key${ch.toUpperCase()}`;
      const keyCode = ch === ' ' ? 32 : ch.toUpperCase().charCodeAt(0);
      await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: ch, code, windowsVirtualKeyCode: keyCode, text: ch, modifiers: shift ? 8 : 0 });
      await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code, windowsVirtualKeyCode: keyCode, modifiers: shift ? 8 : 0 });
    } else {
      await send(tabId, 'Input.insertText', { text: ch });
    }
    await sleep(25);
  }
}

// ---- snapshot -----------------------------------------------------------------

async function composeSnapshot(tabId: number, maxChars = 60_000): Promise<string> {
  const frames = await readyFrames(tabId);
  const placements = new Map<number, string>(); // child frameId -> iframe ref (with parent prefix)
  await Promise.all(
    frames
      .filter((f) => f.frameId !== 0)
      .map(async (f) => {
        const p = await identifyFrame(tabId, f.frameId);
        if (p) placements.set(f.frameId, refPrefix(p.parentFrameId) + p.iframeRef);
      }),
  );
  const outlines = new Map<number, string>();
  await Promise.all(
    frames.map(async (f) => {
      const s = await frameCall<string>(tabId, f.frameId, { cmd: 'snapshot', prefix: refPrefix(f.frameId) }, 15_000).catch(
        (e: Error) => `- (could not read this frame: ${e.message})`,
      );
      outlines.set(f.frameId, s);
    }),
  );
  const childByRef = new Map<string, number>();
  for (const [frameId, ref] of placements) childByRef.set(ref, frameId);
  const used = new Set<number>([0]);

  const expand = (frameId: number, indent: string, depth: number): string => {
    const body = outlines.get(frameId) ?? '';
    return body
      .split('\n')
      .map((line) => {
        const m = /^(\s*)⟦frame:([^⟧]+)⟧$/.exec(line);
        if (!m) return indent + line;
        const child = childByRef.get(m[2]);
        if (child === undefined || depth > 8) return `${indent}${m[1]}- (frame content not available)`;
        used.add(child);
        const inner = expand(child, indent + m[1], depth + 1);
        return inner.trim() ? inner : `${indent}${m[1]}- (empty frame)`;
      })
      .join('\n');
  };

  let out = expand(0, '', 0);
  for (const f of frames) {
    if (used.has(f.frameId) || !outlines.has(f.frameId)) continue;
    out += `\n- frame f${f.frameId} (${f.url}):\n${expand(f.frameId, '  ', 1)}`;
  }
  if (out.length > maxChars) {
    out = `${out.slice(0, maxChars)}\n- … (truncated at ${maxChars} characters; use browser_get_text or scroll and snapshot again)`;
  }
  return out;
}

async function afterAction(tab: chrome.tabs.Tab, summary: string, snapshotChars = 12_000): Promise<ToolContent[]> {
  await waitForLoad(tab.id!, 10_000);
  const header = await pageHeader(tab);
  if (sessionOf(tab.id!)?.dialog) return text(`${summary}\n\n${header}`);
  const snap = await composeSnapshot(tab.id!, snapshotChars).catch((e: Error) => `(snapshot unavailable: ${e.message})`);
  return text(`${summary}\n\n${header}\n\nPage snapshot:\n${snap}`);
}

async function prepareTab(args: Args, label: string): Promise<chrome.tabs.Tab> {
  checkAbort();
  const tab = await resolveTab(args.tabId);
  assertScriptable(tab);
  await attach(tab.id!);
  const dialog = sessionOf(tab.id!)?.dialog;
  if (dialog && label !== 'handle_dialog') {
    throw new ToolError(`A ${dialog.type} dialog is open: "${dialog.message}". Call browser_handle_dialog first.`);
  }
  await showAgentBar(tab.id!, label);
  return tab;
}

// ---- tools --------------------------------------------------------------------

async function fetchAsBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new ToolError(`Download of ${url} failed (${res.status}).`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > 25 * 1024 * 1024) throw new ToolError('File is larger than 25 MB.');
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { base64: btoa(bin), mimeType: res.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream' };
}

async function screenshot(tabId: number, clip?: { x: number; y: number; width: number; height: number }, full = false): Promise<ToolContent> {
  const metrics = await send<any>(tabId, 'Page.getLayoutMetrics');
  const vp = metrics.cssLayoutViewport;
  let params: any = { format: 'jpeg', quality: 80 };
  if (full) {
    const size = metrics.cssContentSize ?? metrics.contentSize;
    const height = Math.min(size.height, 12_000);
    const scale = Math.min(1, 1600 / size.width);
    params = { ...params, captureBeyondViewport: true, clip: { x: 0, y: 0, width: size.width, height, scale } };
  } else if (clip) {
    params = { ...params, captureBeyondViewport: true, clip: { x: clip.x + vp.pageX, y: clip.y + vp.pageY, width: Math.max(1, clip.width), height: Math.max(1, clip.height), scale: 1 } };
  } else {
    const scale = Math.min(1, 1600 / vp.clientWidth);
    params = { ...params, clip: { x: vp.pageX, y: vp.pageY, width: vp.clientWidth, height: vp.clientHeight, scale } };
  }
  let shot = await send<{ data: string }>(tabId, 'Page.captureScreenshot', params);
  if (shot.data.length > 3_000_000) {
    shot = await send<{ data: string }>(tabId, 'Page.captureScreenshot', { ...params, quality: 45, clip: params.clip && { ...params.clip, scale: (params.clip.scale ?? 1) * 0.6 } });
  }
  return { type: 'image', data: shot.data, mimeType: 'image/jpeg' };
}

async function evaluateInFrame(tabId: number, frameId: number, script: string, markNonce?: string): Promise<unknown> {
  const hasReturn = /(^|[;\s{])return[\s;(]/.test(script);
  const finder = markNonce
    ? `(function f(root){const e=root.querySelector('[data-cma-eval="${markNonce}"]');if(e)return e;for(const n of root.querySelectorAll('*')){if(n.shadowRoot){const r=f(n.shadowRoot);if(r)return r;}}return null;})(document)`
    : 'undefined';
  if (frameId === 0) {
    // CDP evaluation ignores the page's Content Security Policy.
    const expression = hasReturn
      ? `(async () => { const element = ${finder}; ${markNonce ? 'element?.removeAttribute("data-cma-eval");' : ''} ${script}\n})()`
      : `(async () => { const element = ${finder}; ${markNonce ? 'element?.removeAttribute("data-cma-eval");' : ''} return eval(${JSON.stringify(script)}); })()`;
    const res = await send<any>(tabId, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true, timeout: 20_000 });
    if (res.exceptionDetails) throw new ToolError(`Script error: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`);
    return res.result?.value ?? (res.result?.type === 'undefined' ? undefined : res.result?.description);
  }
  const [result] = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    world: 'MAIN',
    args: [script, hasReturn, markNonce ?? null],
    func: async (code: string, body: boolean, nonce: string | null) => {
      const element = nonce ? document.querySelector(`[data-cma-eval="${nonce}"]`) : undefined;
      element?.removeAttribute('data-cma-eval');
      // eslint-disable-next-line no-new-func
      const fn = body ? new Function('element', `return (async () => {${code}\n})()`) : new Function('element', `return eval(${JSON.stringify(code)})`);
      const value = await fn(element);
      return JSON.parse(JSON.stringify(value ?? null));
    },
  });
  return result?.result;
}

const TOOLS: Record<string, ToolFn> = {
  async browser_tabs(args) {
    const action = args.action as string;
    if (action === 'new') {
      const tab = await chrome.tabs.create({ url: args.url || 'about:blank', active: true });
      await setAgentTab(tab.id);
      if (args.url) await waitForLoad(tab.id!, 30_000);
      return text(`Opened tab ${tab.id}${args.url ? ` at ${args.url}` : ''}. It is now the agent tab.\n\n${await pageHeader(tab)}`);
    }
    if (action === 'select') {
      if (args.tabId === undefined) throw new ToolError('tabId is required for "select".');
      const tab = await chrome.tabs.update(args.tabId, { active: true });
      if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
      await setAgentTab(args.tabId);
      return text(`Tab ${args.tabId} is now the agent tab.\n\n${await pageHeader(tab!)}`);
    }
    if (action === 'close') {
      if (args.tabId === undefined) throw new ToolError('tabId is required for "close".');
      await chrome.tabs.remove(args.tabId);
      if ((await getAgentTab()) === args.tabId) await setAgentTab(undefined);
      return text(`Closed tab ${args.tabId}.`);
    }
    const agent = await getAgentTab();
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
    const lines: string[] = [];
    for (const w of windows) {
      lines.push(`Window ${w.id}${w.focused ? ' (focused)' : ''}:`);
      for (const t of w.tabs ?? []) {
        const flags = [t.active && 'active', t.id === agent && 'AGENT TAB', t.audible && 'playing audio', t.discarded && 'sleeping']
          .filter(Boolean)
          .join(', ');
        lines.push(`  - [${t.id}] ${t.title ?? ''} — ${t.url ?? ''}${flags ? ` (${flags})` : ''}`);
      }
    }
    return text(`${lines.join('\n')}\n\nUse browser_tabs with action "select" to choose the tab to work in.`);
  },

  async browser_navigate(args) {
    const tab = await resolveTab(args.tabId);
    const action = (args.action as string) ?? 'goto';
    await showAgentBar(tab.id!, action === 'goto' ? `Mở ${args.url}` : action).catch(() => {});
    if (action === 'back') await chrome.tabs.goBack(tab.id!).catch(() => { throw new ToolError('There is no previous page.'); });
    else if (action === 'forward') await chrome.tabs.goForward(tab.id!).catch(() => { throw new ToolError('There is no next page.'); });
    else if (action === 'reload') await chrome.tabs.reload(tab.id!);
    else {
      if (!args.url) throw new ToolError('url is required.');
      let url = String(args.url).trim();
      if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
      await chrome.tabs.update(tab.id!, { url });
    }
    await waitForLoad(tab.id!, 40_000);
    const fresh = await chrome.tabs.get(tab.id!);
    if (/^(chrome|edge):/.test(fresh.url ?? '')) return text(await pageHeader(fresh));
    await attach(tab.id!);
    await showAgentBar(tab.id!, 'Đã mở trang');
    return afterAction(fresh, `Navigated (${action}).`, 20_000);
  },

  async browser_snapshot(args) {
    const tab = await prepareTab(args, 'Đọc trang');
    const snap = await composeSnapshot(tab.id!, args.maxChars ?? 60_000);
    return text(`${await pageHeader(tab)}\n\nPage snapshot:\n${snap}`);
  },

  async browser_click(args) {
    const tab = await prepareTab(args, `Bấm ${args.element ?? args.ref}`);
    const t = await locate(tab.id!, args.ref);
    await glide(tab.id!, t.x, t.y);
    checkAbort();
    const fallback = await clickTarget(tab.id!, t, { button: args.button, clickCount: args.doubleClick ? 2 : 1, modifiers: args.modifiers });
    await sleep(250);
    const warn = (t.prep.coveredBy ? ` (note: ${t.prep.coveredBy} was on top of it)` : '') + (fallback ? ' (delivered as a DOM click inside its frame)' : '');
    return afterAction(tab, `${args.doubleClick ? 'Double-clicked' : args.button === 'right' ? 'Right-clicked' : 'Clicked'} ${t.prep.label}${warn}.`);
  },

  async browser_hover(args) {
    const tab = await prepareTab(args, `Rê chuột ${args.element ?? args.ref}`);
    const t = await locate(tab.id!, args.ref);
    await glide(tab.id!, t.x, t.y);
    await mouse(tab.id!, 'mouseMoved', t.x, t.y);
    await sleep(400);
    return afterAction(tab, `Hovering over ${t.prep.label}.`);
  },

  async browser_type(args) {
    const tab = await prepareTab(args, `Gõ vào ${args.element ?? args.ref}`);
    const t = await locate(tab.id!, args.ref);
    await glide(tab.id!, t.x, t.y);
    checkAbort();
    await clickTarget(tab.id!, t);
    await sleep(80);
    const clear = args.clear !== false;
    const focus = await frameCall<{ focused: boolean }>(tab.id!, t.frameId, { cmd: 'focus-and-select', ref: t.local, clear });
    if (!focus.focused && !t.prep.editable) {
      throw new ToolError(`${t.prep.label} did not take keyboard focus. Snapshot again and type into the actual text field.`);
    }
    if (clear) {
      // Replace the selection; also covers editors that ignore programmatic selection.
      await pressKey(tab.id!, isMac ? 'Meta+a' : 'Control+a');
      if (!args.text) await pressKey(tab.id!, 'Backspace');
    }
    await typeText(tab.id!, String(args.text ?? ''), !!args.slowly);
    if (args.submit) await pressKey(tab.id!, 'Enter');
    await sleep(150);
    return afterAction(tab, `Typed ${JSON.stringify(String(args.text).slice(0, 80))} into ${t.prep.label}${args.submit ? ' and pressed Enter' : ''}.`);
  },

  async browser_fill_form(args) {
    const tab = await prepareTab(args, 'Điền form');
    const done: string[] = [];
    for (const field of (args.fields ?? []) as Args[]) {
      checkAbort();
      const t = await locate(tab.id!, field.ref);
      await glide(tab.id!, t.x, t.y);
      const value = field.value;
      const isToggle = t.prep.inputType === 'checkbox' || t.prep.inputType === 'radio' || t.prep.checked !== undefined;
      if (t.prep.tag === 'select') {
        const values = Array.isArray(value) ? value.map(String) : [String(value)];
        done.push(await frameCall<string>(tab.id!, t.frameId, { cmd: 'select-option', ref: t.local, values }));
      } else if (isToggle) {
        const want = value === true || value === 'true' || value === 'on' || value === 'yes';
        if (t.prep.checked !== want) await clickTarget(tab.id!, t);
        done.push(`${t.prep.label} → ${want ? 'checked' : 'unchecked'}`);
      } else {
        await clickTarget(tab.id!, t);
        await frameCall(tab.id!, t.frameId, { cmd: 'focus-and-select', ref: t.local, clear: true });
        await pressKey(tab.id!, isMac ? 'Meta+a' : 'Control+a');
        const str = Array.isArray(value) ? value.join(', ') : String(value);
        if (!str) await pressKey(tab.id!, 'Backspace');
        await typeText(tab.id!, str, false);
        done.push(`${t.prep.label} = ${JSON.stringify(str.slice(0, 60))}`);
      }
      await sleep(60);
    }
    return afterAction(tab, `Filled ${done.length} field(s):\n${done.map((d) => `- ${d}`).join('\n')}`);
  },

  async browser_select_option(args) {
    const tab = await prepareTab(args, `Chọn ${args.values?.join(', ')}`);
    const t = await locate(tab.id!, args.ref);
    await glide(tab.id!, t.x, t.y);
    const res = await frameCall<string>(tab.id!, t.frameId, { cmd: 'select-option', ref: t.local, values: (args.values ?? []).map(String) });
    return afterAction(tab, `${res} in ${t.prep.label}.`);
  },

  async browser_press_key(args) {
    const tab = await prepareTab(args, `Nhấn ${args.key}`);
    await pressKey(tab.id!, String(args.key));
    await sleep(200);
    return afterAction(tab, `Pressed ${args.key}.`);
  },

  async browser_scroll(args) {
    const tab = await prepareTab(args, 'Cuộn trang');
    if (args.toRef) {
      const t = await locate(tab.id!, args.toRef, true);
      await glide(tab.id!, t.x, t.y);
      return afterAction(tab, `Scrolled ${t.prep.label} into view.`);
    }
    const amount = Number(args.amount ?? 600);
    const dir = (args.direction as string) ?? 'down';
    const dx = dir === 'left' ? -amount : dir === 'right' ? amount : 0;
    const dy = dir === 'up' ? -amount : dir === 'down' ? amount : 0;
    let x: number;
    let y: number;
    if (args.ref) {
      const t = await locate(tab.id!, args.ref, false);
      ({ x, y } = t);
    } else {
      const vp = (await send<any>(tab.id!, 'Page.getLayoutMetrics')).cssLayoutViewport;
      x = Math.round(vp.clientWidth / 2);
      y = Math.round(vp.clientHeight / 2);
    }
    await glide(tab.id!, x, y);
    const before = await frameCall<any>(tab.id!, 0, { cmd: 'scroll-info' }).catch(() => null);
    await mouse(tab.id!, 'mouseWheel', x, y, { deltaX: dx, deltaY: dy });
    await sleep(350);
    const after = await frameCall<any>(tab.id!, 0, { cmd: 'scroll-info' }).catch(() => null);
    let note = '';
    if (before && after && !args.ref) {
      note = after.scrollY === before.scrollY && dy !== 0
        ? ' The page did not move (end reached, or the scrollable area is an inner element — pass its ref).'
        : ` Now at ${after.scrollY}px of ${after.scrollHeight}px.`;
    }
    return afterAction(tab, `Scrolled ${dir} ${amount}px.${note}`);
  },

  async browser_drag(args) {
    const tab = await prepareTab(args, 'Kéo thả');
    const a = await locate(tab.id!, args.startRef);
    await glide(tab.id!, a.x, a.y);
    const tabId = tab.id!;
    const session = sessionOf(tabId);
    if (session) session.dragData = undefined;
    await send(tabId, 'Input.setInterceptDrags', { enabled: true }).catch(() => {});
    await mouse(tabId, 'mouseMoved', a.x, a.y);
    await mouse(tabId, 'mousePressed', a.x, a.y, { button: 'left', buttons: 1, clickCount: 1 });
    const b = await locate(tabId, args.endRef, false);
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      const x = Math.round(a.x + ((b.x - a.x) * i) / steps);
      const y = Math.round(a.y + ((b.y - a.y) * i) / steps);
      await mouse(tabId, 'mouseMoved', x, y, { button: 'left', buttons: 1 });
      if (i === 1) await sleep(60);
    }
    await overlay(tabId, { type: 'move', x: b.x, y: b.y, durationMs: 300 });
    lastCursor.set(tabId, { x: b.x, y: b.y });
    const data = sessionOf(tabId)?.dragData;
    if (data) {
      // The page started an HTML5 drag: complete it with drag events.
      await send(tabId, 'Input.dispatchDragEvent', { type: 'dragEnter', x: b.x, y: b.y, data });
      await send(tabId, 'Input.dispatchDragEvent', { type: 'dragOver', x: b.x, y: b.y, data });
      await send(tabId, 'Input.dispatchDragEvent', { type: 'drop', x: b.x, y: b.y, data });
    }
    await mouse(tabId, 'mouseReleased', b.x, b.y, { button: 'left', buttons: 0, clickCount: 1 });
    await send(tabId, 'Input.setInterceptDrags', { enabled: false }).catch(() => {});
    await sleep(250);
    return afterAction(tab, `Dragged ${a.prep.label} onto ${b.prep.label}.`);
  },

  async browser_screenshot(args) {
    const tab = await prepareTab(args, 'Chụp màn hình');
    await overlay(tab.id!, { type: 'hide' });
    await sleep(120);
    let image: ToolContent;
    if (args.ref) {
      const t = await locate(tab.id!, args.ref);
      const offset = { x: t.x - t.prep.point.x, y: t.y - t.prep.point.y };
      image = await screenshot(tab.id!, { x: t.prep.rect.x + offset.x, y: t.prep.rect.y + offset.y, width: t.prep.rect.width, height: t.prep.rect.height });
    } else {
      image = await screenshot(tab.id!, undefined, !!args.fullPage);
    }
    return [{ type: 'text', text: await pageHeader(tab) }, image];
  },

  async browser_get_text(args) {
    const tab = await prepareTab(args, 'Đọc nội dung');
    const max = Number(args.maxChars ?? 40_000);
    let out: string;
    if (args.ref) {
      const { frameId, local } = parseRef(args.ref);
      out = await frameCall<string>(tab.id!, frameId, { cmd: 'get-text', ref: local });
    } else {
      const frames = await readyFrames(tab.id!);
      const parts = await Promise.all(
        frames.map(async (f) => {
          const t = await frameCall<string>(tab.id!, f.frameId, { cmd: 'get-text' }).catch(() => '');
          return t.trim() ? (f.frameId === 0 ? t : `\n--- frame f${f.frameId} (${f.url}) ---\n${t}`) : '';
        }),
      );
      out = parts.filter(Boolean).join('\n');
    }
    if (out.length > max) out = `${out.slice(0, max)}\n… (truncated at ${max} characters)`;
    return text(`${await pageHeader(tab)}\n\n${out || '(no text)'}`);
  },

  async browser_evaluate(args) {
    const tab = await prepareTab(args, 'Chạy script');
    let frameId = 0;
    let nonce: string | undefined;
    if (args.ref) {
      const parsed = parseRef(args.ref);
      frameId = parsed.frameId;
      nonce = crypto.randomUUID();
      await readyFrames(tab.id!);
      await frameCall(tab.id!, frameId, { cmd: 'mark-for-eval', ref: parsed.local, nonce });
    }
    const value = await evaluateInFrame(tab.id!, frameId, String(args.script), nonce);
    const json = value === undefined ? 'undefined' : JSON.stringify(value, null, 2);
    return text(`Result:\n${json.length > 30_000 ? `${json.slice(0, 30_000)}\n… (truncated)` : json}`);
  },

  async browser_wait_for(args) {
    const tab = await prepareTab(args, 'Đang chờ');
    if (args.time) {
      const ms = Math.min(Number(args.time), 30) * 1000;
      for (let waited = 0; waited < ms; waited += 250) {
        checkAbort();
        await sleep(250);
      }
      if (!args.text && !args.textGone) return afterAction(tab, `Waited ${args.time}s.`);
    }
    const timeout = Math.min(Number(args.timeout ?? 20), 50) * 1000;
    const deadline = Date.now() + timeout;
    const anyFrameHas = async (needle: string) => {
      const frames = await readyFrames(tab.id!);
      const hits = await Promise.all(frames.map((f) => frameCall<boolean>(tab.id!, f.frameId, { cmd: 'has-text', text: needle }, 3000).catch(() => false)));
      return hits.some(Boolean);
    };
    while (Date.now() < deadline) {
      checkAbort();
      const appeared = args.text ? await anyFrameHas(String(args.text)) : true;
      const gone = args.textGone ? !(await anyFrameHas(String(args.textGone))) : true;
      if (appeared && gone) {
        return afterAction(tab, args.text ? `"${args.text}" is on the page.` : `"${args.textGone}" is gone.`);
      }
      await sleep(400);
    }
    throw new ToolError(`Timed out after ${timeout / 1000}s waiting for ${args.text ? `"${args.text}" to appear` : `"${args.textGone}" to disappear`}.`);
  },

  async browser_handle_dialog(args) {
    const tab = await prepareTab(args, 'handle_dialog');
    const dialog = sessionOf(tab.id!)?.dialog;
    if (!dialog) throw new ToolError('No dialog is open.');
    await send(tab.id!, 'Page.handleJavaScriptDialog', { accept: !!args.accept, promptText: args.promptText });
    const s = sessionOf(tab.id!);
    if (s) s.dialog = undefined;
    return afterAction(tab, `${args.accept ? 'Accepted' : 'Dismissed'} the ${dialog.type} dialog "${dialog.message}".`);
  },

  async browser_file_upload(args) {
    const tab = await prepareTab(args, 'Tải file lên');
    const files = await Promise.all(
      ((args.files ?? []) as Args[]).map(async (f) => {
        if (f.base64) return { name: String(f.name), mimeType: String(f.mimeType ?? 'application/octet-stream'), base64: String(f.base64) };
        if (f.url) {
          const got = await fetchAsBase64(String(f.url));
          return { name: String(f.name), mimeType: String(f.mimeType ?? got.mimeType), base64: got.base64 };
        }
        throw new ToolError(`File "${f.name}" needs a url or base64 content.`);
      }),
    );
    const { frameId, local } = parseRef(args.ref);
    await readyFrames(tab.id!);
    const res = await frameCall<string>(tab.id!, frameId, { cmd: 'set-files', ref: local, files }, 30_000);
    return afterAction(tab, `${res}.`);
  },

  async browser_download(args) {
    const id = await chrome.downloads.download({ url: String(args.url), filename: args.filename ? String(args.filename) : undefined, conflictAction: 'uniquify' });
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const [item] = await chrome.downloads.search({ id });
      if (item?.state === 'complete') return text(`Downloaded to ${item.filename}.`);
      if (item?.state === 'interrupted') throw new ToolError(`Download failed: ${item.error}.`);
      await sleep(400);
    }
    return text('Download started; it is still in progress (see chrome://downloads).');
  },

  async browser_console_messages(args) {
    const tab = await prepareTab(args, 'Đọc console');
    const entries = (sessionOf(tab.id!)?.console ?? []).filter((e) => !args.onlyErrors || e.level === 'error');
    if (!entries.length) return text('No console messages captured yet (capturing starts when the agent first controls the tab).');
    return text(entries.slice(-150).map((e) => `[${e.level}] ${e.text}${e.url ? ` (${e.url})` : ''}`).join('\n'));
  },

  async browser_network_requests(args) {
    const tab = await prepareTab(args, 'Đọc network');
    const filter = args.filter ? String(args.filter) : '';
    const entries = [...(sessionOf(tab.id!)?.network.values() ?? [])].filter((e) => !filter || e.url.includes(filter));
    if (!entries.length) return text('No network requests captured yet (capturing starts when the agent first controls the tab).');
    return text(entries.slice(-150).map((e) => `${e.method} ${e.status ?? (e.failed ? `FAILED ${e.failed}` : '…')} ${e.type ?? ''} ${e.url.slice(0, 300)}`).join('\n'));
  },
};

export async function runTool(name: string, args: Args): Promise<{ content: ToolContent[]; isError?: boolean }> {
  const fn = TOOLS[name];
  if (!fn) return { content: text(`Unknown tool ${name}.`), isError: true };
  try {
    return { content: await fn(args ?? {}) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { content: text(msg), isError: true };
  }
}

export const TOOL_NAMES = Object.keys(TOOLS);

