// Key definitions for CDP Input.dispatchKeyEvent and shortcut parsing
// ("Control+Shift+K", "Meta+a", "Enter").

export interface KeyDef {
  key: string;
  code: string;
  keyCode: number;
  text?: string;
}

const NAMED: Record<string, KeyDef> = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  Space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Home: { key: 'Home', code: 'Home', keyCode: 36 },
  End: { key: 'End', code: 'End', keyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  Insert: { key: 'Insert', code: 'Insert', keyCode: 45 },
  Shift: { key: 'Shift', code: 'ShiftLeft', keyCode: 16 },
  Control: { key: 'Control', code: 'ControlLeft', keyCode: 17 },
  Alt: { key: 'Alt', code: 'AltLeft', keyCode: 18 },
  Meta: { key: 'Meta', code: 'MetaLeft', keyCode: 91 },
};
for (let i = 1; i <= 12; i++) NAMED[`F${i}`] = { key: `F${i}`, code: `F${i}`, keyCode: 111 + i };

const ALIASES: Record<string, string> = {
  esc: 'Escape', return: 'Enter', del: 'Delete', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft',
  right: 'ArrowRight', ctrl: 'Control', control: 'Control', cmd: 'Meta', command: 'Meta', meta: 'Meta',
  win: 'Meta', option: 'Alt', alt: 'Alt', shift: 'Shift', space: 'Space', pgup: 'PageUp', pgdn: 'PageDown',
};

const PUNCT_CODES: Record<string, [string, number]> = {
  '-': ['Minus', 189], '=': ['Equal', 187], '[': ['BracketLeft', 219], ']': ['BracketRight', 221],
  '\\': ['Backslash', 220], ';': ['Semicolon', 186], "'": ['Quote', 222], ',': ['Comma', 188],
  '.': ['Period', 190], '/': ['Slash', 191], '`': ['Backquote', 192],
};

export const MODIFIER_BITS: Record<string, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };

export function keyDef(name: string): KeyDef {
  const canonical = NAMED[name] ? name : ALIASES[name.toLowerCase()] ?? name;
  if (NAMED[canonical]) return NAMED[canonical];
  if (canonical.length === 1) {
    const ch = canonical;
    if (/[a-z]/i.test(ch)) return { key: ch, code: `Key${ch.toUpperCase()}`, keyCode: ch.toUpperCase().charCodeAt(0), text: ch };
    if (/[0-9]/.test(ch)) return { key: ch, code: `Digit${ch}`, keyCode: ch.charCodeAt(0), text: ch };
    const p = PUNCT_CODES[ch];
    if (p) return { key: ch, code: p[0], keyCode: p[1], text: ch };
    return { key: ch, code: '', keyCode: 0, text: ch };
  }
  throw new Error(`Unknown key "${name}". Use names like Enter, Escape, Tab, ArrowDown, Backspace, F5, or single characters.`);
}

export function parseShortcut(combo: string): { modifiers: string[]; key: KeyDef } {
  // "Control++" means Control and the plus key.
  const parts = combo === '+' ? ['+'] : combo.split(/\+(?!$)/);
  const keyName = parts.pop()!;
  const modifiers = parts.map((m) => {
    const c = ALIASES[m.toLowerCase()] ?? m;
    if (!(c in MODIFIER_BITS)) throw new Error(`Unknown modifier "${m}" in "${combo}". Use Control, Alt, Shift or Meta.`);
    return c;
  });
  return { modifiers, key: keyDef(keyName) };
}

/** Editing commands Chrome on macOS needs explicitly for synthetic shortcuts. */
export function macCommands(modifiers: string[], key: KeyDef): string[] | undefined {
  const primary = modifiers.includes('Meta') && !modifiers.includes('Control');
  if (!primary) return undefined;
  const k = key.key.toLowerCase();
  const shift = modifiers.includes('Shift');
  const map: Record<string, string> = { a: 'selectAll', c: 'copy', v: 'paste', x: 'cut', z: shift ? 'redo' : 'undo' };
  return map[k] ? [map[k]] : undefined;
}
