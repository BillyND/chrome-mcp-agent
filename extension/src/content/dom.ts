// DOM helpers shared by the snapshot and the actions: accessible names, roles,
// visibility, and walking through open and closed shadow roots.

const INPUT_TEXT_TYPES = new Set(['text', 'email', 'search', 'url', 'tel', 'password', 'number', '']);

export function children(node: Element | ShadowRoot | Document): Node[] {
  if (node instanceof Element) {
    const root = shadowRootOf(node);
    if (root) return [...root.childNodes];
    if (node instanceof HTMLSlotElement) {
      const assigned = node.assignedNodes({ flatten: true });
      if (assigned.length) return assigned;
    }
  }
  return [...node.childNodes];
}

export function shadowRootOf(el: Element): ShadowRoot | null {
  // chrome.dom.openOrClosedShadowRoot reaches closed roots (web components in Gmail, Salesforce...).
  try {
    return (chrome.dom?.openOrClosedShadowRoot?.(el as HTMLElement) as ShadowRoot | null) ?? el.shadowRoot;
  } catch {
    return el.shadowRoot;
  }
}

export function isVisible(el: Element): boolean {
  if (el.getAttribute('aria-hidden') === 'true') return false;
  if (typeof el.checkVisibility === 'function') {
    if (!el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: false })) {
      // display:contents wrappers have no box of their own but their children render.
      return getComputedStyle(el).display === 'contents';
    }
  }
  return true;
}

export function hasSize(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

export function isEditable(el: Element): boolean {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) return INPUT_TEXT_TYPES.has(el.type) && !el.readOnly && !el.disabled;
  return el instanceof HTMLElement && el.isContentEditable;
}

const ROLE_BY_TAG: Record<string, string> = {
  a: 'link',
  button: 'button',
  select: 'combobox',
  textarea: 'textbox',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  img: 'img',
  iframe: 'iframe',
  frame: 'iframe',
  nav: 'navigation',
  main: 'main',
  header: 'banner',
  footer: 'contentinfo',
  aside: 'complementary',
  form: 'form',
  dialog: 'dialog',
  ul: 'list',
  ol: 'list',
  li: 'listitem',
  table: 'table',
  tr: 'row',
  td: 'cell',
  th: 'columnheader',
  summary: 'button',
  details: 'group',
  fieldset: 'group',
  option: 'option',
  video: 'video',
  audio: 'audio',
  label: 'label',
  progress: 'progressbar',
  meter: 'meter',
};

export function roleOf(el: Element): string | null {
  const explicit = el.getAttribute('role')?.split(/\s+/)[0];
  if (explicit && explicit !== 'presentation' && explicit !== 'none') return explicit;
  const tag = el.localName;
  if (tag === 'a') return el.hasAttribute('href') ? 'link' : null;
  if (tag === 'img') return el.getAttribute('alt') ? 'img' : null;
  if (tag === 'select') return (el as HTMLSelectElement).multiple ? 'listbox' : 'combobox';
  if (tag === 'input') {
    const type = (el as HTMLInputElement).type;
    if (type === 'hidden') return null;
    if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'range') return 'slider';
    if (type === 'search') return 'searchbox';
    if (type === 'file') return 'button';
    if (['date', 'datetime-local', 'month', 'time', 'week', 'color'].includes(type)) return 'textbox';
    return 'textbox';
  }
  if (el instanceof HTMLElement && el.isContentEditable && el.parentElement?.isContentEditable !== true) return 'textbox';
  return ROLE_BY_TAG[tag] ?? null;
}

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'listbox', 'option', 'menuitem',
  'menuitemcheckbox', 'menuitemradio', 'tab', 'switch', 'slider', 'spinbutton', 'treeitem', 'gridcell', 'iframe',
]);

export function isInteractive(el: Element, role: string | null): boolean {
  if (role && INTERACTIVE_ROLES.has(role)) return true;
  if (el instanceof HTMLElement) {
    if (el.onclick || el.hasAttribute('onclick') || el.getAttribute('draggable') === 'true') return true;
    const tabIndex = el.getAttribute('tabindex');
    if (tabIndex !== null && Number(tabIndex) >= 0) return true;
    if (el.localName !== 'body' && el.localName !== 'html' && getComputedStyle(el).cursor === 'pointer') {
      // Only the outermost pointer element of a clickable block, not each child.
      const parent = el.parentElement;
      return !parent || getComputedStyle(parent).cursor !== 'pointer';
    }
  }
  return false;
}

const clean = (s: string | null | undefined, max = 200) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
};

function byIds(el: Element, attr: string): string {
  const ids = el.getAttribute(attr);
  if (!ids) return '';
  const root = el.getRootNode() as Document | ShadowRoot;
  return ids
    .split(/\s+/)
    .map((id) => root.getElementById?.(id)?.textContent ?? document.getElementById(id)?.textContent ?? '')
    .join(' ');
}

export function accessibleName(el: Element): string {
  const fromAria = clean(el.getAttribute('aria-label')) || clean(byIds(el, 'aria-labelledby'));
  if (fromAria) return fromAria;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    const labels = el.labels ? [...el.labels].map((l) => l.textContent).join(' ') : '';
    if (clean(labels)) return clean(labels);
    if (el instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(el.type)) {
      return clean(el.value) || el.type;
    }
    if (el instanceof HTMLInputElement && el.type === 'image') return clean(el.alt);
    return clean(el.getAttribute('placeholder')) || clean(el.getAttribute('title')) || clean(el.getAttribute('name'));
  }
  if (el instanceof HTMLImageElement) return clean(el.alt);
  if (el instanceof HTMLIFrameElement || el.localName === 'frame') {
    return clean(el.getAttribute('title')) || clean(el.getAttribute('name'));
  }
  const text = clean((el as HTMLElement).innerText ?? el.textContent, 160);
  if (text) return text;
  const img = el.querySelector('img[alt]');
  if (img) return clean(img.getAttribute('alt'));
  return clean(el.getAttribute('title')) || clean(byIds(el, 'aria-describedby'), 80);
}

export function describe(el: Element): string {
  const role = roleOf(el) ?? el.localName;
  const name = accessibleName(el);
  return name ? `${role} "${name}"` : role;
}

export { clean };
