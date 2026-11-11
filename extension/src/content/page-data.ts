// Reading structured data out of this frame: text search, links/tables/headings/forms/meta,
// text selection and selector checks. All of it walks open and closed shadow roots.

import { accessibleName, children, clean, isInteractive, isVisible, roleOf, shadowRootOf } from './dom';
import { refFor, resolveRef } from './refs';

const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'head']);

export interface FindHit {
  ref: string;
  label: string;
  snippet: string;
  interactive: boolean;
}

/** Visible text nodes under `root`, shadow DOM included. */
function* textNodes(root: Node): Generator<Text> {
  if (root.nodeType === Node.TEXT_NODE) {
    yield root as Text;
    return;
  }
  if (root instanceof Element && (SKIP_TAGS.has(root.localName) || !isVisible(root))) return;
  const kids = root instanceof Element || root instanceof ShadowRoot || root instanceof Document ? children(root as Element) : [];
  for (const child of kids) yield* textNodes(child);
}

/** All elements matching `selector` under `root`, including inside shadow roots. */
function queryAllDeep(root: ParentNode, selector: string): Element[] {
  const found = [...root.querySelectorAll(selector)];
  for (const el of root.querySelectorAll('*')) {
    const sr = shadowRootOf(el);
    if (sr) found.push(...queryAllDeep(sr, selector));
  }
  return found;
}

export function hasSelector(selector: string, visible: boolean): boolean {
  return queryAllDeep(document, selector).some((el) => !visible || (isVisible(el) && el.getBoundingClientRect().width > 0));
}

export function findText(needle: string, caseSensitive: boolean, max: number, prefix: string): FindHit[] {
  const norm = (s: string) => (caseSensitive ? s : s.toLowerCase());
  const wanted = norm(needle);
  const hits: FindHit[] = [];
  const seen = new Set<Element>();
  for (const node of textNodes(document.body ?? document.documentElement)) {
    const content = node.textContent ?? '';
    const at = norm(content).indexOf(wanted);
    if (at < 0) continue;
    let el: Element | null = node.parentElement ?? (node.getRootNode() instanceof ShadowRoot ? (node.getRootNode() as ShadowRoot).host : null);
    // Report the nearest clickable ancestor: that is what an agent will want to act on.
    for (let up: Element | null = el, i = 0; up && i < 6 && up !== document.body; up = up.parentElement, i++) {
      if (isInteractive(up, roleOf(up))) {
        el = up;
        break;
      }
    }
    if (!el || seen.has(el)) continue;
    seen.add(el);
    const from = Math.max(0, at - 40);
    hits.push({
      ref: prefix + refFor(el),
      label: `${roleOf(el) ?? el.localName}${accessibleName(el) ? ` "${clean(accessibleName(el), 60)}"` : ''}`,
      snippet: clean(content.slice(from, at + needle.length + 60), 140),
      interactive: isInteractive(el, roleOf(el)),
    });
    if (hits.length >= max) break;
  }
  return hits;
}

// ---- extraction -------------------------------------------------------------

const cell = (el: Element) => clean((el as HTMLElement).innerText ?? el.textContent, 200);

