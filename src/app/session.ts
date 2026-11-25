/**
 * Session: the main-thread coordinator. Owns the worker client, renderer, shell and storage, and
 * wires them together. It applies no game rule — every number it shows came from the worker.
 */
import { calendarOf, formatDate } from '../core/clock.ts';
import { asErrorMessage } from '../core/errors.ts';
import { parseSeedText, seedToText } from '../core/seed.ts';
import type { TerrainArrays } from '../core/gridTypes.ts';
import { GENERATOR_VERSION } from '../sim/state/worldState.ts';
import type { WorldRecipe } from '../sim/state/worldState.ts';
import { DEFAULT_PRESET, PRESETS } from '../sim/world/presets.ts';
import { BIOME_NAMES } from '../sim/world/biomes.ts';
import { settlementName } from '../sim/world/names.ts';
import { Renderer, TILE_PX, type ViewState } from '../render/app.ts';
import { bakeTerrain } from '../render/terrainBake.ts';
import { Labels, type LabelItem } from '../ui/labels.ts';
import { WorkerClient, type ClientHandlers, type PreviewPayload, type TickStatsMsg } from '../worker/client.ts';
import type { MirrorDelta, Speed, WorldMetaMsg } from '../worker/protocol.ts';
import { Shell, type CreateInput, type ShellHandlers, type WorldSummary } from '../ui/shell.ts';
import { formatCompact, tierName } from '../ui/format.ts';
import { FrameTimer, formatDebug, isDebugEnabled } from './debug.ts';
import { WorldDb } from '../platform/storage.ts';
import { DEFAULT_WORLD_ID, loadWorld, newWorldDoc, saveWorld } from '../platform/saves.ts';
import { migrateDoc } from '../platform/migrations.ts';
import type { WorldDoc } from '../platform/storage.ts';

const AUTOSAVE_REAL_MS = 60_000;
const AUTOSAVE_DAYS = 90;
const VIEW_SEND_MS = 250;
const LABEL_MIN_ZOOM = 0.09;

interface SettlementQuery {
  readonly name: string;
  readonly civName: string;
  readonly tier: number;
  readonly pop: number;
  readonly x: number;
  readonly y: number;
  readonly foundedDay: number;
  readonly biome: number;
  readonly riverId: number;
  readonly lakeId: number;
}

export class Session implements ClientHandlers, ShellHandlers {
  private readonly shell: Shell;
  private readonly client: WorkerClient;
  private readonly labels: Labels;
  private readonly db = new WorldDb();
  private readonly renderer: Renderer;

  private doc: WorldDoc | null = null;
  private meta: WorldMetaMsg | null = null;
  private pendingTerrain: { width: number; height: number; grids: TerrainArrays } | null = null;
  private population = 0;
  private selectedId: number | null = null;
  private lastSavedDay = 0;
  private lastSaveReal = 0;
  private lastViewSent = 0;
  private previewToken = 0;
  private stats: TickStatsMsg | null = null;
  private speed: Speed = 0;
  private speedBeforeHide: Speed = 1;
  private readonly debugEnabled = isDebugEnabled(location.search);
  private readonly frames = new FrameTimer();
  private busy = false;
  private saving = false;
  private recovered = false;
  private lastDay = 1;

  private constructor(shell: Shell, renderer: Renderer) {
    this.shell = shell;
    this.renderer = renderer;
    this.labels = new Labels(shell.labelsHost);
    this.client = new WorkerClient(this);
    if (this.debugEnabled) window.setInterval(() => this.renderDebug(), 500);
    // Real-time autosave (the other trigger is 90 simulated days, in onDelta).
    window.setInterval(() => void this.autosave(), AUTOSAVE_REAL_MS);
  }

  static async create(host: HTMLElement): Promise<Session> {
    const ref: { session: Session | null } = { session: null };
    const shell = new Shell({
      onCreate: (input) => void ref.session?.onCreate(input),
      onPreviewRequest: (input) => void ref.session?.onPreviewRequest(input),
      onSpeed: (speed) => ref.session?.onSpeed(speed),
      onSave: () => void ref.session?.onSave(),
      onWorldInfo: () => ref.session?.onWorldInfo(),
      onChipTap: () => void ref.session?.onChipTap(),
    });
    const renderer = await Renderer.create(host, {
      onTap: (p) => void ref.session?.handleTap(p.x / TILE_PX, p.y / TILE_PX),
      onTapEmpty: () => ref.session?.clearSelection(),
      onViewChange: (view) => ref.session?.handleView(view),
      onFrame: (ms) => ref.session?.frames.push(ms),
    });
    const session = new Session(shell, renderer);
    ref.session = session;
    return session;
  }

