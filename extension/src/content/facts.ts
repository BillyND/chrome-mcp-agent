// Facts about elements and pages for the safety layer in the background: what an element is and
// says (so an action on it can be classified), and whether the page asks for a login or CAPTCHA.

import { looksLikeCaptcha } from '../background/policy/untrusted';
import type { ElementFacts, PageGates } from '../messages';
import { accessibleName, clean, hasSize, isVisible, roleOf, shadowRootOf } from './dom';

/** The element with keyboard focus, looking inside shadow roots. */
export function focusedElement(): Element {
  let el: Element = document.activeElement ?? document.body;
  for (let root = shadowRootOf(el)?.activeElement; root; root = shadowRootOf(el)?.activeElement) el = root;
  return el;
}

function formOf(el: Element): HTMLFormElement | null {
  return (el as HTMLInputElement).form ?? el.closest('form');
}

function formHint(form: HTMLFormElement | null): string {
  if (!form) return '';
  const submitters = [...form.querySelectorAll<HTMLElement>('button:not([type=button]):not([type=reset]), input[type=submit], input[type=image], [role=button]')];
  return [form.id, form.getAttribute('name'), form.getAttribute('action'), form.getAttribute('aria-label'), ...submitters.map((b) => accessibleName(b))]
    .filter(Boolean)
    .join(' ');
}

function labelsOf(el: Element): string {
  const labels = (el as HTMLInputElement).labels;
  return labels ? [...labels].map((l) => l.textContent).join(' ') : '';
}

/** The control a click at `el` would activate: the element itself or its nearest clickable ancestor. */
export const clickableAt = (el: Element): Element => el.closest('button, a[href], input, select, summary, [role=button], [role=link], [role=menuitem], [onclick]') ?? el;

export function describeTarget(el: Element): ElementFacts {
  const input = el instanceof HTMLInputElement ? el : null;
  const form = formOf(el);
  const type = input?.type;
  const isButtonLike = el instanceof HTMLButtonElement || (!!input && ['submit', 'image'].includes(input.type));
  const submitsForm = isButtonLike && !!form && (el as HTMLButtonElement | HTMLInputElement).type !== 'button' && (el as HTMLButtonElement | HTMLInputElement).type !== 'reset';
  return {
    tag: el.localName,
    role: roleOf(el),
    inputType: type,
    name: accessibleName(el),
    text: clean((el as HTMLElement).innerText ?? el.textContent, 80),
    fieldHints: clean(
      [el.getAttribute('aria-label'), el.getAttribute('name'), el.id, el.getAttribute('placeholder'), el.getAttribute('title'), labelsOf(el), el.getAttribute('autocomplete')]
        .filter(Boolean)
        .join(' '),
      300,
    ),
    autocomplete: el.getAttribute('autocomplete') ?? '',
    isSubmit: submitsForm,
    inForm: !!form,
    formHint: clean(formHint(form), 300),
    href: el instanceof HTMLAnchorElement ? el.href : el.closest('a')?.href,
    download: el instanceof HTMLAnchorElement ? el.hasAttribute('download') : !!el.closest('a[download]'),
  };
}

export function detectGates(): PageGates {
  const password = [...document.querySelectorAll<HTMLInputElement>('input[type=password]')].some((el) => isVisible(el) && hasSize(el));
  const captcha =
    [...document.querySelectorAll<HTMLIFrameElement>('iframe')].some((f) => looksLikeCaptcha(f.src, f.title) && hasSize(f)) ||
    !!document.querySelector('.g-recaptcha, .h-captcha, .cf-turnstile');
  return { password, captcha };
}
