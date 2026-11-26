/** EN strings, split to keep each dictionary file reviewable. */
import { EN_CORE } from './i18n.en.core.ts';
import { EN_EXTRA } from './i18n.en.extra.ts';
import { EN_EVENTS } from './i18n.en.events.ts';

export const EN: Record<string, string> = { ...EN_CORE, ...EN_EXTRA, ...EN_EVENTS };
