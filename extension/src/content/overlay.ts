// The visible side of the agent, drawn in the top frame only: a cursor that
// glides to each target before the real input event fires, and a bar with a
// Stop button.
// Motion follows the Codex Computer Use style: a curved path (quadratic Bézier
// bowed to one side) timed by a lightly damped spring, with the pointer tilting
// into the direction of travel and a small press on click.
// Everything lives in a closed shadow root with pointer-events: none (except
// the bar's buttons) so it never changes what the page receives.

import type { OverlayAction } from '../messages';

const CSS = `
:host{all:initial}
.layer{position:fixed;inset:0;pointer-events:none;z-index:2147483647;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.cursor{position:fixed;left:0;top:0;width:26px;height:26px;transform:translate(-100px,-100px);will-change:transform;opacity:0;transition:opacity .25s ease}
.cursor.on{opacity:1}
.cursor svg{display:block;transform-origin:3px 2px;filter:drop-shadow(0 4px 8px rgba(30,27,75,.35)) drop-shadow(0 1px 1px rgba(0,0,0,.25))}
.bar{position:fixed;left:50%;bottom:18px;transform:translateX(-50%) translateY(20px);display:flex;align-items:center;gap:10px;padding:8px 8px 8px 14px;border-radius:14px;background:rgba(17,19,30,.92);color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.3);backdrop-filter:blur(8px);opacity:0;transition:opacity .25s,transform .25s;pointer-events:none}
.bar.top{bottom:auto;top:18px}
.bar.on{opacity:1;transform:translateX(-50%) translateY(0);pointer-events:auto}
.dot{width:8px;height:8px;border-radius:50%;background:#a78bfa;box-shadow:0 0 0 0 rgba(167,139,250,.7);animation:p 1.4s infinite}
.paused .dot{background:#fbbf24;animation:none}
@keyframes p{70%{box-shadow:0 0 0 8px rgba(167,139,250,0)}100%{box-shadow:0 0 0 0 rgba(167,139,250,0)}}
.txt{max-width:46vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.txt b{font-weight:600}
button{all:unset;cursor:pointer;font-weight:600;font-size:12px;padding:6px 12px;border-radius:9px}
.stop{background:#ef4444;color:#fff}.stop:hover{background:#dc2626}
.resume{background:#4f46e5;color:#fff}
`;

const CURSOR_SVG = `<svg width="26" height="26" viewBox="0 0 26 26"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#9333ea"/></linearGradient></defs><path d="M3 2.5 22 11.2l-8.1 2.3-3.7 7.8z" fill="url(#g)" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

let host: HTMLElement | null = null;
let parts: { cursor: HTMLElement; arrow: SVGElement; bar: HTMLElement; txt: HTMLElement; btn: HTMLButtonElement } | null = null;
let pos: { x: number; y: number } | null = null;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let frame = 0;
let paused = false;
let bowSide = 1;

function ensure() {
  if (parts && host?.isConnected) return parts;
  host = document.createElement('chrome-mcp-agent-overlay');
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>${CSS}</style><div class="layer"><div class="cursor">${CURSOR_SVG}</div><div class="bar"><span class="dot"></span><span class="txt"></span><button></button></div></div>`;
  const q = <T extends Element>(s: string) => root.querySelector(s) as unknown as T;
  parts = { cursor: q('.cursor'), arrow: q('svg'), bar: q('.bar'), txt: q('.txt'), btn: q('button') };
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

function renderBar(label: string) {
  const p = ensure();
  p.bar.classList.toggle('paused', paused);
  p.txt.innerHTML = '';
  const strong = document.createElement('b');
  strong.textContent = paused ? 'Đã dừng AI' : 'Chrome MCP Agent';
  p.txt.append(strong, document.createTextNode(paused ? ' · bấm Tiếp tục để AI làm tiếp' : ` · ${label}`));
  p.btn.textContent = paused ? 'Tiếp tục' : 'Dừng';
  p.btn.className = paused ? 'resume' : 'stop';
  p.bar.classList.add('on');
}

function hideAll() {
  if (!parts) return;
  parts.bar.classList.remove('on');
  parts.cursor.classList.remove('on');
}

function scheduleHide() {
  clearTimeout(hideTimer);
  if (paused) return;
  hideTimer = setTimeout(hideAll, 8000);
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
      place(px, py, tilt);
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

export async function runOverlay(action: OverlayAction): Promise<void> {
  if (window !== window.top) return;
  switch (action.type) {
    case 'show':
      paused = action.paused;
      renderBar(action.label);
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
    case 'hide':
      paused = false;
      hideAll();
      return;
  }
  scheduleHide();
}
