// The visible side of the agent, drawn in the top frame only: a cursor that
// glides to each target before the real input event fires, and a bar with a
// Stop button.
// Motion follows the Codex Computer Use style: a curved path (quadratic Bézier
// bowed to one side) timed by a lightly damped spring, with the pointer tilting
// into the direction of travel and a small press on click.
// Everything lives in a closed shadow root with pointer-events: none (except
// the bar's buttons) so it never changes what the page receives.

import { getPrefs, isDark, t, type Prefs } from '../i18n';
import type { Choice, OverlayAction, PromptSpec, RuntimeMessage } from '../messages';
import { choiceLabel, isLink, isPrimary, promptCopy } from '../prompt-copy';

const CSS = `
:host{all:initial}
.layer{position:fixed;inset:0;pointer-events:none;z-index:2147483647;font:500 13px/1.4 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --bg:#fff;--fg:#09090b;--muted:#71717a;--border:#e4e4e7;--danger:#dc2626;--primary:#18181b;--primary-fg:#fafafa}
.layer.dark{--bg:#18181b;--fg:#fafafa;--muted:#a1a1aa;--border:#27272a;--danger:#f87171;--primary:#fafafa;--primary-fg:#18181b}
.cursor{position:fixed;left:0;top:0;width:24px;height:24px;transform:translate(-100px,-100px);will-change:transform;opacity:0;transition:opacity .3s ease}
.cursor.on{opacity:1}
.cursor svg{position:relative;display:block;overflow:visible;transform-origin:4.2px 3.2px;transition:transform .12s ease-out;filter:drop-shadow(0 0 1px rgba(255,255,255,.9)) drop-shadow(0 3px 6px rgba(0,0,0,.35))}
/* Beacon: a soft light pool under the tip shows where the agent is about to act. */
.spot{position:absolute;left:-15.8px;top:-16.8px;width:40px;height:40px;border-radius:50%;pointer-events:none;background:radial-gradient(circle,rgba(24,24,27,.20) 0%,rgba(24,24,27,.08) 35%,transparent 70%);transition:background .3s ease}
.cursor.ondark .spot{background:radial-gradient(circle,rgba(255,255,255,.55) 0%,rgba(255,255,255,.18) 35%,transparent 70%)}
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
.prompt .links{display:flex;justify-content:flex-end;margin-top:8px}
.prompt button.link{height:auto;padding:2px 0;border:0;border-radius:4px;background:none;color:var(--muted);font-weight:400;text-decoration:underline;text-underline-offset:2px}
.prompt button.link:hover{background:none;color:var(--fg)}
.prompt button:focus-visible{outline:2px solid var(--muted);outline-offset:2px}
`;

// Rounded pointer: zinc-900 body with a white rim, readable on light and dark pages.
// Rounded pointer: a thick, round-joined stroke in the fill colour rounds every corner; a wider
// white stroke underneath is the rim, and a top-down gloss gives it a little depth.
const CURSOR_PATH = 'M6 4.5 L24.5 13.2 Q25.6 13.8 24.4 14.3 L16.4 16.6 Q15.6 16.9 15.3 17.7 L12.6 25.3 Q12.2 26.4 11.6 25.3 Z';
const CURSOR_SVG = `<svg width="24" height="24" viewBox="0 0 34 34"><defs><linearGradient id="hm-gloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><path d="${CURSOR_PATH}" fill="#fff" stroke="#fff" stroke-width="6.4" stroke-linejoin="round"/><path d="${CURSOR_PATH}" fill="#18181b" stroke="#18181b" stroke-width="1.6" stroke-linejoin="round"/><path d="${CURSOR_PATH}" fill="url(#hm-gloss)"/></svg>`;

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
  root.innerHTML = `<style>${CSS}</style><div class="layer"><div class="cursor"><span class="spot"></span>${CURSOR_SVG}</div><div class="bar"><span class="dot"></span><span class="txt"></span><button></button></div><div class="prompts"></div></div>`;
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

/** True when the page behind the cursor is dark, so the beacon glows light instead of dark. */
function pageIsDark(): boolean {
  for (const el of [document.body, document.documentElement]) {
    if (!el) continue;
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(getComputedStyle(el).backgroundColor);
    if (!m || (m[4] !== undefined && Number(m[4]) < 0.5)) continue;
    const [r, g, b] = [m[1], m[2], m[3]].map(Number);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110;
  }
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

function place(x: number, y: number, tilt = 0, scale = 1) {
  const p = ensure();
  p.cursor.style.transform = `translate(${x - 4.2}px,${y - 3.2}px)`;
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
  p.cursor.classList.toggle('ondark', pageIsDark());
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
  const { title, detail } = promptCopy(lang, spec);
  endPrompt(spec.id);
  const card = el('div', `prompt ${spec.kind}`);
  card.dataset.id = spec.id;
  card.setAttribute('role', 'alertdialog');
  card.append(el('h4', '', title), el('p', '', detail));
  const row = el('div', 'row');
  const links = el('div', 'links');
  const choiceButton = (choice: Choice) => {
    const b = el('button', isLink(choice) ? 'link' : isPrimary(choice) ? 'primary' : '', choiceLabel(lang, spec, choice));
    b.addEventListener('click', (e) => {
      // Only a real click by the user answers; a page or script cannot synthesize one.
      if (!e.isTrusted) return;
      e.stopPropagation();
      const msg: RuntimeMessage = { type: 'approval-decision', id: spec.id, choice };
      chrome.runtime.sendMessage(msg).catch(() => {});
      endPrompt(spec.id);
    });
    (isLink(choice) ? links : row).append(b);
  };
  spec.choices.forEach(choiceButton);
  card.append(row);
  if (links.childElementCount) card.append(links);
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
        ensure().cursor.classList.toggle('ondark', pageIsDark());
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
