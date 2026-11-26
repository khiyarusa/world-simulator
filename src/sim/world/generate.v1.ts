/**
 * World generation v1 (frozen once shipped — see docs/WORLD_GENERATION.md §11).
 *
 * Deterministic: the only randomness is xoshiro128** streams derived from the recipe seed, and
 * the only arithmetic is + - * / with Math.floor/sqrt. Same recipe => byte-identical grids.
 *
 * Sea level is chosen from the generated height field so the land fraction matches the recipe's
 * target instead of being hoped for; this is why the pipeline needs no rejection sampling.
 */
import { Rng, STREAM, STREAM_IDS, createStreamStates } from '../../core/rng.ts';
import { SimError } from '../../core/errors.ts';
import { clamp, clamp01 } from '../../core/math.ts';
import type { Seed } from '../../core/seed.ts';
import { fbm2, ridged2, warp2 } from './noise.ts';
import { buildHydrology } from './hydrology.ts';
import { BIOME_FERTILITY, BIOME_VEGETATION, BIOME_WOOD, classifyBiome } from './biomes.ts';
import { computeWaterDistance, findSpawnSites } from './spawn.ts';
import { PRESETS, clampHarshness, clampPeoples, clampWater, harshnessSwing, isPreset, landTargetPm } from './presets.ts';
import { recipeHashOf } from './recipeHash.ts';
import { validateGenerated } from './validate.ts';
import { tierOf } from '../state/worldState.ts';
import { allocateSociety } from '../society/allocate.ts';
import { initialiseSociety } from '../society/init.ts';
import type { CivStore, GenerationReport, SettlementStore, WorldRecipe, WorldState } from '../state/worldState.ts';
import { allocateCivs, allocateGrids, allocateSettlements } from '../state/worldState.ts';
export const GENERATOR_VERSION_V1 = 1;
export type ProgressFn = (stage: string, pct: number) => void;
const TERRAIN_STREAM_INDEX = STREAM_IDS.indexOf(STREAM.TERRAIN);
const SPAWN_STREAM_INDEX = STREAM_IDS.indexOf(STREAM.SPAWN);
const STAGE_WEIGHTS: ReadonlyArray<readonly [string, number]> = [
  ['land', 18],
  ['elevation', 14],
  ['climate', 16],
  ['hydrology', 20],
  ['biomes', 12],
  ['resources', 6],
  ['spawn', 8],
  ['report', 6],
];

class Progress {
  private done = 0;
  private readonly fn: ProgressFn | undefined;
  constructor(fn: ProgressFn | undefined) {
    this.fn = fn;
  }
  start(name: string): void {
    this.fn?.(name, Math.min(99, this.done));
  }
  complete(name: string): void {
    const w = STAGE_WEIGHTS.find((s) => s[0] === name)?.[1] ?? 0;
    this.done += w;
    this.fn?.(name, Math.min(99, this.done));
  }
}

/** 3×3 box blur; one pass removes single-cell pits that would otherwise all become lakes. */
function smoothField(src: Float32Array, width: number, height: number): Float32Array {
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          sum += src[ny * width + nx]!;
          count++;
        }
      }
      out[y * width + x] = sum / count;
    }
  }
  return out;
}

/** Value threshold that leaves `landPm` per-mille of cells above it. Deterministic. */
function thresholdForLand(field: Float32Array, landPm: number): number {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < field.length; i++) {
    const v = field[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!(max > min)) return min;
  const bins = 1024;
  const hist = new Uint32Array(bins);
  const scale = (bins - 1) / (max - min);
  for (let i = 0; i < field.length; i++) {
    const b = Math.min(bins - 1, Math.max(0, Math.floor((field[i]! - min) * scale)));
    hist[b] = (hist[b] ?? 0) + 1;
  }
  const landCells = Math.round((field.length * landPm) / 1000);
  let need = landCells;
  for (let b = bins - 1; b >= 0; b--) {
    need -= hist[b] ?? 0;
    if (need <= 0) return min + b / scale;
  }
  return min;
}

interface AttemptResult {
  state: WorldState;
  landPm: number;
}

