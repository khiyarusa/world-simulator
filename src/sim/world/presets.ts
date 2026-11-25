import type { Preset } from '../state/worldState.ts';

export interface PresetSpec {
  readonly size: number;
  /** Target land fraction in per-mille. */
  readonly landPm: number;
  readonly label: string;
}

export const PRESETS: Readonly<Record<Preset, PresetSpec>> = {
  small: { size: 128, landPm: 450, label: 'Small' },
  medium: { size: 192, landPm: 400, label: 'Medium' },
  large: { size: 256, landPm: 350, label: 'Large' },
};

export const PRESET_ORDER: readonly Preset[] = ['small', 'medium', 'large'];
export const DEFAULT_PRESET: Preset = 'medium';

/**
 * Stable numeric identity used by recipe hashing (D-32).
 *
 * The previous hash used `preset.length`, which made "small" and "large" collide (both 5). A hash
 * must never be derived from a display string. These ids are part of the persisted recipe identity
 * and may never be renumbered.
 */
export const PRESET_IDS: Readonly<Record<Preset, number>> = {
  small: 1,
  medium: 2,
  large: 3,
};

export function presetIdOf(preset: Preset): number {
  return PRESET_IDS[preset] ?? 0;
}

export function isPreset(value: unknown): value is Preset {
  return value === 'small' || value === 'medium' || value === 'large';
}

export const RECIPE_LIMITS = {
  waterMin: 0,
  waterMax: 100,
  harshnessMin: 0,
  harshnessMax: 100,
  peoplesMin: 1,
  peoplesMax: 12,
} as const;

export function presetSize(preset: Preset): number {
  return PRESETS[preset].size;
}

export function clampWater(v: number): number {
  return Math.round(Math.min(RECIPE_LIMITS.waterMax, Math.max(RECIPE_LIMITS.waterMin, v)));
}

export function clampHarshness(v: number): number {
  return Math.round(Math.min(RECIPE_LIMITS.harshnessMax, Math.max(RECIPE_LIMITS.harshnessMin, v)));
}

export function clampPeoples(v: number): number {
  return Math.round(Math.min(RECIPE_LIMITS.peoplesMax, Math.max(RECIPE_LIMITS.peoplesMin, v)));
}

/**
 * Land target in per-mille for a preset and water slider. The generator picks its sea level
 * from the height field to hit this number exactly (docs/WORLD_GENERATION.md §4.1).
 */
export function landTargetPm(preset: Preset, water: number): number {
  const base = PRESETS[preset].landPm;
  return Math.round(Math.min(600, Math.max(150, base - (water - 50) * 3)));
}

/** Average annual temperature swing added by the harshness slider, in degrees. */
export function harshnessSwing(harshness: number): number {
  return Math.round(4 + (harshness / 100) * 16);
}
