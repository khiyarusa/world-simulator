/**
 * Simulation worker. Owns the only authoritative WorldState (AGENTS.md R-12).
 *
 * The loop is timer-driven, never rAF: the simulation must not inherit the display's frame
 * rate (docs/TECHNICAL_ARCHITECTURE.md §6). It idles completely while paused.
 */
import { asErrorMessage, SimError } from '../core/errors.ts';
import { generateV1 } from '../sim/world/generate.v1.ts';
import { startCampaign } from '../sim/campaign/run.ts';
import { runDay } from '../sim/systems/pipeline.ts';
import { populationOf } from '../sim/society/state.ts';
import { CAPACITY, type WorldRecipe, type WorldState } from '../sim/state/worldState.ts';
import { deserializeWorld, encodeSnapshot, SAVE_SCHEMA_VERSION } from './serialize.ts';
import { captureWorld } from './snapshot.ts';
import { Scheduler } from './scheduler.ts';
import { MirrorPool } from './mirrorPool.ts';
import { MAX_DELTA_HZ, type Cmd, type MirrorDelta, type SaveShard, type Speed, type WorkerMsg } from './protocol.ts';
import { buildSettlementMeta, buildWorldMeta } from './metaViews.ts';
import { runQuery, runPlayer, runCampaignCommand } from './queryHandler.ts';

interface WorkerScope {
  postMessage(message: WorkerMsg, transfer?: Transferable[]): void;
  addEventListener(type: 'message', handler: (ev: MessageEvent<Cmd>) => void): void;
  close(): void;
}

const scope = globalThis as unknown as WorkerScope;

const DELTA_INTERVAL_MS = 1000 / MAX_DELTA_HZ;
const STATS_INTERVAL_MS = 1000;

let state: WorldState | null = null;
let scheduler = new Scheduler();
let speed: Speed = 0;
let selectedId: number | null = null;
let seq = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastTickAt = performance.now();
let lastEmitAt = 0;
let lastStatsAt = 0;
let pendingDelta = false;
const tickSamples: number[] = [];
const pool = new MirrorPool();
let lastSettlementCount = -1;
let lastCivCount = -1;
let pendingAdvanceDays = 0;

function post(msg: WorkerMsg, transfer?: Transferable[]): void {
  if (transfer) scope.postMessage(msg, transfer);
  else scope.postMessage(msg);
}

function notify(level: 'info' | 'warn' | 'error', code: string, msg: string): void {
  post({ t: 'notify', level, code, msg });
}

function now(): number {
  return performance.now();
}

function schedule(delayMs: number): void {
  if (timer !== null) return;
  timer = setTimeout(loop, delayMs);
}

function clearSchedule(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

function loop(): void {
  timer = null;
  if (!state || speed === 0) return;
  const t = now();
  const elapsed = t - lastTickAt;
  lastTickAt = t;

  const ticks = scheduler.advance(elapsed);
  for (let i = 0; i < ticks; i++) {
    const start = now();
    runDay(state);
    const dur = now() - start;
    tickSamples.push(dur);
    if (tickSamples.length > 256) tickSamples.shift();
  }

  maybeEmitDelta();
  maybeEmitStats();

  // Keep draining the backlog quickly, otherwise idle at ~60 Hz so the accumulator stays honest.
  if (scheduler.backlogTicks >= 1) schedule(0);
  else schedule(16);
}

function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return Math.round((sorted[idx] ?? 0) * 100) / 100;
}

function maybeEmitStats(): void {
  const t = now();
  if (t - lastStatsAt < STATS_INTERVAL_MS) return;
  lastStatsAt = t;
  if (!state) return;
  post({
    t: 'stats',
    tickP50: percentile(tickSamples, 0.5),
    tickP95: percentile(tickSamples, 0.95),
    tickMax: Math.round(Math.max(0, ...tickSamples) * 100) / 100,
    dropped: scheduler.dropped,
    speed,
    day: state.day,
  });
}

