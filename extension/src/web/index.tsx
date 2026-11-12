// Script for the gateway's web pages (landing, consent, privacy): mounts the same language and theme
// popovers as the extension popup, and wires the client tabs on the landing page. The pages are fully
// readable without it.

import { createRoot } from 'react-dom/client';
import { PrefsMenu } from '../popup/ui/prefs-menu';
import { usePrefs } from '../popup/use-prefs';

function HeaderPrefs() {
  const prefs = usePrefs();
  return prefs ? <PrefsMenu prefs={prefs} /> : null;
}

const slot = document.getElementById('prefs');
if (slot) createRoot(slot).render(<HeaderPrefs />);

/** Tabs rendered by the server as [role=tab] buttons with [role=tabpanel] siblings; the URL hash picks one (#claude). */
for (const tabs of document.querySelectorAll<HTMLElement>('[data-tabs]')) {
  const buttons = [...tabs.querySelectorAll<HTMLButtonElement>('[role=tab]')];
  const select = (id: string, focus = false) => {
    for (const b of buttons) {
      const on = b.dataset.tab === id;
      b.dataset.state = on ? 'on' : 'off';
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      document.getElementById(`panel-${b.dataset.tab}`)!.hidden = !on;
      if (on && focus) b.focus();
    }
  };
  for (const b of buttons) {
    b.addEventListener('click', () => {
      select(b.dataset.tab!);
      history.replaceState(null, '', `#${b.dataset.tab}`);
    });
    b.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      const next = buttons[(buttons.indexOf(b) + step + buttons.length) % buttons.length];
      select(next.dataset.tab!, true);
    });
  }
  const fromHash = location.hash.slice(1);
  if (buttons.some((b) => b.dataset.tab === fromHash)) select(fromHash);
}
