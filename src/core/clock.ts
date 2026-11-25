/**
 * Calendar contract (docs/SIMULATION_MODEL.md §2, docs/GDD.md §12).
 * Day numbering starts at 1. A tick advances the world by exactly one day.
 */

export const DAYS_PER_MONTH = 30;
export const MONTHS_PER_YEAR = 12;
export const SEASON_DAYS = 90;
export const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR; // 360

export type Season = 0 | 1 | 2 | 3;
export const SEASON_NAMES = ['Winter', 'Spring', 'Summer', 'Autumn'] as const;
export const MONTH_NAMES = [
  'Firstmonth',
  'Thaw',
  'Seedtime',
  'Highsun',
  'Haycut',
  'Harvest',
  'Emberfall',
  'Mistmonth',
  'Frostwake',
  'Longnight',
  'Deepwinter',
  'Yearsend',
] as const;

export interface Calendar {
  /** 1-based year. */
  readonly year: number;
  /** 1..12 */
  readonly month: number;
  /** 1..30 */
  readonly dayOfMonth: number;
  /** 1..360 */
  readonly dayOfYear: number;
  readonly season: Season;
  readonly seasonName: string;
  readonly monthName: string;
}

export function calendarOf(day: number): Calendar {
  if (!Number.isInteger(day) || day < 1) throw new RangeError(`calendarOf: bad day ${day}`);
  const index = day - 1;
  const year = Math.floor(index / DAYS_PER_YEAR) + 1;
  const dayOfYear = (index % DAYS_PER_YEAR) + 1;
  const month = Math.floor((dayOfYear - 1) / DAYS_PER_MONTH) + 1;
  const dayOfMonth = ((dayOfYear - 1) % DAYS_PER_MONTH) + 1;
  const season = Math.floor((dayOfYear - 1) / SEASON_DAYS) as Season;
  const seasonName = SEASON_NAMES[season] ?? 'Winter';
  const monthName = MONTH_NAMES[month - 1] ?? 'Firstmonth';
  return { year, month, dayOfMonth, dayOfYear, season, seasonName, monthName };
}

export const dayToYear = (day: number): number => Math.floor((day - 1) / DAYS_PER_YEAR) + 1;
export const isMonthBoundary = (day: number): boolean => day % DAYS_PER_MONTH === 0;
export const isYearBoundary = (day: number): boolean => day % DAYS_PER_YEAR === 0;

export function formatDate(day: number): string {
  const c = calendarOf(day);
  return `Year ${c.year} · ${c.seasonName} · ${c.dayOfMonth} ${c.monthName}`;
}