function buildDelta(): MirrorDelta | null {
  if (!state) return null;
  const buffers = pool.acquire();
  if (!buffers) return null;
  const s = state.settlements;
  const count = Math.min(s.count, CAPACITY.settlements);
  const soc = state.society;
  for (let i = 0; i < count; i++) {
    const trendBase = i * 6;
    buffers.id[i] = i;
    buffers.pop[i] = populationOf(soc, i);
    buffers.civ[i] = s.civ[i] ?? 0;
    buffers.tier[i] = s.tier[i] ?? 0;
    const flags = soc.flags[i] ?? 0;
    let visual = flags & 0b1111;
    if ((soc.occupier[i] ?? 0) !== 0) visual |= 16;
    if ((soc.surplusYears[i] ?? 0) >= 12 && (soc.stability[i] ?? 0) >= 60) visual |= 32;
    const trendCount = soc.trendCount[i] ?? 0;
    if (trendCount >= 2) {
      const first = soc.trendPop[trendBase] ?? 0;
      const last = soc.trendPop[trendBase + trendCount - 1] ?? 0;
      if (last < first) visual |= 64;
    }
    buffers.state[i] = visual;
    buffers.infra[i] = soc.infra[i] ?? 0;
  }
  seq++;
  return {
    seq,
    day: state.day,
    count,
    id: buffers.id,
    pop: buffers.pop,
    civ: buffers.civ,
    tier: buffers.tier,
    state: buffers.state,
    infra: buffers.infra,
  };
}

function emitSettlementMetaIfNeeded(): void {
  if (!state) return;
  if (state.settlements.count === lastSettlementCount && state.civs.count === lastCivCount) return;
  lastSettlementCount = state.settlements.count;
  lastCivCount = state.civs.count;
  const meta = buildSettlementMeta(state);
  if (meta) post({ t: 'settlementMeta', meta });
}

function maybeEmitDelta(force = false): void {
  emitSettlementMetaIfNeeded();
  const t = now();
  if (!force && t - lastEmitAt < DELTA_INTERVAL_MS) {
    pendingDelta = true;
    return;
  }
  const delta = buildDelta();
  if (!delta) {
    pendingDelta = true;
    return;
  }
  pendingDelta = false;
  lastEmitAt = t;
  post({ t: 'delta', delta }, [delta.id.buffer, delta.pop.buffer, delta.civ.buffer, delta.tier.buffer, delta.state.buffer, delta.infra.buffer]);
}

async function create(recipe: WorldRecipe, campaign?: { legacy: number }): Promise<void> {
  clearSchedule();
  speed = 0;
  scheduler = new Scheduler();
  post({ t: 'progress', stage: 'start', pct: 0 });
  const generated = generateV1(recipe, (stage, pct) => post({ t: 'progress', stage, pct }), now);
  state = generated;
  if (campaign) {
    if (!startCampaign(state, campaign.legacy)) throw new SimError('GEN_INVALID', 'unknown legacy path');
    speed = 0;
    scheduler.setSpeed(0);
  }
  const meta = buildWorldMeta(state);
  lastSettlementCount = -1;
  lastCivCount = -1;
  post({ t: 'worldMeta', meta });
  post({ t: 'terrain', width: generated.width, height: generated.height, grids: generated.grids });
  maybeEmitDelta(true);
  notify('info', 'WORLD_READY', `World ready (${generated.report.attempts} attempt(s))`);
}

async function load(shards: readonly SaveShard[]): Promise<void> {
  clearSchedule();
  speed = 0;
  const loaded = await deserializeWorld(shards);
  if (loaded.schemaVersion > SAVE_SCHEMA_VERSION) {
    throw new SimError('SAVE_SCHEMA_NEWER', `save schema ${loaded.schemaVersion}`);
  }
  state = loaded.state;
  const meta = buildWorldMeta(loaded.state);
  lastSettlementCount = -1;
  lastCivCount = -1;
  post({ t: 'worldMeta', meta });
  post({ t: 'terrain', width: loaded.state.width, height: loaded.state.height, grids: loaded.state.grids });
  maybeEmitDelta(true);
  notify('info', 'WORLD_LOADED', `Loaded day ${loaded.state.day}`);
}

