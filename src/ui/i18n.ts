/**
 * Localisation (Stage 4 WP8.4).
 *
 * The game ships Persian (RTL, Vazirmatn) as the default and English as the second complete
 * language. Every string the player reads goes through `t()`; there is no half-translated mode and
 * no RTL "toggle" that only flips `direction`.
 *
 * Numeric values use the active locale's digits but are wrapped in `dir="ltr"` nodes by the panel
 * renderer, so a value never reverses inside an RTL sentence. Proper nouns (settlement and
 * civilization names) are Latin data and are rendered with `bdi` isolation.
 */
import { calendarOf, MONTH_NAMES, SEASON_NAMES } from '../core/clock.ts';
import { EN } from './i18n.en.ts';
import { FA } from './i18n.fa.ts';

export type Lang = 'fa' | 'en';
const STORAGE_KEY = 'ws.lang';

const DICTS: Readonly<Record<Lang, Record<string, string>>> = { en: EN, fa: FA };

let current: Lang = 'fa';

export function detectLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'fa' || stored === 'en') return stored;
  } catch {
    // private mode / disabled storage: fall through to the URL and navigator
  }
  try {
    const param = new URLSearchParams(location.search).get('lang');
    if (param === 'fa' || param === 'en') return param;
  } catch {
    // no location (tests): ignore
  }
  if (typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('fa')) return 'fa';
  return 'fa';
}

export function initLang(): Lang {
  setLang(detectLang(), false);
  return current;
}

export function setLang(lang: Lang, persist = true): void {
  current = lang;
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // storage is optional; the language still applies for this session
    }
  }
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.lang = lang;
    root.dir = lang === 'fa' ? 'rtl' : 'ltr';
    root.classList.toggle('rtl', lang === 'fa');
    document.body?.classList.toggle('rtl', lang === 'fa');
    document.title = (DICTS[lang]['app.title'] ?? EN['app.title']) as string;
  }
}

export function lang(): Lang {
  return current;
}

export function isRtl(): boolean {
  return current === 'fa';
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const table = DICTS[current];
  let text = table[key] ?? EN[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}

/** Locale digits, with grouping. Callers wrap values in `dir="ltr"` where alignment matters. */
export function fmtNum(n: number): string {
  try {
    return new Intl.NumberFormat(current === 'fa' ? 'fa-IR' : 'en-US').format(Math.round(n));
  } catch {
    return String(Math.round(n));
  }
}

export function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${fmtNum(Math.round(n / 100_000) / 10)}M`;
  if (abs >= 10_000) return `${fmtNum(Math.round(n / 1000))}k`;
  return fmtNum(n);
}

export function fmtPercent(perMille: number): string {
  return `${fmtNum(Math.round(perMille / 10))}%`;
}

export function seasonLabel(season: number): string {
  return t(`season.${season}`) || SEASON_NAMES[season] || '';
}

export function monthLabel(month: number): string {
  return t(`month.${month}`) || MONTH_NAMES[month] || '';
}

export interface LocalDate {
  readonly year: number;
  readonly season: number;
  readonly month: number;
  readonly dayOfMonth: number;
  readonly text: string;
}

export function localDate(day: number): LocalDate {
  const c = calendarOf(day);
  const text =
    current === 'fa'
      ? `${seasonLabel(c.season)} · ${fmtNum(c.dayOfMonth)} ${monthLabel(c.month - 1)} · سال ${fmtNum(c.year)}`
      : `Year ${fmtNum(c.year)} · ${seasonLabel(c.season)} · ${fmtNum(c.dayOfMonth)} ${monthLabel(c.month - 1)}`;
  return { year: c.year, season: c.season, month: c.month, dayOfMonth: c.dayOfMonth, text };
}

export function tierLabel(tier: number): string {
  return t(`tier.${Math.max(0, Math.min(4, tier))}`);
}

export function resourceLabel(resource: number): string {
  const keys = ['food', 'water', 'wood', 'stone', 'metal', 'goods'];
  return t(`resource.${keys[resource] ?? 'food'}`);
}

export function cohortLabel(index: number): string {
  const keys = ['children', 'youth', 'farmers', 'extractors', 'crafters', 'traders', 'soldiers', 'elders'];
  return t(`cohort.${keys[index] ?? 'children'}`);
}

export function riskLabel(code: string): string {
  return t(`risk.${code}`);
}

export function infraLabel(index: number): string {
  const keys = [
    'granary',
    'well',
    'irrigation',
    'walls',
    'market',
    'workshop',
    'road',
    'temple',
    'academy',
    'aqueduct',
    'barracks',
    'harbour',
  ];
  return t(`infra.${keys[index] ?? 'granary'}`);
}

export function techLabel(index: number): string {
  return t(`tech.${index}`);
}

export function treatyLabel(type: number): string {
  return type === 0 ? t('civ.noTreaty') : t(`treaty.${type}`);
}

export function eventTypeLabel(typeName: string): string {
  const key = `event.${typeName}`;
  const text = t(key);
  return text === key ? typeName.replace(/_/g, ' ') : text;
}

export function presetLabel(preset: string): string {
  return t(`world.preset.${preset}`);
}
