// Line icons (lucide shapes) shared by the extension pages. They take their size from the parent's [&_svg] rule.

import type { ReactNode } from 'react';

const line = (body: ReactNode, strokeWidth = 2) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {body}
  </svg>
);

export const Icon = {
  logo: line(<path d="M4 3l7 17 2.5-7L21 10.5z" />, 2.4),
  copy: line(
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </>,
  ),
  check: line(<path d="M20 6 9 17l-5-5" />),
  languages: line(
    <>
      <path d="m5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6" />
    </>,
  ),
  chevronDown: line(<path d="m6 9 6 6 6-6" />),
  light: line(
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>,
  ),
  dark: line(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />),
  system: line(
    <>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>,
  ),
};
