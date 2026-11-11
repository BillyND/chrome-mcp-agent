// Things the agent must never do, whatever the user approves: type card numbers, security codes
// or national ID numbers, create accounts, upload credential files. Pure functions returning the
// refusal message the model sees, or null when the action is fine.

import type { ElementFacts } from '../../messages';
import { fold } from './fold';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Luhn checksum of a digit string. */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** True for a 13-19 digit, Luhn-valid number, optionally grouped with spaces or dashes. */
export function looksLikeCardNumber(value: string): boolean {
  const v = value.trim();
  if (!/^\d[\d -]{11,26}\d$/.test(v)) return false;
  const digits = v.replace(/[ -]/g, '');
  return digits.length >= 13 && digits.length <= 19 && luhnValid(digits);
}

const CARD_FIELD = /\b(card ?(number|no|num)|credit ?card|debit ?card|cc ?(num|number)|cvv|cvc|cvn|csc|security ?code|so the|ma the|so tai khoan the|the tin dung|the ghi no|expir(y|ation)|ngay het han)\b/;
const ID_FIELD = /\b(ssn|social ?security|national ?id|id ?number|identity ?(card|number)|passport|tax ?id|cmnd|cccd|can cuoc|chung minh|so dinh danh|ma so thue|ho chieu|cmt)\b/;
const SSN_VALUE = /^\d{3}-\d{2}-\d{4}$/;

export const REFUSE_CARD =
  'Refused: Helmsman never types payment card numbers, expiry dates or security codes. Ask the user to enter them, and call browser_request_user so they can do it themselves.';
export const REFUSE_ID =
  'Refused: Helmsman never types national ID, passport, tax or social security numbers. Ask the user to enter it, and call browser_request_user so they can do it themselves.';
export const REFUSE_ACCOUNT =
  'Refused: Helmsman does not create accounts. Tell the user, and call browser_request_user if they want to sign up themselves.';

/** Refusal for typing `value` into the described field, or null. */
export function checkTyping(facts: Pick<ElementFacts, 'fieldHints' | 'autocomplete'>, value: string): string | null {
  const hints = fold(facts.fieldHints);
  const autocomplete = facts.autocomplete.toLowerCase();
  if (autocomplete.startsWith('cc-') || CARD_FIELD.test(hints) || looksLikeCardNumber(value)) return REFUSE_CARD;
  if (ID_FIELD.test(hints) || SSN_VALUE.test(value.trim())) return REFUSE_ID;
  return null;
}

const ACCOUNT_CREATION = /\b(sign ?up|register|registration|create (an? |your |new )?account|new account|open an account|dang ky|tao tai khoan|tai khoan moi)\b/;

/** Refusal for activating an element that creates an account, or null. */
export function checkAccountCreation(facts: Pick<ElementFacts, 'name' | 'text' | 'isSubmit' | 'formHint'>): string | null {
  const label = fold(facts.name || facts.text);
  if (label.split(' ').length <= 8 && ACCOUNT_CREATION.test(label)) return REFUSE_ACCOUNT;
  if (facts.isSubmit && ACCOUNT_CREATION.test(fold(facts.formHint))) return REFUSE_ACCOUNT;
  return null;
}

const CREDENTIAL_FILE = /(^|\/)(\.env(\..*)?|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|\.npmrc|\.netrc|\.pgpass|credentials|\.git-credentials|secrets?\.(json|ya?ml|txt)|[^/]*\.(pem|key|p12|pfx|ppk|jks|keystore|kdbx|gpg|asc))$/i;

/** Refusal for attaching a file with this name and size, or null. */
export function checkUpload(name: string, bytes?: number): string | null {
  const clean = name.replace(/\\/g, '/');
  if (CREDENTIAL_FILE.test(clean)) {
    return `Refused: "${name}" looks like a credential or private key file. Helmsman never uploads those.`;
  }
  if (bytes !== undefined && bytes > MAX_UPLOAD_BYTES) {
    return `Refused: "${name}" is ${(bytes / 1048576).toFixed(1)} MB; Helmsman does not upload files larger than 25 MB.`;
  }
  return null;
}
