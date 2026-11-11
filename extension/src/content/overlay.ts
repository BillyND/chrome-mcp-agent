// The visible side of the agent, drawn in the top frame only: a purple cursor
// that glides to each target before the real input event fires, a highlight
// box, a click ripple, and a bar with a Stop button.
// Everything lives in a closed shadow root with pointer-events: none (except
// the bar's buttons) so it never changes what the page receives.

import type { OverlayAction, Rect } from '../messages';

const CSS = `
:host{all:initial}
.layer{position:fixed;inset:0;pointer-events:none;z-index:2147483647;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.cursor{position:fixed;left:0;top:0;width:26px;height:26px;transform:translate(-100px,-100px);transition-property:transform;transition-timing-function:cubic-bezier(.22,.8,.26,1);filter:drop-shadow(0 3px 6px rgba(49,46,129,.45));will-change:transform}
.cursor svg{display:block}
.tag{position:absolute;left:22px;top:20px;white-space:nowrap;max-width:260px;overflow:hidden;text-overflow:ellipsis;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;font-weight:600;font-size:12px;padding:4px 9px;border-radius:999px;box-shadow:0 4px 14px rgba(79,70,229,.35);opacity:0;transition:opacity .2s}
.tag.on{opacity:1}
.ripple{position:fixed;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:2px solid #7c3aed;animation:r .5s ease-out forwards}
@keyframes r{from{transform:scale(.3);opacity:1}to{transform:scale(1.6);opacity:0}}
.hl{position:fixed;border:2px solid #7c3aed;border-radius:6px;background:rgba(124,58,237,.08);box-shadow:0 0 0 4px rgba(124,58,237,.12);transition:all .18s ease;opacity:0}
.hl.on{opacity:1}
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
let parts: { cursor: HTMLElement; tag: HTMLElement; hl: HTMLElement; bar: HTMLElement; txt: HTMLElement; btn: HTMLButtonElement; layer: HTMLElement } | null = null;
let pos = { x: -100, y: -100 };
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let paused = false;

function ensure() {
  if (parts && host?.isConnected) return parts;
  host = document.createElement('chrome-mcp-agent-overlay');
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>${CSS}</style><div class="layer"><div class="hl"></div><div class="cursor">${CURSOR_SVG}<div class="tag"></div></div><div class="bar"><span class="dot"></span><span class="txt"></span><button></button></div></div>`;
  const q = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  parts = { layer: q('.layer'), cursor: q('.cursor'), tag: q('.tag'), hl: q('.hl'), bar: q('.bar'), txt: q('.txt'), btn: q('button') };
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

function scheduleHide() {
  clearTimeout(hideTimer);
  if (paused) return;
  hideTimer = setTimeout(() => {
    if (!parts) return;
    parts.bar.classList.remove('on');
    parts.tag.classList.remove('on');
    parts.hl.classList.remove('on');
    parts.cursor.style.opacity = '0';
  }, 8000);
}

function moveTo(x: number, y: number, durationMs: number): Promise<void> {
  const p = ensure();
  p.cursor.style.opacity = '1';
  // Start from the last known spot even after navigation recreated the overlay.
  if (pos.x < 0) {
    p.cursor.style.transitionDuration = '0ms';
    p.cursor.style.transform = `translate(${window.innerWidth / 2}px,${window.innerHeight - 60}px)`;
    void p.cursor.offsetWidth;
  }
  p.cursor.style.transitionDuration = `${durationMs}ms`;
  p.cursor.style.transform = `translate(${x - 3}px,${y - 2}px)`;
  pos = { x, y };
  return new Promise((r) => setTimeout(r, durationMs));
}

function highlight(rect: Rect | null) {
  const p = ensure();
  if (!rect) {
    p.hl.classList.remove('on');
    return;
  }
  Object.assign(p.hl.style, {
    left: `${rect.x - 3}px`,
    top: `${rect.y - 3}px`,
    width: `${rect.width + 6}px`,
    height: `${rect.height + 6}px`,
  });
  p.hl.classList.add('on');
}

function ripple(x: number, y: number) {
  const p = ensure();
  const r = document.createElement('div');
  r.className = 'ripple';
  r.style.left = `${x}px`;
  r.style.top = `${y}px`;
  p.layer.appendChild(r);
  setTimeout(() => r.remove(), 600);
}

export async function runOverlay(action: OverlayAction): Promise<void> {
  if (window !== window.top) return;
  switch (action.type) {
    case 'show':
      paused = action.paused;
      renderBar(action.label);
      break;
    case 'move': {
      const p = ensure();
      if (action.label) {
        p.tag.textContent = action.label;
        p.tag.classList.add('on');
      }
      await moveTo(action.x, action.y, action.durationMs);
      break;
    }
    case 'click':
      ripple(action.x, action.y);
      break;
    case 'highlight':
      highlight(action.rect);
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
      if (parts) {
        parts.bar.classList.remove('on');
        parts.tag.classList.remove('on');
        parts.hl.classList.remove('on');
        parts.cursor.style.opacity = '0';
      }
      return;
  }
  scheduleHide();
}
