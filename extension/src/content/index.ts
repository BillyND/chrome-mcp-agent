// Content script, injected into every frame (including cross-origin iframes).
// It reads and prepares elements; the background performs the real input
// events through the Chrome DevTools Protocol.

import type { FrameRequest, FrameResponse, PrepareResult, RuntimeMessage } from '../messages';
import { clean, describe, isEditable, shadowRootOf } from './dom';
import { isOverlay, runOverlay } from './overlay';
import { refFor, resolveRef } from './refs';
import { buildSnapshot } from './snapshot';

declare global {
  interface Window {
    __chromeMcpAgent?: boolean;
  }
}

const ANNOUNCE = '__chrome_mcp_agent_announce__';

function deepElementFromPoint(x: number, y: number): Element | null {
  let el = document.elementFromPoint(x, y);
  while (el) {
    const root = shadowRootOf(el);
    const inner = root?.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
}

function containsDeep(parent: Element, child: Element | null): boolean {
  for (let n: Node | null = child; n; ) {
    if (n === parent) return true;
    n = n.parentNode ?? (n instanceof ShadowRoot ? n.host : null);
  }
  return false;
}

function prepare(ref: string, scroll: boolean): PrepareResult {
  const el = resolveRef(ref);
  if (scroll) {
    const r = el.getBoundingClientRect();
    const inView = r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
    if (!inView) el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  }
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) throw new Error(`${describe(el)} (${ref}) has no size on screen; it may be hidden or collapsed.`);
  // Try the center first, then inset points, to find a spot the element actually receives.
  const candidates = [
    [0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75], [0.15, 0.15], [0.85, 0.85],
  ].map(([fx, fy]) => ({ x: r.left + r.width * fx, y: r.top + r.height * fy }))
    .filter((p) => p.x >= 0 && p.y >= 0 && p.x < innerWidth && p.y < innerHeight);
  let point = candidates[0] ?? { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  let coveredBy: string | undefined;
  for (const p of candidates) {
    const hit = deepElementFromPoint(p.x, p.y);
    if (!hit || isOverlay(hit) || containsDeep(el, hit) || (el instanceof HTMLLabelElement && el.control === hit)) {
      point = p;
      coveredBy = undefined;
      break;
    }
    // Labels and wrappers commonly sit on top of the real input: accept a hit that the element contains or labels.
    if (hit instanceof HTMLLabelElement && hit.control === el) {
      point = p;
      coveredBy = undefined;
      break;
    }
    coveredBy ??= describe(hit);
  }
  return {
    point,
    rect: { x: r.left, y: r.top, width: r.width, height: r.height },
    label: describe(el),
    tag: el.localName,
    inputType: el instanceof HTMLInputElement ? el.type : undefined,
    editable: isEditable(el),
    checked: el instanceof HTMLInputElement ? el.checked : el.getAttribute('aria-checked') === 'true' ? true : el.hasAttribute('aria-checked') ? false : undefined,
    coveredBy,
  };
}

function focusAndSelect(ref: string, clear: boolean): { focused: boolean } {
  const el = resolveRef(ref) as HTMLElement;
  el.focus({ preventScroll: true });
  if (!clear) {
    // Put the caret at the end so typed text is appended.
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      try {
        el.setSelectionRange(el.value.length, el.value.length);
      } catch {
        /* types like number/email don't support selection ranges */
      }
    } else if (el.isContentEditable) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
    }
  } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.select();
  } else if (el.isContentEditable) {
    const range = document.createRange();
    range.selectNodeContents(el);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
  }
  const active = document.activeElement;
  return { focused: active === el || containsDeep(el, active) || (active?.shadowRoot != null && containsDeep(active, el)) };
}

function fire(el: Element, ...types: string[]) {
  for (const t of types) el.dispatchEvent(new Event(t, { bubbles: true, composed: true }));
}

function selectOption(ref: string, values: string[]): string {
  const el = resolveRef(ref);
  if (!(el instanceof HTMLSelectElement)) throw new Error(`${describe(el)} is not a <select>. Click it and then click the option instead.`);
  const wanted = values.map((v) => v.trim().toLowerCase());
  const matched: string[] = [];
  for (const opt of el.options) {
    const hit = wanted.includes(opt.value.toLowerCase()) || wanted.includes((opt.label || opt.text).trim().toLowerCase());
    if (el.multiple) opt.selected = hit;
    else if (hit && matched.length === 0) {
      el.value = opt.value;
    }
    if (hit) matched.push(opt.label || opt.text);
  }
  if (!matched.length) {
    const options = [...el.options].map((o) => `"${clean(o.label || o.text, 60)}"`).slice(0, 40).join(', ');
    throw new Error(`No option matches ${JSON.stringify(values)}. Options: ${options}`);
  }
  fire(el, 'input', 'change');
  return `Selected ${matched.map((m) => `"${clean(m, 60)}"`).join(', ')}`;
}

