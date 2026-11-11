// Real input through CDP (trusted events, work on tabs that are not in front):
// mouse, keyboard and text, plus the click probe that detects a misrouted press.

import { send, sessionOf } from '../cdp';
import { frameCall } from '../frames';
import { macCommands, MODIFIER_BITS, parseShortcut } from '../keys';
import type { Target } from './locate';
import { overlay } from './overlay';
import { checkAbort, isMac, sleep, ToolError, type ToolCtx } from './types';

export interface ClickOptions {
  button?: string;
  clickCount?: number;
  modifiers?: string[];
}

export function modifierMask(mods: string[] = []): number {
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

export async function mouse(tabId: number, type: string, x: number, y: number, extra: object = {}) {
  const signal = { done: false };
  try {
    await Promise.race([send(tabId, 'Input.dispatchMouseEvent', { type, x, y, ...extra }), dialogOpened(tabId, signal)]);
  } finally {
    signal.done = true;
  }
}

export async function clickAt(tabId: number, x: number, y: number, opts: ClickOptions = {}) {
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
 * Runs `act` (real input aimed at an element) and checks that the element saw the press.
 * Chrome misroutes input for some nested cross-site frames; then `redo` repeats the action
 * as DOM events inside the element's frame. Returns true when the fallback was needed.
 */
export async function withClickProbe(
  tabId: number,
  target: Target | undefined,
  act: () => Promise<void>,
  redo: (target: Target) => Promise<unknown>,
): Promise<boolean> {
  const armed = target ? await frameCall(tabId, target.frameId, { cmd: 'arm-click-probe', ref: target.local }, 3000).then(() => true, () => false) : false;
  await act();
  if (!armed || !target || sessionOf(tabId)?.dialog) return false;
  await sleep(60);
  const hit = await frameCall<boolean>(tabId, target.frameId, { cmd: 'read-click-probe' }, 3000).catch(() => true);
  if (hit) return false;
  await redo(target).catch(() => {});
  return true;
}

/** Real click on a located element, with the DOM-click fallback. */
export function clickTarget(tabId: number, t: Target, opts: ClickOptions = {}): Promise<boolean> {
  return withClickProbe(
    tabId,
    t,
    () => clickAt(tabId, t.x, t.y, opts),
    () => frameCall(tabId, t.frameId, {
      cmd: 'synthetic-click',
      ref: t.local,
      button: opts.button ?? 'left',
      clickCount: opts.clickCount ?? 1,
      modifiers: opts.modifiers ?? [],
    }),
  );
}

export async function pressKey(tabId: number, combo: string) {
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

export const selectAll = (tabId: number) => pressKey(tabId, isMac ? 'Meta+a' : 'Control+a');

export async function typeText(tabId: number, value: string, slowly: boolean, ctx: ToolCtx) {
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
    checkAbort(ctx);
    if (ch === '\n') {
      await pressKey(tabId, 'Enter');
      continue;
    }
    if (/^[a-zA-Z0-9 ]$/.test(ch)) {
      const shift = /[A-Z]/.test(ch);
      const code = ch === ' ' ? 'Space' : /\d/.test(ch) ? `Digit${ch}` : `Key${ch.toUpperCase()}`;
      const keyCode = ch === ' ' ? 32 : ch.toUpperCase().charCodeAt(0);
      const common = { key: ch, code, windowsVirtualKeyCode: keyCode, modifiers: shift ? 8 : 0 };
      await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', text: ch, ...common });
      await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...common });
    } else {
      await send(tabId, 'Input.insertText', { text: ch });
    }
    await sleep(25);
  }
}

/**
 * Clicks into a field, focuses it and replaces (or appends to) its content with typed text.
 * `strict` refuses a target that did not take keyboard focus.
 */
export async function fillTarget(
  tabId: number,
  t: Target,
  value: string,
  ctx: ToolCtx,
  opts: { clear?: boolean; slowly?: boolean; strict?: boolean } = {},
) {
  const clear = opts.clear !== false;
  await clickTarget(tabId, t);
  await sleep(80);
  const focus = await frameCall<{ focused: boolean }>(tabId, t.frameId, { cmd: 'focus-and-select', ref: t.local, clear });
  if (opts.strict && !focus.focused && !t.prep.editable) {
    throw new ToolError(`${t.prep.label} did not take keyboard focus. Snapshot again and type into the actual text field.`);
  }
  if (clear) {
    // Replace the selection; also covers editors that ignore programmatic selection.
    await selectAll(tabId);
    if (!value) await pressKey(tabId, 'Backspace');
  }
  await typeText(tabId, value, !!opts.slowly, ctx);
}