/** One generation attempt. Returns a fully populated world state. */
function attempt(recipe: WorldRecipe, progress: Progress): AttemptResult {
  const size = PRESETS[recipe.preset].size;
  const width = size;
  const height = size;
  const n = width * height;
  const seed: Seed = recipe.seed;
  const grids = allocateGrids(width, height);
  const swing = harshnessSwing(recipe.harshness);

  const terrainField = { seedLo: seed.lo, seedHi: seed.hi, stream: STREAM.TERRAIN };
  const moistureField = { seedLo: seed.lo, seedHi: seed.hi, stream: STREAM.MOISTURE };
  const tempField = { seedLo: seed.lo, seedHi: seed.hi, stream: STREAM.TEMP };

  const windRng = Rng.forStream(seed.lo, seed.hi, STREAM.TERRAIN);
  const windDirection = windRng.int(4);

  // ---- 1/2: height field, then a sea level that actually hits the land target --------------
  progress.start('land');
  const raw = new Float32Array(n);
  const halfW = (width - 1) / 2;
  const halfH = (height - 1) / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const dx = (x - halfW) / halfW;
      const dy = (y - halfH) / halfH;
      const r = Math.sqrt(dx * dx + dy * dy);
      const falloff = clamp01(1.12 - r * r * 0.9);
      const warp = warp2(terrainField, x / 48, y / 48, 0.4);
      const base = fbm2(terrainField, (x + warp.dx) / 32, (y + warp.dy) / 32, { octaves: 5 });
      const ridge = ridged2(terrainField, x / 40, y / 40, { octaves: 4 });
      const mountainMask = clamp01((fbm2(terrainField, x / 96 + 31.7, y / 96 + 7.3, { octaves: 3 }) - 0.44) * 2.6);
      raw[i] = base * 0.85 + falloff * 0.95 + ridge * ridge * mountainMask * 0.8;
    }
  }
  const field = smoothField(raw, width, height);
  progress.complete('land');

  progress.start('elevation');
  const landTarget = landTargetPm(recipe.preset, recipe.water);
  const sea = thresholdForLand(field, landTarget);
  for (let i = 0; i < n; i++) {
    const above = field[i]! - sea;
    const dm = above >= 0 ? Math.round(above * 7000) + 20 : Math.round(above * 6000) - 40;
    grids.elevation[i] = clamp(dm, -2000, 9000);
  }
  progress.complete('elevation');

  const seaLevel = 0;
  const isLand = (i: number): boolean => grids.elevation[i]! >= seaLevel;

  const coast = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!isLand(i)) continue;
      if (
        (x > 0 && !isLand(i - 1)) ||
        (x < width - 1 && !isLand(i + 1)) ||
        (y > 0 && !isLand(i - width)) ||
        (y < height - 1 && !isLand(i + width))
      ) {
        coast[i] = 1;
      }
    }
  }

  // ---- 3/4/5: temperature and moisture ----------------------------------------------------
  progress.start('climate');
  for (let y = 0; y < height; y++) {
    const lat = Math.abs(y - halfH) / Math.max(1, halfH);
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const elevM = grids.elevation[i]! / 10;
      const baseTemp = 31 - lat * lat * (30 + swing);
      const lapse = elevM * 0.0062;
      const noise = (fbm2(tempField, x / 80, y / 80, { octaves: 3 }) - 0.5) * 6;
      grids.temperature[i] = clamp(Math.round(baseTemp - lapse + noise), -40, 50);
    }
  }

  const upDx = [0, 1, 0, -1][windDirection] ?? 0;
  const upDy = [-1, 0, 1, 0][windDirection] ?? 0;
  const oceanDistance = computeWaterDistance(grids.elevation, width, height, seaLevel);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const nx = x - upDx;
      const ny = y - upDy;
      const upElev =
        nx >= 0 && ny >= 0 && nx < width && ny < height ? grids.elevation[ny * width + nx]! : seaLevel;
      const here = grids.elevation[i]!;
      const shadow = clamp(Math.floor((upElev - here) / 140), 0, 24);
      // Continentality: inland air is drier. This is what lets deserts exist at all.
      const inland = Math.min(12, oceanDistance[i] ?? 12) * 6;
      const noise = fbm2(moistureField, x / 56, y / 56, { octaves: 5 }) * 210 + 15;
      const coastal = coast[i] === 1 ? 30 : 0;
      grids.moisture[i] = clamp(Math.round(noise + coastal - shadow - inland), 0, 255);
    }
  }
  progress.complete('climate');

  // ---- 6: rivers and lakes ----------------------------------------------------------------
  progress.start('hydrology');
  const hydro = buildHydrology(grids.elevation, width, height, seaLevel);
  for (let i = 0; i < n; i++) {
    grids.riverId[i] = hydro.riverId[i]!;
    grids.riverWidth[i] = hydro.riverWidth[i]!;
    grids.lakeId[i] = hydro.lakeId[i]!;
  }
  progress.complete('hydrology');

  // ---- 7/8: biomes, fertility, vegetation -------------------------------------------------
  progress.start('biomes');
  const biomeHistogram = new Array<number>(16).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const elev = grids.elevation[i]!;
      let maxDiff = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx2 = x + dx;
          const ny2 = y + dy;
          if (nx2 < 0 || ny2 < 0 || nx2 >= width || ny2 >= height) continue;
          const diff = Math.abs(grids.elevation[ny2 * width + nx2]! - elev);
          if (diff > maxDiff) maxDiff = diff;
        }
      }
      const slope = Math.floor(maxDiff / 20);
      const biome = classifyBiome({
        elevation: elev,
        seaLevel,
        temperature: grids.temperature[i]!,
        moisture: grids.moisture[i]!,
        isLake: grids.lakeId[i]! > 0,
        isRiver: grids.riverId[i]! > 0,
        isCoast: coast[i] === 1,
        slope,
      });
      grids.biome[i] = biome;
      biomeHistogram[biome] = (biomeHistogram[biome] ?? 0) + 1;

      const baseFert = BIOME_FERTILITY[biome] ?? 0;
      const riverBonus = grids.riverId[i]! > 0 ? 45 : 0;
      const slopePenalty = slope * 14;
      grids.fertility[i] = clamp(baseFert + riverBonus - slopePenalty, 0, 255);

      const baseVeg = BIOME_VEGETATION[biome] ?? 0;
      const moisture = grids.moisture[i]!;
      grids.vegetation[i] = clamp(Math.round(baseVeg * (0.55 + (moisture / 255) * 0.45)), 0, 255);
    }
  }
  progress.complete('biomes');

  // ---- 9: resources -----------------------------------------------------------------------
  progress.start('resources');
  const resourceHistogram = [0, 0, 0, 0];
  const resField = { seedLo: seed.lo, seedHi: seed.hi, stream: STREAM.RESOURCES };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!isLand(i) || grids.lakeId[i]! > 0) continue;
      const b = grids.biome[i]!;
      const elev = grids.elevation[i]!;
      let mask = 0;
      const stoneNoise = fbm2(resField, x / 14, y / 14, { octaves: 3 });
      const metalNoise = fbm2(resField, x / 9 + 51.3, y / 9 + 17.9, { octaves: 3 });

      if (elev > 900 && stoneNoise > 0.6) {
        mask |= 1;
        resourceHistogram[0] = (resourceHistogram[0] ?? 0) + 1;
      }
      if (elev > 1800 && metalNoise > 0.7) {
        mask |= 2;
        resourceHistogram[1] = (resourceHistogram[1] ?? 0) + 1;
      }
      if ((BIOME_WOOD[b] ?? 0) > 120 && (grids.vegetation[i] ?? 0) > 90) {
        mask |= 4;
        resourceHistogram[2] = (resourceHistogram[2] ?? 0) + 1;
      }
      if (coast[i] === 1 && elev < 120) {
        mask |= 8;
        resourceHistogram[3] = (resourceHistogram[3] ?? 0) + 1;
      }
      grids.resource[i] = mask;
    }
  }
  progress.complete('resources');

  // ---- 10: regions (16 × 16 blocks) -------------------------------------------------------
  const regionSize = Math.max(1, Math.floor(width / 16));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rx = Math.min(15, Math.floor(x / regionSize));
      const ry = Math.min(15, Math.floor(y / regionSize));
      grids.regionId[y * width + x] = ry * 16 + rx;
    }
  }

  // ---- 11/12: spawn sites, initial bands --------------------------------------------------
  progress.start('spawn');
  const waterDistance = computeWaterDistance(grids.elevation, width, height, seaLevel, grids.biome);
  const peoples = clampPeoples(recipe.peoples);
  const sites = findSpawnSites({
    elevation: grids.elevation,
    biome: grids.biome,
    riverId: grids.riverId,
    waterDistance,
    width,
    height,
    seaLevel,
    count: peoples,
    seed,
  });

  const settlements: SettlementStore = allocateSettlements();
  const civs: CivStore = allocateCivs();
  const spawnRng = Rng.forStream(seed.lo, seed.hi, STREAM.SPAWN);

  for (let k = 0; k < sites.length; k++) {
    const site = sites[k]!;
    const pop = spawnRng.range(40, 120);
    settlements.x[k] = site.x;
    settlements.y[k] = site.y;
    settlements.pop[k] = pop;
    settlements.civ[k] = k;
    settlements.tier[k] = tierOf(pop);
    settlements.nameIdx[k] = k;
    settlements.foundedDay[k] = 1;
    settlements.count = k + 1;

    civs.capital[k] = k;
    civs.colorIdx[k] = k % 12;
    civs.nameIdx[k] = k;
    civs.count = k + 1;
  }

  // Initial territory: a small deterministic radius per band (data, not a Stage 3 system).
  for (let k = 0; k < settlements.count; k++) {
    const cx = settlements.x[k]!;
    const cy = settlements.y[k]!;
    const civId = k + 1;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dx * dx + dy * dy > 5) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (grids.owner[j] !== 0 || grids.lakeId[j] !== 0 || grids.elevation[j]! < seaLevel) continue;
        grids.owner[j] = civId;
      }
    }
  }

  // ---- 13: report -------------------------------------------------------------------------
  let landCells = 0;
  let elevMin = 0x7fffffff;
  let elevMax = -0x80000000;
  for (let i = 0; i < n; i++) {
    const e = grids.elevation[i]!;
    if (e < elevMin) elevMin = e;
    if (e > elevMax) elevMax = e;
    if (e >= seaLevel) landCells++;
  }

  const warnings: string[] = [];
  const landPm = Math.round((landCells * 1000) / n);
  if (Math.abs(landPm - PRESETS[recipe.preset].landPm) > 100) warnings.push(`land fraction ${landPm}pm far from preset`);
  if (hydro.riverCells === 0) warnings.push('no rivers formed');
  if (biomeHistogram.filter((c) => c > 0).length < 6) warnings.push('low biome diversity');

  const report: GenerationReport = {
    recipeHash: recipeHashOf(recipe),
    generatorVersion: recipe.generatorVersion,
    width,
    height,
    landFraction: landPm,
    elevationMin: elevMin,
    elevationMax: elevMax,
    biomeHistogram,
    riverCells: hydro.riverCells,
    lakeCells: hydro.lakeCells,
    lakeCount: hydro.lakeCount,
    resourceHistogram,
    spawnCount: settlements.count,
    validation: [],
    warnings,
    attempts: 1,
    relaxations: [],
    timingMs: 0,
    windDirection,
  };

  progress.complete('spawn');

  // Capture the streams at the point generation actually left them. Storing fresh initial states
  // here made every reload restart those streams from scratch (D-33).
  const rngStates = createStreamStates(seed.lo, seed.hi);
  if (TERRAIN_STREAM_INDEX >= 0) rngStates[TERRAIN_STREAM_INDEX] = windRng.state;
  if (SPAWN_STREAM_INDEX >= 0) rngStates[SPAWN_STREAM_INDEX] = spawnRng.state;

  const state: WorldState = {
    width,
    height,
    seaLevel,
    recipe,
    grids,
    settlements,
    civs,
    day: 1,
    counters: {
      settlementsFounded: settlements.count,
      ticks: 0,
      droppedTicks: 0,
      births: 0,
      deaths: 0,
      migrants: 0,
      abandonments: 0,
      foodProduced: 0,
      foodConsumed: 0,
      infraBuilt: 0,
      routesOpened: 0,
      routesLost: 0,
      tradeVolume: 0,
      tributePaid: 0,
      taxCollected: 0,
      warsDeclared: 0,
      warsEnded: 0,
      warDeaths: 0,
      techDiscovered: 0,
      starvationDeaths: 0,
      epidemicDeaths: 0,
      blessings: 0,
      blights: 0,
      fertilized: 0,
      incited: 0,
    },
    rngStates,
    report,
    society: allocateSociety(),
  };
  initialiseSociety(state, state.society);

  progress.complete('report');
  return { state, landPm };
}

