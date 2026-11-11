// Builds a compact accessibility-style outline of this frame, in the style of
// Playwright MCP snapshots:
//   - heading "Inbox" [level=1]
//   - textbox "Search mail" [ref=e4] value="invoice"
//   - iframe "Compose" [ref=e9]:
//     ⟦frame:e9⟧          <- replaced by the background with the child frame's outline
// Interactive elements get stable refs; plain text is kept so the model can read the page.

import { accessibleName, children, clean, hasSize, isEditable, isInteractive, isVisible, roleOf } from './dom';
import { pruneRefs, refFor } from './refs';
import { isConcealedText } from './visibility';

export const FRAME_PLACEHOLDER = (ref: string) => `⟦frame:${ref}⟧`;

const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'head', 'meta', 'link', 'br', 'hr']);
const CONTAINER_ROLES = new Set([
  'navigation', 'main', 'banner', 'contentinfo', 'complementary', 'form', 'dialog', 'alertdialog', 'list',
  'table', 'row', 'group', 'menu', 'menubar', 'tablist', 'tabpanel', 'toolbar', 'tree', 'grid', 'region',
  'listbox', 'radiogroup', 'alert', 'status', 'search', 'article', 'feed',
]);
const MAX_LINES = 4000;

function attrs(el: Element, role: string): string {
  const out: string[] = [];
  if (role === 'heading') out.push(`level=${el.localName.match(/^h(\d)$/)?.[1] ?? el.getAttribute('aria-level') ?? '2'}`);
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
    if (el.checked) out.push('checked');
  } else if (el.getAttribute('aria-checked') === 'true') out.push('checked');
  if (el.getAttribute('aria-pressed') === 'true') out.push('pressed');
  if (el.getAttribute('aria-selected') === 'true') out.push('selected');
  const expanded = el.getAttribute('aria-expanded');
  if (expanded) out.push(`expanded=${expanded}`);
  if ((el as HTMLInputElement).disabled || el.getAttribute('aria-disabled') === 'true') out.push('disabled');
  if ((el as HTMLInputElement).required) out.push('required');
  if (el === document.activeElement) out.push('focused');
  return out.length ? ` [${out.join(', ')}]` : '';
}

function valueOf(el: Element): string {
  if (el instanceof HTMLInputElement) {
    if (['checkbox', 'radio', 'button', 'submit', 'reset', 'image'].includes(el.type)) return '';
    if (el.type === 'file') return el.files?.length ? ` files="${[...el.files].map((f) => f.name).join(', ')}"` : '';
    if (el.type === 'password') return el.value ? ' value="••••"' : '';
    const placeholder = !el.value && el.placeholder ? ` placeholder="${clean(el.placeholder, 80)}"` : '';
    return (el.value ? ` value="${clean(el.value, 300)}"` : '') + placeholder + (el.type && el.type !== 'text' ? ` type=${el.type}` : '');
  }
  if (el instanceof HTMLTextAreaElement) return el.value ? ` value="${clean(el.value, 500)}"` : '';
  if (el instanceof HTMLSelectElement) {
    const selected = [...el.selectedOptions].map((o) => clean(o.label || o.text, 80));
    return selected.length ? ` value="${selected.join(', ')}"` : '';
  }
  if (el instanceof HTMLAnchorElement && el.href && !el.href.startsWith('javascript:')) {
    return ` -> ${clean(el.getAttribute('href'), 120)}`;
  }
  if (el instanceof HTMLElement && el.isContentEditable) {
    const text = clean(el.innerText, 500);
    return text ? ` value="${text}"` : '';
  }
  return '';
}