let saving = false;

/**
 * Serialise one coherent snapshot.
 *
 * `captureWorld` is synchronous and runs between ticks, so it cannot be interleaved with a tick;
 * everything after it works on immutable byte copies. Computing the checksum from the live state
 * after an `await` was a real defect: the day could advance between capturing the terrain and
 * hashing the world (D-37).
 */
async function save(sid: number): Promise<void> {
  if (!state) {
    notify('warn', 'NO_WORLD', 'save requested without a world');
    return;
  }
  if (saving) {
    notify('warn', 'SAVE_BUSY', 'a save is already being prepared');
    return;
  }
  saving = true;
  try {
    const snapshot = captureWorld(state);
    const shards = await encodeSnapshot(snapshot);
    let total = 0;
    for (const shard of shards) {
      total += shard.bytes;
      post({ t: 'saveShard', ...shard }, [shard.payload]);
    }
    post({ t: 'savePrepared', sid, checksum: snapshot.checksum.toString(16), bytes: total });
  } finally {
    saving = false;
    if (pendingAdvanceDays > 0) {
      const days = pendingAdvanceDays;
      pendingAdvanceDays = 0;
      runAdvance(days);
    }
  }
}

/** Runtime validation: a malformed command must be rejected, never trusted. */
function isSpeed(value: unknown): value is Speed {
  return value === 0 || value === 1 || value === 2 || value === 4 || value === 8;
}

function assertRecipe(recipe: WorldRecipe): void {
  const numeric = [recipe.water, recipe.harshness, recipe.peoples];
  if (!numeric.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    throw new SimError('GEN_INVALID', 'recipe contains a non-finite value');
  }
  if (recipe.water < 0 || recipe.water > 100) throw new SimError('GEN_INVALID', `water ${recipe.water}`);
  if (recipe.harshness < 0 || recipe.harshness > 100) throw new SimError('GEN_INVALID', `harshness ${recipe.harshness}`);
  if (recipe.peoples < 1 || recipe.peoples > 12) throw new SimError('GEN_INVALID', `peoples ${recipe.peoples}`);
  if (!Number.isInteger(recipe.seed.lo) || !Number.isInteger(recipe.seed.hi)) {
    throw new SimError('GEN_INVALID', 'seed words must be integers');
  }
  if (!Number.isInteger(recipe.generatorVersion)) throw new SimError('GEN_INVALID', 'generatorVersion must be an integer');
}

function runAdvance(days: number): void {
  if (!state) return;
  speed = 0;
  scheduler.setSpeed(0);
  clearSchedule();
  for (let i = 0; i < days; i++) runDay(state);
  maybeEmitDelta(true);
  maybeEmitStats();
}

