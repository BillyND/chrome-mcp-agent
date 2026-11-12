// Language and theme preferences for an extension page or a gateway web page: loads them, follows changes made in the
// popup, and applies the theme class.

import { useEffect, useState } from 'react';
import { getPrefs, isDark, onPrefsChange, type Prefs } from '../i18n';

export function usePrefs(): Prefs | null {
  const [prefs, setPrefs] = useState<Prefs | null>(null);

  useEffect(() => {
    const load = () => void getPrefs().then(setPrefs);
    load();
    return onPrefsChange(load);
  }, []);

  useEffect(() => {
    if (!prefs) return;
    const apply = () => document.documentElement.classList.toggle('dark', isDark(prefs.theme));
    apply();
    document.documentElement.lang = prefs.lang;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [prefs]);

  return prefs;
}