export function buildSnapshot(prefix: string): string {
  pruneRefs();
  const lines: string[] = [];
  let truncated = false;

  const push = (depth: number, text: string) => {
    if (lines.length >= MAX_LINES) {
      truncated = true;
      return;
    }
    lines.push(`${'  '.repeat(depth)}- ${text}`);
  };

  const pushText = (depth: number, raw: string) => {
    const text = clean(raw, 400);
    if (!text) return;
    const prev = lines[lines.length - 1];
    // Merge consecutive text fragments of the same block (inline formatting splits text nodes).
    if (prev?.startsWith(`${'  '.repeat(depth)}- text: `) && prev.length < 600) {
      lines[lines.length - 1] = `${prev} ${text}`;
    } else {
      push(depth, `text: ${text}`);
    }
  };

  const walk = (node: Node, depth: number) => {
    if (truncated) return;
    if (node.nodeType === Node.TEXT_NODE) {
      if (isConcealedText(node.parentElement)) return;
      pushText(depth, node.textContent ?? '');
      return;
    }
    if (!(node instanceof Element)) {
      if (node instanceof DocumentFragment) for (const c of children(node as ShadowRoot)) walk(c, depth);
      return;
    }
    const el = node;
    if (SKIP_TAGS.has(el.localName) && el.localName !== 'svg') return;
    if (!isVisible(el)) return;
    const role = roleOf(el);

    if (el.localName === 'svg') {
      const name = clean(el.getAttribute('aria-label') ?? el.querySelector('title')?.textContent);
      if (name && isInteractive(el, role)) push(depth, `img "${name}" [ref=${prefix}${refFor(el)}]`);
      return;
    }

    if (role === 'iframe') {
      const ref = prefix + refFor(el);
      const name = accessibleName(el);
      push(depth, `iframe${name ? ` "${name}"` : ''} [ref=${ref}]:`);
      lines.push(`${'  '.repeat(depth + 1)}${FRAME_PLACEHOLDER(ref)}`);
      return;
    }

    if (role === 'canvas') {
      const r = el.getBoundingClientRect();
      if (r.width >= 24 && r.height >= 24) {
        const name = accessibleName(el);
        push(depth, `canvas${name ? ` "${name}"` : ''} [ref=${prefix}${refFor(el)}] size=${Math.round(r.width)}x${Math.round(r.height)} (drawn content: use browser_screenshot, then browser_mouse_xy with this ref)`);
      }
      return;
    }

    const interactive = isInteractive(el, role) && hasSize(el);
    if (interactive) {
      const name = accessibleName(el);
      const shownRole = role ?? 'generic';
      push(depth, `${shownRole}${name ? ` "${name}"` : ''}${attrs(el, shownRole)} [ref=${prefix}${refFor(el)}]${valueOf(el)}`);
      if (el instanceof HTMLSelectElement) {
        for (const opt of [...el.options].slice(0, 60)) {
          push(depth + 1, `option "${clean(opt.label || opt.text, 80)}"${opt.selected ? ' [selected]' : ''}${opt.value && opt.value !== opt.text ? ` value="${clean(opt.value, 60)}"` : ''}`);
        }
        if (el.options.length > 60) push(depth + 1, `… ${el.options.length - 60} more options`);
        return;
      }
      // Leaf controls: their text is already the name. Composite widgets keep walking.
      if (!['listbox', 'menu', 'tablist', 'tree', 'grid', 'combobox', 'dialog'].includes(shownRole) || isEditable(el)) {
        // Still surface nested interactive descendants (e.g. a card link containing a button).
        const nested = el.querySelectorAll('a[href],button,input,select,textarea,[role=button],[role=link],[role=checkbox],[role=menuitem],[role=tab],[contenteditable=true]');
        if (!isEditable(el) && nested.length > 0 && nested.length < 30) {
          for (const n of nested) {
            if (n === el || !isVisible(n) || !hasSize(n)) continue;
            const nRole = roleOf(n) ?? 'generic';
            const nName = accessibleName(n);
            push(depth + 1, `${nRole}${nName ? ` "${nName}"` : ''}${attrs(n, nRole)} [ref=${prefix}${refFor(n)}]${valueOf(n)}`);
          }
        }
        return;
      }
      for (const c of children(el)) walk(c, depth + 1);
      return;
    }

    if (role === 'heading') {
      const name = accessibleName(el);
      if (name) push(depth, `heading "${name}"${attrs(el, role)}`);
      return;
    }
    if (role === 'img') {
      const name = accessibleName(el);
      if (name) push(depth, `img "${name}"`);
      return;
    }
    if (role && CONTAINER_ROLES.has(role)) {
      const name = el.getAttribute('aria-label') ?? (role === 'dialog' ? clean(el.querySelector('h1,h2,h3')?.textContent, 80) : '');
      push(depth, `${role}${name ? ` "${clean(name, 80)}"` : ''}:`);
      for (const c of children(el)) walk(c, depth + 1);
      return;
    }
    if (role === 'listitem' || role === 'cell' || role === 'columnheader') {
      push(depth, `${role}:`);
      const before = lines.length;
      for (const c of children(el)) walk(c, depth + 1);
      // Collapse "- listitem:" + single text child into one line.
      if (lines.length === before + 1 && lines[before].trimStart().startsWith('- text: ')) {
        lines.splice(before - 1, 2, `${'  '.repeat(depth)}- ${role}: ${lines[before].trimStart().slice(8)}`);
      } else if (lines.length === before) {
        lines.pop();
      }
      return;
    }
    for (const c of children(el)) walk(c, depth);
  };

  walk(document.body ?? document.documentElement, 0);
  if (truncated) lines.push(`- … (snapshot truncated after ${MAX_LINES} lines; use browser_get_text or scroll for more)`);
  return lines.join('\n');
}
