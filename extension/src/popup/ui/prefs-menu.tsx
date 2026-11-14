// Language and theme pickers for the header of every extension page: each is a small button that
// opens a popover with its choices.

import { LANGS } from '../../../../shared/langs';
import { setPrefs, t, type Key, type Prefs } from '../../i18n';
import { MenuPopover } from './components';
import { Icon } from './icons';

const THEMES = ['light', 'dark', 'system'] as const;

export function PrefsMenu({ prefs }: { prefs: Prefs }) {
  const tr = (k: Key) => t(prefs.lang, k);
  return (
    <div className="flex items-center gap-1.5">
      <MenuPopover
        id="lang-menu"
        label={tr('language')}
        trigger={Icon.languages}
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
