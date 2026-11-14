// Translations of the gateway pages' copy for the languages beyond Vietnamese and English, keyed by the
// English text exactly as pages.ts writes it.

import type { Lang } from '../../../shared/langs';
import { de } from './de';
import { es } from './es';
import { fr } from './fr';
import { id } from './id';
import { ja } from './ja';
import { ko } from './ko';
import { pt } from './pt';
import { ru } from './ru';
import { th } from './th';
import { zh } from './zh';

export const PAGE_STRINGS: Record<Exclude<Lang, 'en' | 'vi'>, Record<string, string>> = { zh, ja, ko, es, fr, de, pt, ru, id, th };