  async start(): Promise<void> {
    this.client.init();
    this.shell.bootDone();
    try {
      const loaded = await loadWorld(this.db, DEFAULT_WORLD_ID);
      if (loaded) {
        this.doc = migrateDoc(loaded.doc);
        this.busy = true;
        this.lastSavedDay = this.doc.day;
        this.recovered = loaded.recovered;
        this.client.load(loaded.shards);
        this.shell.toast(loaded.recovered ? 'Recovered the previous save generation' : `Loading ${this.doc.name}`);
      } else {
        this.shell.showCreation();
      }
    } catch (e) {
      this.shell.toast(asErrorMessage(e));
      this.shell.showCreation();
    }
  }

  // ------------------------------------------------------------------ creation

  async onCreate(input: CreateInput): Promise<void> {
    if (this.busy) return;
    const recipe = this.recipeFrom(input);
    if (!recipe) {
      this.shell.toast('Seed must look like A1B2C3D4-5E6F7A8B');
      return;
    }
    this.busy = true;
    this.shell.setProgress(2);
    this.doc = newWorldDoc(
      DEFAULT_WORLD_ID,
      `World ${seedToText(recipe.seed).slice(0, 4)}`,
      seedToText(recipe.seed),
      input.preset,
    );
    this.client.create(recipe);
  }

  async onPreviewRequest(input: CreateInput): Promise<void> {
    const recipe = this.recipeFrom(input);
    if (!recipe) {
      this.shell.toast('Seed must look like A1B2C3D4-5E6F7A8B');
      return;
    }
    this.previewToken++;
    this.client.preview(recipe, this.previewToken);
  }

  private recipeFrom(input: CreateInput): WorldRecipe | null {
    const seed = parseSeedText(input.seedText);
    if (!seed) return null;
    const preset = input.preset in PRESETS ? input.preset : DEFAULT_PRESET;
    return {
      seed,
      preset,
      water: input.water,
      harshness: input.harshness,
      peoples: input.peoples,
      generatorVersion: GENERATOR_VERSION,
    };
  }

  // ------------------------------------------------------------------ worker events

  onReady(): void {
    // Worker is up; nothing to request until the player picks a world.
  }

  onProgress(_stage: string, pct: number): void {
    this.shell.setProgress(pct);
  }

  onMeta(meta: WorldMetaMsg): void {
    this.meta = meta;
    this.lastDay = meta.day;
    this.population = sumInt32(meta.settlements.pop);
    this.shell.setDate(formatDate(meta.day));
    this.maybeMount();
  }

  onTerrain(width: number, height: number, grids: TerrainArrays): void {
    this.pendingTerrain = { width, height, grids };
    this.maybeMount();
  }

  private maybeMount(): void {
    if (!this.meta || !this.pendingTerrain || !this.doc) return;
    const meta = this.meta;
    const terrain = this.pendingTerrain;
    this.pendingTerrain = null;

    // Bake on the next frame so the "creating" state paints before the ~60 ms main-thread cost.
    requestAnimationFrame(() => {
      const baked = bakeTerrain(terrain.grids, terrain.width, terrain.height, meta.seaLevel);
      this.renderer.mountWorld(meta, baked);
      this.buildLabels();
      this.shell.showWorld(this.summary());
      this.shell.setSpeed(0);
      this.speed = 0;
      this.busy = false;
      this.lastSavedDay = meta.day;
      this.shell.toast(
        this.recovered
          ? 'Recovered the previous save generation'
          : `World ready · ${meta.settlements.x.length} settlements`,
      );
      if (this.debugEnabled) this.renderDebug();
    });
  }