function links(root: ParentNode, max: number, prefix: string) {
  const seen = new Set<string>();
  const out: Array<{ text: string; href: string; ref: string }> = [];
  for (const a of queryAllDeep(root, 'a[href]') as HTMLAnchorElement[]) {
    if (!isVisible(a) || a.href.startsWith('javascript:')) continue;
    const key = `${a.href}|${accessibleName(a)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text: accessibleName(a), href: a.href, ref: prefix + refFor(a) });
    if (out.length >= max) break;
  }
  return out;
}

function tables(root: ParentNode, max: number) {
  return (queryAllDeep(root, 'table') as HTMLTableElement[]).filter(isVisible).slice(0, 20).map((table) => {
    const rows = [...table.rows];
    const headerRow = table.tHead?.rows[0] ?? (rows[0] && [...rows[0].cells].every((c) => c.localName === 'th') ? rows[0] : undefined);
    const headers = headerRow ? [...headerRow.cells].map(cell) : [];
    const body = rows.filter((r) => r !== headerRow).slice(0, max).map((r) => [...r.cells].map(cell));
    return { caption: table.caption ? cell(table.caption) : undefined, headers, rows: body, totalRows: rows.length - (headerRow ? 1 : 0) };
  });
}

function headings(root: ParentNode, max: number) {
  return (queryAllDeep(root, 'h1,h2,h3,h4,h5,h6,[role=heading]'))
    .filter(isVisible)
    .slice(0, max)
    .map((h) => ({ level: Number(/^h(\d)$/.exec(h.localName)?.[1] ?? h.getAttribute('aria-level') ?? 2), text: accessibleName(h) }))
    .filter((h) => h.text);
}

function field(el: Element, prefix: string) {
  const input = el as HTMLInputElement;
  const base: Record<string, unknown> = {
    ref: prefix + refFor(el),
    tag: el.localName,
    type: el instanceof HTMLInputElement ? input.type : undefined,
    name: input.name || undefined,
    label: accessibleName(el) || undefined,
    required: input.required || undefined,
    disabled: input.disabled || undefined,
  };
  if (el instanceof HTMLInputElement && (input.type === 'checkbox' || input.type === 'radio')) base.checked = input.checked;
  else if (el instanceof HTMLSelectElement) {
    base.value = [...el.selectedOptions].map((o) => clean(o.label || o.text, 60)).join(', ');
    base.options = [...el.options].slice(0, 30).map((o) => clean(o.label || o.text, 60));
  } else if (input.type === 'password') base.value = input.value ? '••••' : '';
  else base.value = clean(input.value, 200);
  return base;
}

const FIELD_SELECTOR = 'input:not([type=hidden]),select,textarea';

function forms(root: ParentNode, max: number, prefix: string) {
  const all = queryAllDeep(root, FIELD_SELECTOR).filter(isVisible);
  const inForm = new Set<Element>();
  const out = (queryAllDeep(root, 'form') as HTMLFormElement[]).slice(0, 20).map((form) => {
    const fields = all.filter((f) => (f as HTMLInputElement).form === form).slice(0, max);
    fields.forEach((f) => inForm.add(f));
    return { ref: prefix + refFor(form), name: accessibleName(form) || form.getAttribute('name') || undefined, action: form.action || undefined, method: form.method, fields: fields.map((f) => field(f, prefix)) };
  });
  const loose = all.filter((f) => !inForm.has(f)).slice(0, max);
  if (loose.length) out.push({ ref: '', name: '(fields outside a form)', action: undefined, method: '', fields: loose.map((f) => field(f, prefix)) });
  return out;
}

function meta() {
  const pick = (selector: string) => document.querySelector(selector)?.getAttribute('content') || undefined;
  const props: Record<string, string> = {};
  for (const m of document.querySelectorAll('meta[property^="og:"],meta[name^="twitter:"]')) {
    const key = m.getAttribute('property') ?? m.getAttribute('name');
    const value = m.getAttribute('content');
    if (key && value) props[key] = clean(value, 300);
  }
  return {
    title: document.title,
    url: location.href,
    lang: document.documentElement.lang || undefined,
    description: pick('meta[name=description]'),
    canonical: document.querySelector('link[rel=canonical]')?.getAttribute('href') || undefined,
    jsonLdBlocks: document.querySelectorAll('script[type="application/ld+json"]').length,
    ...props,
  };
}

export function extractPage(what: string[], ref: string | undefined, max: number, prefix: string, isTop: boolean): Record<string, unknown> {
  const root: ParentNode = ref ? (resolveRef(ref) as Element) : document;
  const frame = prefix ? { frame: prefix } : {};
  const tag = <T extends object>(items: T[]) => items.map((i) => ({ ...frame, ...i }));
  const out: Record<string, unknown> = {};
  if (what.includes('meta') && isTop && !ref) out.meta = meta();
  if (what.includes('headings')) out.headings = tag(headings(root, max));
  if (what.includes('links')) out.links = tag(links(root, max, prefix));
  if (what.includes('tables')) out.tables = tag(tables(root, max));
  if (what.includes('forms')) out.forms = tag(forms(root, max, prefix));
  return out;
}

// ---- selection --------------------------------------------------------------

/** Selects an element's contents or the first occurrence of `needle` inside it; returns the selected text. */
export function selectText(ref: string | undefined, needle: string | undefined): string {
  const root: Node = ref ? resolveRef(ref) : (document.body ?? document.documentElement);
  if (root instanceof HTMLInputElement || root instanceof HTMLTextAreaElement) {
    root.focus({ preventScroll: true });
    const at = needle ? root.value.indexOf(needle) : 0;
    if (needle && at < 0) throw new Error(`"${needle}" was not found in ${accessibleName(root) || root.localName}.`);
    root.setSelectionRange(at, needle ? at + needle.length : root.value.length);
    return root.value.slice(root.selectionStart ?? 0, root.selectionEnd ?? 0);
  }
  const sel = getSelection();
  if (!sel) throw new Error('This page does not allow selecting text.');
  const range = document.createRange();
  if (!needle) {
    range.selectNodeContents(root);
  } else {
    let found = false;
    for (const node of textNodes(root)) {
      const at = (node.textContent ?? '').toLowerCase().indexOf(needle.toLowerCase());
      if (at < 0) continue;
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      found = true;
      break;
    }
    if (!found) throw new Error(`"${needle}" was not found${ref ? ' in that element' : ' on the page'} (selection works within one text run).`);
  }
  sel.removeAllRanges();
  sel.addRange(range);
  if (root instanceof Element && !needle) root.scrollIntoView({ block: 'center', behavior: 'instant' });
  return sel.toString();
}

export function readSelection(): string {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    const { selectionStart: a, selectionEnd: b } = active;
    if (a !== null && b !== null && a !== b) return active.value.slice(a, b);
  }
  return getSelection()?.toString() ?? '';
}
