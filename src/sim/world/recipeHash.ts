/**
 * Recipe identity (D-32).
 *
 * The hash covers every field that changes the generated world, in a frozen order, under a domain tag.
 * It must never be derived from a display string: the previous implementation hashed
 * `preset.length`, and "small" and "large" both have five characters, so two different worlds shared
 * one identity.
 */
import { crc32OfU32, crcHex } from '../../core/crc32.ts';
import { seedToText } from '../../core/seed.ts';
import type { WorldRecipe } from '../state/worldState.ts';
import { presetIdOf } from './presets.ts';

const RECIPE_HASH_DOMAIN = 0x52533131; // "RS11"

export function recipeHashOf(recipe: WorldRecipe): string {
  let crc = crc32OfU32(0, RECIPE_HASH_DOMAIN);
  crc = crc32OfU32(crc, recipe.generatorVersion);
  crc = crc32OfU32(crc, presetIdOf(recipe.preset));
  crc = crc32OfU32(crc, recipe.seed.hi);
  crc = crc32OfU32(crc, recipe.seed.lo);
  crc = crc32OfU32(crc, recipe.water);
  crc = crc32OfU32(crc, recipe.harshness);
  crc = crc32OfU32(crc, recipe.peoples);
  return crcHex(crc);
}

/** Convenience for tests and logs: `medium/A1B2…/w50/h50/p6`. */
export function describeRecipe(recipe: WorldRecipe): string {
  return `${recipe.preset}/${seedToText(recipe.seed)}/w${recipe.water}/h${recipe.harshness}/p${recipe.peoples}`;
}
