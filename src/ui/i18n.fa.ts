/** FA strings, split to keep each dictionary file reviewable. */
import { FA_CORE } from './i18n.fa.core.ts';
import { FA_EXTRA } from './i18n.fa.extra.ts';
import { FA_EVENTS } from './i18n.fa.events.ts';

export const FA: Record<string, string> = { ...FA_CORE, ...FA_EXTRA, ...FA_EVENTS };