/**
 * Public entry point.
 *
 * `clock` is injected so simulation code never reads a wall clock (AGENTS.md R-15);
 * production passes performance.now, tests pass a constant.
 */
export function generateV1(
  recipeIn: WorldRecipe,
  onProgress?: ProgressFn,
  clock: () => number = () => 0,
): WorldState {
  if (recipeIn.generatorVersion !== GENERATOR_VERSION_V1) {
    throw new SimError('UNSUPPORTED_VERSION', `generator version ${recipeIn.generatorVersion} is not supported`, {
      supported: GENERATOR_VERSION_V1,
    });
  }
  if (!isPreset(recipeIn.preset)) {
    throw new SimError('GEN_INVALID', `unknown preset ${String(recipeIn.preset)}`);
  }
  const recipe: WorldRecipe = {
    ...recipeIn,
    water: clampWater(recipeIn.water),
    harshness: clampHarshness(recipeIn.harshness),
    peoples: clampPeoples(recipeIn.peoples),
  };
  const started = clock();
  const progress = new Progress(onProgress);
  const result = attempt(recipe, progress);
  const state = result.state;
  state.report.timingMs = clock() - started;
  state.report.validation = validateGenerated(state);
  return state;
}

// Kept on the generator's public surface: callers and tests treat identity and validation as part of
// creating a world, even though they live in their own modules now.
export { recipeHashOf, describeRecipe } from './recipeHash.ts';
export { validateGenerated } from './validate.ts';