  onDelta(delta: MirrorDelta): void {
    this.renderer.applyMirror(delta);
    this.lastDay = delta.day;
    this.population = sumInt32(delta.pop, delta.count);
    this.shell.setDate(formatDate(delta.day));
    if (this.selectedId !== null && this.shell.chipVisible) {
      const idx = delta.id.indexOf(this.selectedId);
      if (idx >= 0) {
        this.shell.showChip(
          this.nameOf(this.selectedId),
          `${tierName(delta.tier[idx] ?? 0)} · ${formatCompact(delta.pop[idx] ?? 0)}`,
        );
      }
    }
    if (delta.day - this.lastSavedDay >= AUTOSAVE_DAYS) void this.autosave();
  }

  onStats(stats: TickStatsMsg): void {
    this.stats = stats;
  }

  onNotify(level: 'info' | 'warn' | 'error', code: string, msg: string): void {
    if (level === 'error') this.shell.toast(`${code}: ${msg}`);
  }

  onCrash(code: string, msg: string, lastGoodDay: number): void {
    this.busy = false;
    this.shell.toast(`Simulation failed (${code}) at day ${lastGoodDay}: ${msg}`);
  }

  onPreview(payload: PreviewPayload): void {
    if (payload.token !== this.previewToken) return;
    this.shell.drawPreview(payload.width, payload.height, payload.biome, payload.elevation);
    this.shell.showPreview();
  }

  // ------------------------------------------------------------------ shell events

  /**
   * Backgrounding must stop the simulation, not just hide it: a throttled timer would otherwise
   * accumulate a backlog the player never asked for (docs/TECHNICAL_ARCHITECTURE.md §6).
   */
  pauseForBackground(): void {
    if (this.speed !== 0) {
      this.speedBeforeHide = this.speed;
      this.onSpeed(0);
    }
  }

  resumeFromBackground(): void {
    if (this.meta && this.speed === 0) this.onSpeed(this.speedBeforeHide);
  }

  onSpeed(speed: Speed): void {
    this.speed = speed;
    this.client.setSpeed(speed);
    this.shell.setSpeed(speed);
  }

  onWorldInfo(): void {
    if (!this.meta || !this.doc) {
      this.shell.showCreation();
      return;
    }
    this.shell.openWorldSheet(this.summary());
  }

  async onSave(): Promise<void> {
    // An explicit "Save now" must never be swallowed by the autosave throttle.
    await this.autosave(true);
  }

  async onChipTap(): Promise<void> {
    const id = this.selectedId;
    if (id === null) return;
    const detail = await this.client.query<SettlementQuery | null>({ kind: 'settlement', id });
    if (!detail) return;
    this.shell.openSettlementSheet({
      name: detail.name,
      civName: detail.civName,
      tier: detail.tier,
      population: detail.pop,
      x: detail.x,
      y: detail.y,
      biome: BIOME_NAMES[detail.biome] ?? 'Unknown',
      water: detail.riverId > 0 || detail.lakeId > 0,
      foundedDay: detail.foundedDay,
    });
  }

  // ------------------------------------------------------------------ map interaction

  private async handleTap(tileX: number, tileY: number): Promise<void> {
    const id = this.renderer.nearestSettlement(tileX, tileY, 6);
    if (id === null) {
      this.clearSelection();
      return;
    }
    this.selectedId = id;
    this.renderer.setSelected(id);
    this.client.select(id);
    const detail = await this.client.query<SettlementQuery | null>({ kind: 'settlement', id });
    this.shell.showChip(
      detail?.name ?? this.nameOf(id),
      `${tierName(detail?.tier ?? 0)} · ${formatCompact(detail?.pop ?? 0)}`,
    );
  }

  private clearSelection(): void {
    this.selectedId = null;
    this.renderer.setSelected(null);
    this.client.select(null);
    this.shell.hideChip();
    this.shell.closeSheet();
  }

  private handleView(view: ViewState): void {
    const now = performance.now();
    if (now - this.lastViewSent > VIEW_SEND_MS) {
      this.lastViewSent = now;
      this.client.setView(view.x / TILE_PX, view.y / TILE_PX, view.tilesWide, view.tilesHigh, view.zoom);
    }
    this.labels.setVisible(view.zoom > LABEL_MIN_ZOOM);
    const screen = this.renderer.app.screen;
    this.labels.update((wx, wy) => this.renderer.worldToScreen(wx, wy), screen.width, screen.height);
  }

  // ------------------------------------------------------------------ labels

