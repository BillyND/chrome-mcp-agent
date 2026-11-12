// The visible side of the agent, drawn in the top frame only: a cursor that
// glides to each target before the real input event fires, and a bar with a
// Stop button.
// Motion follows the Codex Computer Use style: a curved path (quadratic Bézier
// bowed to one side) timed by a lightly damped spring, with the pointer tilting
// into the direction of travel and a small press on click.
// Everything lives in a closed shadow root with pointer-events: none (except
// the bar's buttons) so it never changes what the page receives.

import { getPrefs, isDark, t, tf, type Key, type Prefs } from '../i18n';
import type { OverlayAction, PromptSpec, RuntimeMessage } from '../messages';

const CSS = `
:host{all:initial}
.layer{position:fixed;inset:0;pointer-events:none;z-index:2147483647;font:500 13px/1.4 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --bg:#fff;--fg:#09090b;--muted:#71717a;--border:#e4e4e7;--danger:#dc2626;--primary:#18181b;--primary-fg:#fafafa}
.layer.dark{--bg:#18181b;--fg:#fafafa;--muted:#a1a1aa;--border:#27272a;--danger:#f87171;--primary:#fafafa;--primary-fg:#18181b}
.cursor{position:fixed;left:0;top:0;width:28px;height:28px;transform:translate(-100px,-100px);will-change:transform;opacity:0;transition:opacity .3s ease}
.cursor.on{opacity:1}
.cursor svg{display:block;overflow:visible;transform-origin:4px 3px;transition:transform .12s ease-out;filter:drop-shadow(0 4px 8px rgba(0,0,0,.25))}
.bar{position:fixed;left:50%;bottom:16px;transform:translateX(-50%) translateY(12px);display:flex;align-items:center;gap:10px;padding:6px 6px 6px 12px;border-radius:12px;background:var(--bg);color:var(--fg);border:1px solid var(--border);box-shadow:0 10px 30px -10px rgba(0,0,0,.25),0 2px 6px -2px rgba(0,0,0,.08);opacity:0;transition:opacity .2s ease,transform .2s ease;pointer-events:none}
.bar.top{bottom:auto;top:16px}
.bar.on{opacity:1;transform:translateX(-50%) translateY(0);pointer-events:auto}
.dot{width:7px;height:7px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 0 rgba(34,197,94,.6);animation:p 1.6s infinite}
.paused .dot{background:#f59e0b;animation:none}
@keyframes p{70%{box-shadow:0 0 0 6px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}
.txt{white-space:nowrap}
button{all:unset;cursor:pointer;font:500 12px/1 ui-sans-serif,system-ui,sans-serif;height:28px;padding:0 12px;border-radius:8px;display:inline-flex;align-items:center;border:1px solid var(--border);color:var(--danger);background:var(--bg);transition:background .15s}
button:hover{background:color-mix(in srgb,var(--danger) 8%,var(--bg))}
.paused button{background:var(--primary);color:var(--primary-fg);border-color:var(--primary)}
.prompts{position:fixed;top:16px;right:16px;width:min(380px,calc(100vw - 32px));display:flex;flex-direction:column;gap:8px}
.prompt{pointer-events:auto;padding:12px 14px;border-radius:12px;background:var(--bg);color:var(--fg);border:1px solid var(--border);box-shadow:0 10px 30px -10px rgba(0,0,0,.3),0 2px 6px -2px rgba(0,0,0,.1)}
.prompt h4{margin:0 0 4px;font:600 14px/1.35 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;word-break:break-word}
.prompt p{margin:0 0 10px;color:var(--muted);font:400 12px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;word-break:break-word}
.prompt .row{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}
.prompt button{color:var(--fg)}
.prompt button:hover{background:color-mix(in srgb,var(--fg) 6%,var(--bg))}
.prompt button.primary{background:var(--primary);color:var(--primary-fg);border-color:var(--primary)}
`;

// Rounded pointer: zinc-900 body with a white rim, readable on light and dark pages.
const CURSOR_SVG = `<svg width="28" height="28" viewBox="0 0 28 28"><path d="M4.6 3.2c-.5-.3-1.1.2-.9.7l6.6 19.2c.2.6 1.1.6 1.3 0l2.5-7.1c.1-.3.3-.5.6-.6l7.1-2.6c.6-.2.6-1.1 0-1.3z" fill="#18181b" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>`;