function handle(cmd: Cmd): void {
  switch (cmd.t) {
    case 'init':
      if (cmd.maxSettlements !== CAPACITY.settlements) {
        notify('warn', 'INIT', `maxSettlements ${cmd.maxSettlements} ignored; compiled capacity is ${CAPACITY.settlements}`);
      }
      notify('info', 'READY', 'simulation worker ready');
      break;
    case 'create':
      if (saving) {
        notify('warn', 'BUSY', 'cannot create a world while a save is being prepared');
        break;
      }
      try {
        assertRecipe(cmd.recipe);
      } catch (e) {
        reportFailure(e);
        break;
      }
      void create(cmd.recipe, cmd.campaign).catch(reportFailure);
      break;
    case 'load':
      if (saving) {
        notify('warn', 'BUSY', 'cannot load a world while a save is being prepared');
        break;
      }
      void load(cmd.shards).catch(reportFailure);
      break;
    case 'save':
      void save(cmd.sid).catch(reportFailure);
      break;
    case 'preview': {
      // Real generation, real data, at the smallest preset so the creation screen stays usable.
      // The result is discarded: preview never becomes the session world.
      const preview = generateV1({ ...cmd.recipe, preset: 'small' }, undefined, now);
      post({
        t: 'previewResult',
        token: cmd.token,
        width: preview.width,
        height: preview.height,
        biome: preview.grids.biome.slice(),
        elevation: preview.grids.elevation.slice(),
      });
      break;
    }
    case 'speed':
      if (!isSpeed(cmd.speed)) {
        notify('error', 'PROTOCOL', `invalid speed ${String(cmd.speed)}`);
        break;
      }
      speed = cmd.speed;
      scheduler.setSpeed(cmd.speed);
      lastTickAt = now();
      if (cmd.speed === 0) clearSchedule();
      else schedule(0);
      break;
    case 'pause':
      speed = 0;
      scheduler.setSpeed(0);
      clearSchedule();
      break;
    case 'resume':
      speed = 1;
      scheduler.setSpeed(1);
      lastTickAt = now();
      schedule(0);
      break;
    case 'select':
      if (cmd.id !== null && (!Number.isInteger(cmd.id) || cmd.id < 0 || cmd.id >= CAPACITY.settlements)) {
        notify('warn', 'PROTOCOL', `select id out of range: ${String(cmd.id)}`);
        break;
      }
      selectedId = cmd.id;
      break;
    case 'view':
      break;
    case 'advance': {
      if (!state) {
        notify('warn', 'NO_WORLD', 'advance requested without a world');
        break;
      }
      if (!Number.isInteger(cmd.days) || cmd.days < 1 || cmd.days > 250_000) {
        notify('error', 'PROTOCOL', `invalid advance days ${String(cmd.days)}`);
        break;
      }
      if (saving) {
        // A QA fast-forward that arrives during an autosave is queued, not dropped.
        pendingAdvanceDays = Math.min(250_000, pendingAdvanceDays + cmd.days);
        break;
      }
      runAdvance(cmd.days);
      break;
    }
    case 'release':
      pool.release(cmd.buffers);
      if (pendingDelta) maybeEmitDelta(true);
      break;
    case 'query': {
      const response = runQuery(state, cmd.what, speed, selectedId);
      const transfer: Transferable[] = [];
      if (cmd.what.kind === 'layer' && response.ok) {
        const data = response.data as { cells?: Uint8Array | null; cells2?: Uint8Array | null };
        if (data.cells) transfer.push(data.cells.buffer);
        if (data.cells2) transfer.push(data.cells2.buffer);
      }
      post({ t: 'queryResult', qid: cmd.qid, response }, transfer.length > 0 ? transfer : undefined);
      break;
    }
    case 'player': {
      const result = runPlayer(state, cmd.command);
      post({
        t: 'commandResult',
        token: cmd.token,
        ok: result.ok,
        code: result.code,
        message: result.message,
        eventId: result.eventId,
        effects: result.effects,
        cooldownDays: result.cooldownDays,
      });
      // a command changes what the map and panels must show; push the new mirror immediately
      if (result.ok) maybeEmitDelta(true);
      break;
    }
    case 'campaign': {
      const result = runCampaignCommand(state, cmd.command);
      post({
        t: 'commandResult',
        token: cmd.token,
        ok: result.ok,
        code: result.code,
        message: result.message,
        eventId: result.eventId,
        effects: [],
        cooldownDays: 0,
      });
      if (result.ok) {
        // Stewardship starts paused: the player reads the board and presses play when ready.
        maybeEmitDelta(true);
        maybeEmitStats();
      }
      break;
    }
    case 'dispose':
      clearSchedule();
      state = null;
      scope.close();
      break;
    default: {
      const exhaustive: never = cmd;
      notify('error', 'PROTOCOL', `unknown command ${JSON.stringify(exhaustive)}`);
    }
  }
}

function reportFailure(e: unknown): void {
  const code = e instanceof SimError ? e.code : 'WORKER_CRASH';
  post({ t: 'crashed', code, msg: asErrorMessage(e), lastGoodDay: state?.day ?? 1 });
}

scope.addEventListener('message', (ev) => {
  try {
    handle(ev.data);
  } catch (e) {
    reportFailure(e);
  }
});

// Idle until the main thread sends anything.
clearSchedule();
post({ t: 'ready' });
notify('info', 'READY', 'simulation worker booted');