function setFiles(ref: string, files: Array<{ name: string; mimeType: string; base64: string }>): string {
  const el = resolveRef(ref);
  if (!(el instanceof HTMLInputElement) || el.type !== 'file') {
    throw new Error(`${describe(el)} is not a file input. Find the <input type=file> (it may be hidden; look for a button near "upload").`);
  }
  const dt = new DataTransfer();
  for (const f of files) {
    const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
    dt.items.add(new File([bytes], f.name, { type: f.mimeType }));
  }
  el.files = dt.files;
  fire(el, 'input', 'change');
  return `Attached ${files.map((f) => f.name).join(', ')}`;
}

function readText(ref?: string): string {
  const el = ref ? resolveRef(ref) : document.body;
  if (!el) return '';
  const text = (el as HTMLElement).innerText ?? el.textContent ?? '';
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function scrollElement(ref: string | undefined, dx: number, dy: number) {
  const el = ref ? resolveRef(ref) : (document.scrollingElement ?? document.documentElement);
  el.scrollBy({ left: dx, top: dy, behavior: 'instant' });
  return { scrollTop: Math.round(el.scrollTop), scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
}

async function handle(req: FrameRequest): Promise<unknown> {
  switch (req.cmd) {
    case 'ping':
      return { url: location.href, top: window === window.top };
    case 'snapshot':
      return buildSnapshot(req.prefix);
    case 'announce-to-parent':
      window.parent.postMessage({ [ANNOUNCE]: req.nonce }, '*');
      return true;
    case 'prepare':
      return prepare(req.ref, req.scroll);
    case 'focus-and-select':
      return focusAndSelect(req.ref, req.clear);
    case 'select-option':
      return selectOption(req.ref, req.values);
    case 'set-files':
      return setFiles(req.ref, req.files);
    case 'get-text':
      return readText(req.ref);
    case 'has-text':
      return (document.body?.innerText ?? '').toLowerCase().includes(req.text.toLowerCase());
    case 'mark-for-eval': {
      const el = resolveRef(req.ref);
      el.setAttribute('data-cma-eval', req.nonce);
      return true;
    }
    case 'scroll-element':
      return scrollElement(req.ref, req.dx, req.dy);
    case 'scroll-info': {
      const s = document.scrollingElement ?? document.documentElement;
      return { scrollY: Math.round(s.scrollTop), scrollHeight: s.scrollHeight, viewport: innerHeight };
    }
    case 'overlay':
      await runOverlay(req.action);
      return true;
    case 'identify-child':
      return true;
  }
}

if (!window.__chromeMcpAgent) {
  window.__chromeMcpAgent = true;

  chrome.runtime.onMessage.addListener((req: FrameRequest, _sender, sendResponse: (r: FrameResponse) => void) => {
    if (!req || typeof req !== 'object' || !('cmd' in req)) return false;
    handle(req).then(
      (value) => sendResponse({ ok: true, value }),
      (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
    );
    return true;
  });

  // A child frame announces itself with postMessage; event.source tells us which
  // <iframe> it is even across origins, which gives the frame's offset and ref.
  window.addEventListener('message', (event) => {
    const nonce = (event.data as Record<string, unknown> | null)?.[ANNOUNCE];
    if (typeof nonce !== 'string' || !event.source) return;
    const frames: Element[] = [];
    const collect = (root: Document | ShadowRoot) => {
      for (const el of root.querySelectorAll('*')) {
        if (el instanceof HTMLIFrameElement || el instanceof HTMLFrameElement) frames.push(el);
        const sr = shadowRootOf(el);
        if (sr) collect(sr);
      }
    };
    collect(document);
    const frame = frames.find((f) => (f as HTMLIFrameElement).contentWindow === event.source);
    if (!frame) return;
    const r = frame.getBoundingClientRect();
    const cs = getComputedStyle(frame);
    const offset = {
      x: r.left + frame.clientLeft + parseFloat(cs.paddingLeft || '0'),
      y: r.top + frame.clientTop + parseFloat(cs.paddingTop || '0'),
    };
    const msg: RuntimeMessage = { type: 'frame-identified', nonce, offset, iframeRef: refFor(frame) };
    chrome.runtime.sendMessage(msg).catch(() => {});
    event.stopImmediatePropagation();
  }, true);
}