let host: HTMLElement | null = null;
let parts: { layer: HTMLElement; cursor: HTMLElement; arrow: SVGElement; bar: HTMLElement; txt: HTMLElement; btn: HTMLButtonElement; prompts: HTMLElement } | null = null;
let pos: { x: number; y: number } | null = null;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let frame = 0;
let paused = false;
let bowSide = 1;
let prefs: Prefs = { lang: 'en', theme: 'light' };
let currentLabelKey: 'bar_working' | 'bar_paused' = 'bar_working';

function ensure() {
  if (parts && host?.isConnected) return parts;
  host = document.createElement('helmsman-overlay');
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>${CSS}</style><div class="layer"><div class="cursor">${CURSOR_SVG}</div><div class="bar"><span class="dot"></span><span class="txt"></span><button></button></div><div class="prompts"></div></div>`;
  const q = <T extends Element>(s: string) => root.querySelector(s) as unknown as T;
  parts = { layer: q('.layer'), cursor: q('.cursor'), arrow: q('svg'), bar: q('.bar'), txt: q('.txt'), btn: q('button'), prompts: q('.prompts') };
  void loadPrefs();
  parts.btn.addEventListener('click', (e) => {
    e.stopPropagation();
    chrome.runtime.sendMessage({ type: paused ? 'resume' : 'stop' }).catch(() => {});
  });
  (document.documentElement ?? document.body).appendChild(host);
  return parts;
}

export function isOverlay(el: Element | null): boolean {
  return !!el && el === host;
}

async function loadPrefs() {
  prefs = await getPrefs();
  applyPrefs();
}

function applyPrefs() {
  if (!parts) return;
  parts.layer.classList.toggle('dark', isDark(prefs.theme));
  parts.txt.textContent = t(prefs.lang, paused ? 'bar_paused' : currentLabelKey);
  parts.btn.textContent = t(prefs.lang, paused ? 'resume' : 'stop');
}

// The user can switch language or theme in the popup while a page is open.
chrome.storage.onChanged.addListener((changes) => {
  if (changes.prefs) void loadPrefs();
});

function renderBar() {
  const p = ensure();
  p.bar.classList.toggle('paused', paused);
  currentLabelKey = paused ? 'bar_paused' : 'bar_working';
  applyPrefs();
  p.bar.classList.add('on');
  markState('shown');
}

/** Mirrors the visible state on the host element (`data-state`) for tests and debugging. */
function markState(state: 'shown' | 'hidden' | 'concealed') {
  host?.setAttribute('data-state', state);
}

function hideAll() {
  markState('hidden');
  if (!parts) return;
  parts.bar.classList.remove('on');
  parts.cursor.classList.remove('on');
}

/**
 * The bar and cursor stay up for a full minute after the last command: AI clients often think
 * for 10–30 s between steps, and the user must keep seeing that an agent is in control.
 */
const IDLE_HIDE_MS = 60_000;

function scheduleHide() {
  clearTimeout(hideTimer);
  if (paused) return;
  hideTimer = setTimeout(hideAll, IDLE_HIDE_MS);
}

function setConcealed(concealed: boolean) {
  if (parts) parts.layer.style.visibility = concealed ? 'hidden' : '';
  markState(concealed ? 'concealed' : 'shown');
}

function place(x: number, y: number, tilt = 0, scale = 1) {
  const p = ensure();
  p.cursor.style.transform = `translate(${x - 3}px,${y - 2}px)`;
  p.arrow.style.transform = `rotate(${tilt}deg) scale(${scale})`;
}

/** Lightly damped spring step response: starts fast, settles with a hint of overshoot. */
function spring(t: number): number {
  const zeta = 0.78;
  const omega = 9.5;
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  const decay = Math.exp(-zeta * omega * t);
  return 1 - decay * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t));
}

function moveTo(x: number, y: number, durationMs: number): Promise<void> {
  const p = ensure();
  cancelAnimationFrame(frame);
  p.cursor.classList.add('on');
  // Enter from the lower middle of the viewport the first time (or after navigation).
  const from = pos ?? { x: innerWidth / 2, y: innerHeight - 80 };
  const dx = x - from.x;
  const dy = y - from.y;
  const dist = Math.hypot(dx, dy);
  pos = { x, y };
  if (dist < 2) {
    place(x, y);
    return Promise.resolve();
  }
  // Bow the path to alternating sides, more for longer moves, like a hand sweeping the mouse.
  bowSide = -bowSide;
  const bow = Math.min(140, dist * 0.22) * bowSide;
  const cx = from.x + dx / 2 + (-dy / dist) * bow;
  const cy = from.y + dy / 2 + (dx / dist) * bow;
  const duration = Math.max(240, durationMs);
  const start = performance.now();
  return new Promise((resolve) => {
    let lastX = from.x;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // A gentle ease-in before the spring so the cursor accelerates instead of jumping off.
      const k = t >= 1 ? 1 : spring(Math.pow(t, 1.35) * 1.15);
      const u = 1 - k;
      const px = u * u * from.x + 2 * u * k * cx + k * k * x;
      const py = u * u * from.y + 2 * u * k * cy + k * k * y;
      // Tilt into horizontal motion, relaxing to upright as it arrives.
      const vx = px - lastX;
      lastX = px;
      const tilt = Math.max(-14, Math.min(14, vx * 1.6)) * (1 - t);
      // Lift a little mid-flight, settle on arrival.
      place(px, py, tilt, 1 + 0.08 * Math.sin(Math.PI * Math.min(1, t * 1.4)));
      if (t < 1) frame = requestAnimationFrame(tick);
      else {
        place(x, y, 0);
        resolve();
      }
    };
    frame = requestAnimationFrame(tick);
  });
}

function press() {
  if (!pos) return;
  const { x, y } = pos;
  place(x, y, 0, 0.82);
  setTimeout(() => place(x, y, 0, 1), 110);
}

const PRIMARY = new Set(['once', 'approve', 'done']);

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The confirmation card: built with textContent only, because the label can come from the page. */
async function showPrompt(spec: PromptSpec): Promise<void> {
  const p = ensure();
  await loadPrefs();
  const lang = prefs.lang;
  const params = { agent: spec.agent, host: spec.host, label: spec.label, reason: spec.label, category: t(lang, `cat_${spec.category}` as Key) };
  const title = tf(lang, `prompt_${spec.kind}` as Key, params);
  const detail = tf(lang, `prompt_${spec.kind}_detail` as Key, params);
  endPrompt(spec.id);
  const card = el('div', `prompt ${spec.kind}`);
  card.dataset.id = spec.id;
  card.setAttribute('role', 'alertdialog');
  card.append(el('h4', '', title), el('p', '', detail));
  const row = el('div', 'row');
  for (const choice of spec.choices) {
    const b = el('button', PRIMARY.has(choice) ? 'primary' : '', t(lang, `choice_${choice}` as Key));
    b.addEventListener('click', (e) => {
      // Only a real click by the user answers; a page or script cannot synthesize one.
      if (!e.isTrusted) return;
      e.stopPropagation();
      const msg: RuntimeMessage = { type: 'approval-decision', id: spec.id, choice };
      chrome.runtime.sendMessage(msg).catch(() => {});
      endPrompt(spec.id);
    });
    row.append(b);
  }
  card.append(row);
  p.prompts.append(card);
}

function endPrompt(id: string) {
  parts?.prompts.querySelectorAll('.prompt').forEach((c) => (c as HTMLElement).dataset.id === id && c.remove());
}

export async function runOverlay(action: OverlayAction): Promise<void> {
  if (window !== window.top) return;
  switch (action.type) {
    case 'show':
      paused = action.paused;
      renderBar();
      // A navigation recreates the overlay: bring the cursor back where the agent left it.
      if (action.cursor && !pos) {
        pos = action.cursor;
        place(pos.x, pos.y);
        ensure().cursor.classList.add('on');
      }
      break;
    case 'conceal':
      setConcealed(true);
      return;
    case 'reveal':
      setConcealed(false);
      break;
    case 'move':
      await moveTo(action.x, action.y, action.durationMs);
      break;
    case 'click':
      press();
      break;
    case 'avoid': {
      // Move the bar out of the way when the agent needs to click underneath it.
      const p = ensure();
      const r = p.bar.getBoundingClientRect();
      const under = action.x >= r.left - 8 && action.x <= r.right + 8 && action.y >= r.top - 8 && action.y <= r.bottom + 8;
      if (under) p.bar.classList.toggle('top');
      break;
    }
    case 'prompt':
      await showPrompt(action.prompt);
      return;
    case 'prompt-end':
      endPrompt(action.id);
      return;
    case 'hide':
      hideAll();
      return;
  }
  scheduleHide();
}
