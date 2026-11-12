// Language and theme pickers for the header of every extension page: each is a small button that
// opens a popover with its choices.

import { setPrefs, t, type Key, type Prefs } from '../../i18n';
import { MenuPopover } from './components';
import { Icon } from './icons';

const LANGS = [
  { value: 'en', label: 'English' },
  { value: 'vi', label: 'Tiếng Việt' },
] as const;
const THEMES = ['light', 'dark', 'system'] as const;

export function PrefsMenu({ prefs }: { prefs: Prefs }) {
  const tr = (k: Key) => t(prefs.lang, k);
  return (
    <div className="flex items-center">
      <MenuPopover
        id="lang-menu"
        label={tr('language')}
        trigger={<span className="text-xs font-semibold uppercase">{prefs.lang}</span>}
        value={prefs.lang}
        options={[...LANGS]}
        onSelect={(lang) => void setPrefs({ lang })}
      />
      <MenuPopover
        id="theme-menu"
        label={tr('theme')}
        trigger={Icon[prefs.theme]}
        value={prefs.theme}
        options={THEMES.map((th) => ({ value: th, label: tr(`theme_${th}`), icon: Icon[th] }))}
        onSelect={(theme) => void setPrefs({ theme })}
      />
    </div>
  );
}
