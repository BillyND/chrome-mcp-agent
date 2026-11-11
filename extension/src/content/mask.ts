// Hides sensitive values while a screenshot or PDF is taken: every password field, every field
// holding a vault secret, and the text elements that show one. The page is restored right after.

import { shadowRootOf } from './dom';

const NOT_TEXT_INPUT = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image', 'range', 'color', 'hidden']);
const NO_TEXT = new Set(['script', 'style', 'noscript', 'textarea', 'template']);
/** Safety net: a mask that was never lifted (the service worker died mid-capture) goes away by itself. */
const MAX_MASK_MS = 30_000;

/** Opaque box with invisible text: the value cannot be read or guessed from the pixels. */
const FIELD_MASK: Array<[string, string]> = [
  ['background', '#000'],
  ['color', 'transparent'],
  ['-webkit-text-fill-color', 'transparent'],
  ['text-shadow', 'none'],
  ['caret-color', 'transparent'],
];
const TEXT_MASK: Array<[string, string]> = [['filter', 'blur(8px)']];

let masked: Array<{ el: HTMLElement; style: string | null }> = [];
let expiry: ReturnType<typeof setTimeout> | undefined;

function* deepElements(root: ParentNode): Generator<HTMLElement> {
  for (const el of root.querySelectorAll<HTMLElement>('*')) {
    yield el;
    const inner = shadowRootOf(el);
    if (inner) yield* deepElements(inner);
  }
}

const holdsSecret = (text: string, values: string[]) => values.some((v) => text.includes(v));

function fieldValue(el: HTMLElement): string | null {
  if (el instanceof HTMLTextAreaElement) return el.value;
  if (el instanceof HTMLInputElement) return NOT_TEXT_INPUT.has(el.type) ? null : el.value;
  return el.isContentEditable ? (el.textContent ?? '') : null;
}

function shows(el: HTMLElement, values: string[]): boolean {
  if (NO_TEXT.has(el.localName)) return false;
  return [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && holdsSecret(n.nodeValue ?? '', values));
}

function apply(el: HTMLElement, rules: Array<[string, string]>) {
  masked.push({ el, style: el.getAttribute('style') });
  for (const [prop, value] of rules) el.style.setProperty(prop, value, 'important');
}

/** Masks what must not be photographed. Returns how many elements were hidden. */
export function maskSecrets(values: string[]): number {
  unmaskSecrets();
  for (const el of deepElements(document)) {
    if (el instanceof HTMLInputElement && el.type === 'password') {
      apply(el, FIELD_MASK);
      continue;
    }
    const value = fieldValue(el);
    if (value !== null) {
      if (holdsSecret(value, values)) apply(el, FIELD_MASK);
    } else if (shows(el, values)) {
      apply(el, TEXT_MASK);
    }
  }
  expiry = setTimeout(unmaskSecrets, MAX_MASK_MS);
  return masked.length;
}

/** Puts every masked element back exactly as it was. */
export function unmaskSecrets(): void {
  clearTimeout(expiry);
  // Reverse order: an element masked after its ancestor must be restored first.
  for (const { el, style } of masked.reverse()) {
    if (style === null) el.removeAttribute('style');
    else el.setAttribute('style', style);
  }
  masked = [];
}
