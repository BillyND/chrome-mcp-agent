// Text a person cannot see must not reach the model: prompt-injection pages hide instructions with
// opacity:0, tiny fonts, off-screen positioning or text coloured like its background. These helpers
// tell snapshots and get_text which text is concealed. (display:none, visibility:hidden and
// aria-hidden are already handled by isVisible in dom.ts.)

import { children, isVisible } from './dom';

type Rgba = [number, number, number, number];

function parseColor(value: string): Rgba | null {
  const m = /^rgba?\(([^)]+)\)$/.exec(value.trim());
  if (!m) return null;
  const parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
  return [parts[0], parts[1], parts[2], parts.length > 3 && !Number.isNaN(parts[3]) ? parts[3] : 1];
}

/** First opaque-enough background up the tree, or null when an image or gradient sits in between. */
function backgroundBehind(el: Element): [number, number, number] | null {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const cs = getComputedStyle(node);
    if (cs.backgroundImage !== 'none') return null;
    const bg = parseColor(cs.backgroundColor);
    if (bg && bg[3] > 0.5) return [bg[0], bg[1], bg[2]];
  }
  return [255, 255, 255];
}

/** True when this element's own text is invisible to a person (its ancestors are checked separately). */
function concealedSelf(el: Element): boolean {
  const cs = getComputedStyle(el);
  if (cs.display === 'contents') return false;
  if (Number(cs.opacity) < 0.05) return true;
  if (parseFloat(cs.fontSize) < 1) return true;
  const rect = el.getBoundingClientRect();
  if ((rect.width < 2 || rect.height < 2) && (cs.overflowX !== 'visible' || cs.overflowY !== 'visible')) return true;
  if (rect.right + scrollX <= 0 || rect.bottom + scrollY <= 0 || rect.left + scrollX > 50_000 || rect.top + scrollY > 500_000) return true;
  const color = parseColor(cs.color);
  if (!color) return false;
  if (color[3] < 0.05) return true;
  const bg = backgroundBehind(el);
  return !!bg && Math.abs(color[0] - bg[0]) + Math.abs(color[1] - bg[1]) + Math.abs(color[2] - bg[2]) <= 12;
}

// A snapshot runs synchronously, so one cache per task is always fresh.
let cache = new WeakMap<Element, boolean>();
let resetQueued = false;

function concealed(el: Element | null): boolean {
  if (!el) return false;
  if (!resetQueued) {
    resetQueued = true;
    queueMicrotask(() => {
      cache = new WeakMap();
      resetQueued = false;
    });
  }
  let known = cache.get(el);
  if (known === undefined) {
    known = concealedSelf(el) || concealed(el.parentElement);
    cache.set(el, known);
  }
  return known;
}

/** Whether text directly inside `el` is hidden from the user by styling or position. */
export const isConcealedText = (el: Element | null): boolean => concealed(el);

const SKIP = new Set(['script', 'style', 'noscript', 'template', 'head']);

function hasConcealedText(root: Node): boolean {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if ((n.textContent ?? '').trim() && concealed(n.parentElement)) return true;
  }
  return false;
}

function collect(node: Node, out: string[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push(node.textContent ?? '');
    return;
  }
  if (!(node instanceof Element) || SKIP.has(node.localName) || !isVisible(node) || concealed(node)) return;
  const block = !['inline', 'contents'].includes(getComputedStyle(node).display);
  if (block) out.push('\n');
  for (const c of children(node)) collect(c, out);
  if (block) out.push('\n');
}

/** Like innerText, but without text the user cannot see. Falls back to innerText when nothing is concealed. */
export function readVisibleText(root: HTMLElement): string {
  const plain = root.innerText ?? root.textContent ?? '';
  if (!hasConcealedText(root)) return plain;
  const out: string[] = [];
  for (const c of children(root)) collect(c, out);
  return out.join('').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n');
}