  private buildLabels(): void {
    const meta = this.meta;
    if (!meta) return;
    const items: LabelItem[] = [];
    const capitals = meta.civs.nameIdx.length;
    for (let i = 0; i < meta.settlements.x.length; i++) {
      items.push({
        id: i,
        wx: ((meta.settlements.x[i] ?? 0) + 0.5) * TILE_PX,
        wy: ((meta.settlements.y[i] ?? 0) + 0.5) * TILE_PX,
        name: this.nameOf(i),
        weight: (meta.settlements.pop[i] ?? 0) + (i < capitals ? 100_000 : 0),
        capital: i < capitals,
      });
    }
    this.labels.setItems(items);
  }

  private nameOf(id: number): string {
    if (!this.doc) return `#${id}`;
    const seed = parseSeedText(this.doc.seedText);
    if (!seed) return `#${id}`;
    return settlementName(seed, this.meta?.settlements.nameIdx[id] ?? id);
  }

  private summary(): WorldSummary {
    const meta = this.meta;
    const doc = this.doc;
    return {
      seedText: doc?.seedText ?? '—',
      preset: doc?.preset ?? 'medium',
      day: meta?.day ?? 1,
      settlements: meta?.settlements.x.length ?? 0,
      civs: meta?.civs.nameIdx.length ?? 0,
      population: this.population,
      landFraction: meta?.report.landFraction ?? 0,
    };
  }

  // ------------------------------------------------------------------ saving

  private async autosave(force = false): Promise<void> {
    if (!this.doc || !this.meta || this.busy || this.saving) return;
    if (!force && Date.now() - this.lastSaveReal < 2_000) return;
    this.saving = true;
    try {
      const result = await this.client.save();
      this.doc = await saveWorld(
        this.db,
        this.doc,
        result.shards,
        this.lastDay,
        result.checksum,
        this.population,
      );
      this.lastSavedDay = this.lastDay;
      this.lastSaveReal = Date.now();
      this.shell.setSummary(this.summary());
      this.shell.toast('World saved');
    } catch (e) {
      this.shell.toast(`Save failed: ${asErrorMessage(e)}`);
    } finally {
      this.saving = false;
    }
  }

  // ------------------------------------------------------------------ debug

  private renderDebug(): void {
    if (!this.debugEnabled) return;
    const s = this.stats;
    this.shell.setDebug(
      formatDebug({
        day: this.lastDay,
        speed: this.speed,
        season: calendarOf(this.lastDay).seasonName,
        tickP50: s?.tickP50 ?? 0,
        tickP95: s?.tickP95 ?? 0,
        tickMax: s?.tickMax ?? 0,
        dropped: s?.dropped ?? 0,
        zoom: this.renderer.cam.zoom,
        camX: this.renderer.cam.x,
        camY: this.renderer.cam.y,
        settlements: this.meta?.settlements.x.length ?? 0,
        population: this.population,
        frameP50: this.frames.percentile(0.5),
        frameP95: this.frames.percentile(0.95),
      }),
    );
  }

  /** Minimal surface for browser smoke tests and the debug console. */
  debugState(): { day: number; settlements: number; speed: number; world: boolean; zoom: number } {
    return {
      day: this.lastDay,
      settlements: this.meta?.settlements.x.length ?? 0,
      speed: this.speed,
      world: this.meta !== null,
      zoom: this.renderer.cam.zoom,
    };
  }

  /** Framebuffer probe for the browser smoke test. */
  probe(): { min: number; max: number; sum: number } {
    return this.renderer.probePixels();
  }

  /** World checksum from the worker: the only honest fingerprint of the generated world. */
  async worldChecksum(): Promise<number> {
    const data = await this.client.query<{ checksum: number } | null>({ kind: 'world' });
    return data?.checksum ?? 0;
  }

  /** Screen position of a settlement, for touch-driven browser tests. */
  settlementScreen(id: number): { x: number; y: number } | null {
    const meta = this.meta;
    if (!meta || id < 0 || id >= meta.settlements.x.length) return null;
    const p = this.renderer.worldToScreen(
      ((meta.settlements.x[id] ?? 0) + 0.5) * TILE_PX,
      ((meta.settlements.y[id] ?? 0) + 0.5) * TILE_PX,
    );
    return { x: Math.round(p.x), y: Math.round(p.y) };
  }
}

function sumInt32(arr: Int32Array, count = arr.length): number {
  let total = 0;
  for (let i = 0; i < count; i++) total += arr[i] ?? 0;
  return total;
}

