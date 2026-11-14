// Whether the page asks for a login or a CAPTCHA, for the hint the background adds to a tool result.

import { looksLikeCaptcha } from '../background/policy/untrusted';
import type { PageGates } from '../messages';
import { hasSize, isVisible } from './dom';

export function detectGates(): PageGates {
  const password = [...document.querySelectorAll<HTMLInputElement>('input[type=password]')].some((el) => isVisible(el) && hasSize(el));
  const captcha =
    [...document.querySelectorAll<HTMLIFrameElement>('iframe')].some((f) => looksLikeCaptcha(f.src, f.title) && hasSize(f)) ||
    !!document.querySelector('.g-recaptcha, .h-captcha, .cf-turnstile');
  return { password, captcha };
}
