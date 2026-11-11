// Which actions need the user's yes first: sending, paying, deleting, publishing, downloading,
// typing into a password field, granting a permission. Pure functions over element facts, so the
// keyword lists (English and Vietnamese) are unit tested.

import type { ElementFacts } from '../../messages';
import { fold } from './fold';

export type Category = 'send' | 'purchase' | 'delete' | 'publish' | 'transfer' | 'download' | 'password' | 'permission' | 'submit';

export type Verdict = { level: 'allow' } | { level: 'confirm'; category: Category; label: string };

const ALLOW: Verdict = { level: 'allow' };

/** Strong verbs: confirmed on buttons and links alike. Patterns run on folded (diacritic-free) text. */
const STRONG: Array<[Category, RegExp]> = [
  ['purchase', /\b(pay|payment|buy|purchase|checkout|check out|place (an |your )?order|confirm (order|payment|purchase)|thanh toan|mua|dat hang|xac nhan (don|thanh toan))\b/],
  ['transfer', /\b(transfer|withdraw|send money|chuyen khoan|chuyen tien|rut tien)\b/],
  ['delete', /\b(delete|remove|erase|xoa|go bo)\b/],
  ['publish', /\b(publish|xuat ban|dang bai|dang tin)\b/],
  ['send', /\b(send|submit|gui)\b/],
];
/** Ambiguous as nouns ("Order history", "Post office"): only confirmed on real buttons. */
const WEAK: Array<[Category, RegExp]> = [
  ['purchase', /\border\b/],
  ['publish', /\b(post|dang(?! nhap| ky| xuat))\b/],
];

const PERMISSION = /\b(allow|grant|enable|cho phep|cap quyen)\b.*\b(notifications?|location|camera|microphone|mic|clipboard|access|permissions?|thong bao|vi tri|may anh|micro|quyen)\b/;
const DOWNLOAD_HREF = /\.(zip|rar|7z|tar|gz|tgz|exe|dmg|pkg|msi|apk|iso|deb|rpm|docx?|xlsx?|pptx?|csv)([?#].*)?$/i;
const CLICKABLE_ROLES = new Set(['button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'option', 'switch']);
const MAX_LABEL_WORDS = 7;

const firstMatch = (list: Array<[Category, RegExp]>, text: string): Category | undefined => list.find(([, re]) => re.test(text))?.[0];

function labelOf(f: Pick<ElementFacts, 'name' | 'text'>): string {
  return (f.name || f.text).trim().slice(0, 80);
}

/** The action the user is asked to approve when `f` is clicked or activated. */
export function classifyClick(f: ElementFacts): Verdict {
  const label = labelOf(f);
  if (f.download || (f.role === 'link' && f.href && DOWNLOAD_HREF.test(f.href))) return { level: 'confirm', category: 'download', label: label || f.href || '' };

  const clickable = f.isSubmit || CLICKABLE_ROLES.has(f.role ?? '') || f.tag === 'button';
  if (!clickable) return ALLOW;

  const words = fold(f.name || f.text);
  if (words && words.split(' ').length <= MAX_LABEL_WORDS) {
    if (PERMISSION.test(words)) return { level: 'confirm', category: 'permission', label };
    const category = firstMatch(STRONG, words) ?? (f.role === 'link' ? undefined : firstMatch(WEAK, words));
    if (category) return { level: 'confirm', category, label };
  }
  // An unlabeled or generic submit button still sends the form it belongs to.
  if (f.isSubmit) return classifySubmit(f);
  return ALLOW;
}

/** Pressing Enter in a field, or activating a submit button: judged by the form's submit labels. */
export function classifySubmit(f: Pick<ElementFacts, 'inForm' | 'isSubmit' | 'formHint' | 'name' | 'text'>): Verdict {
  if (!f.inForm && !f.isSubmit) return ALLOW;
  const hint = fold(f.formHint);
  const category = firstMatch(STRONG, hint) ?? firstMatch(WEAK, hint);
  return category ? { level: 'confirm', category, label: labelOf(f) || f.formHint.slice(0, 80) } : ALLOW;
}

/** Typing into a password field needs approval; card and ID fields are refused earlier by hard-blocks. */
export function classifyTyping(f: Pick<ElementFacts, 'inputType' | 'autocomplete' | 'name' | 'text'>): Verdict {
  const ac = f.autocomplete.toLowerCase();
  if (f.inputType === 'password' || ac.includes('password')) {
    return { level: 'confirm', category: 'password', label: (f.name || f.text).trim().slice(0, 80) };
  }
  return ALLOW;
}
