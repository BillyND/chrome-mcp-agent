// UI languages offered by the extension and the gateway's web pages, each named in its own language.

export const LANGS = [
  { value: 'en', label: 'English' },
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'zh', label: '简体中文' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'pt', label: 'Português' },
  { value: 'ru', label: 'Русский' },
  { value: 'id', label: 'Bahasa Indonesia' },
  { value: 'th', label: 'ไทย' },
] as const;

export type Lang = (typeof LANGS)[number]['value'];

export const LANG_CODES: readonly Lang[] = LANGS.map((l) => l.value);

export const isLang = (value: unknown): value is Lang => LANG_CODES.includes(value as Lang);

/** The supported language matching a BCP 47 tag such as "pt-BR" or "zh-Hans-CN", else English. */
export const matchLang = (tag: string | undefined): Lang => {
  const base = (tag || '').toLowerCase().split('-')[0];
  return isLang(base) ? base : 'en';
};
