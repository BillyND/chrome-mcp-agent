// Language and theme preferences for an extension page: loads them, follows changes made in the
// popup, and applies the theme class.

import { useEffect, useState } from 'react';
import { getPrefs, isDark, type Prefs } from '../i18n';

export function usePrefs(): Prefs | null {
  const [prefs, setPrefs] = useState<Prefs | null>(null);

  useEffect(() => {
    void getPrefs().then(setPrefs);
    const onChange = (changes: Record<string, chrome.storage.StorageChange>) => changes.prefs && void getPrefs().then(setPrefs);
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
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
