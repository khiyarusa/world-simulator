/**
 * Session: the main-thread coordinator (Stage 4).
 *
 * Owns the worker client, renderer, shell, panels, world list and storage. It applies no game rule:
 * every displayed number came from a worker query and every player action is a worker command whose
 * structured result is what the UI reports.
 */
import { asErrorMessage } from '../core/errors.ts';
import { parseSeedText } from '../core/seed.ts';
import type { TerrainArrays } from '../core/gridTypes.ts';
import { settlementName } from '../sim/world/names.ts';
import { DEFAULT_PRESET } from '../sim/world/presets.ts';
import type { Renderer } from '../render/app.ts';
import { TILE_PX, type ViewState } from '../render/app.ts';
import { bakeTerrain } from '../render/terrainBake.ts';
import { Labels, type LabelItem } from '../ui/labels.ts';
import { WorkerClient, type ClientHandlers, type PreviewPayload, type TickStatsMsg } from '../worker/client.ts';
import type { EcologyMetric, LayerKind, MirrorDelta, SettlementMetaMsg, Speed, WorldMetaMsg } from '../worker/protocol.ts';
import type { Shell, WorldSummary } from '../ui/shell.ts';
import type { CampaignSummary } from '../worker/protocol.ts';
import type { LayerData, SettlementView } from '../worker/queries.ts';
import { fmtCompact, tierLabel } from '../ui/i18n.ts';
import { FrameTimer, isDebugEnabled } from './debug.ts';
import { WorldDb } from '../platform/storage.ts';
import type { WorldDoc } from '../platform/storage.ts';
import { t } from '../ui/i18n.ts';
import { applyPrefs, loadPrefs, motionReduced, type UiPrefs } from '../ui/prefs.ts';

const AUTOSAVE_DAYS = 90;
const VIEW_SEND_MS = 250;
const LAYER_REFRESH_DAYS = 30;

export abstract class SessionCore implements ClientHandlers {
  protected abstract autosave(force?: boolean): Promise<void>;
  protected abstract updateSaveState(): void;
  protected abstract onSpeed(speed: Speed): void;
  protected abstract renderDebug(): void;
  protected prefs: UiPrefs = loadPrefs();
  protected readonly shell: Shell;
  protected readonly client: WorkerClient;
  protected readonly labels: Labels;
  protected readonly db = new WorldDb();
  protected readonly renderer: Renderer;

  protected doc: WorldDoc | null = null;
  protected worlds: WorldDoc[] = [];
  protected meta: WorldMetaMsg | null = null;
  protected pendingTerrain: { width: number; height: number; grids: TerrainArrays } | null = null;
  protected population = 0;
  protected selectedId: number | null = null;
  protected selectedCivId: number | null = null;
  protected lastSavedDay = 0;
  protected lastSaveReal = 0;
  protected lastViewSent = 0;
  protected previewToken = 0;
  protected stats: TickStatsMsg | null = null;
  protected speed: Speed = 0;
  protected speedBeforeHide: Speed = 1;
  protected readonly debugEnabled = isDebugEnabled(location.search);
  protected readonly frames = new FrameTimer();
  protected busy = false;
  protected saving = false;
  protected recovered = false;
  protected lastDay = 1;
  protected layer: LayerKind = 'terrain';
  protected layerMetric: EcologyMetric = 'fertility';
  protected layerDay = -1;
  protected layerBusy = false;
  protected panelRefreshAt = 0;
  protected lastPanelDay = -1;
  protected lastBakeMs = 0;
  protected lastLayerMs = 0;

  protected constructor(shell: Shell, renderer: Renderer) {
    this.shell = shell;
    this.renderer = renderer;
    this.labels = new Labels(shell.labelsHost);
    this.client = new WorkerClient(this);
    applyPrefs(this.prefs);
    this.renderer.setReducedMotion(motionReduced(this.prefs));
    this.renderer.setLowPower(this.prefs.lowPower);
  }

  /** Session hooks for campaign queries; the core owns no campaign reads. */
  protected onCampaignMeta(_summary: CampaignSummary | undefined): void {}

  // ------------------------------------------------------------------ worker events

  onReady(): void {
    // idle until a world is requested
  }

  onProgress(_stage: string, pct: number): void {
    this.shell.setProgress(pct);
  }

  onMeta(meta: WorldMetaMsg): void {
    this.meta = meta;
    this.lastDay = meta.day;
    this.population = sumInt32(meta.settlements.pop);
    this.shell.setDate(meta.day);
    this.shell.setCampaignSummary(meta.campaign);
    this.maybeMount();
    this.onCampaignMeta(meta.campaign);
  }

  onTerrain(width: number, height: number, grids: TerrainArrays): void {
    this.pendingTerrain = { width, height, grids };
    this.maybeMount();
  }

  onSettlementMeta(meta: SettlementMetaMsg): void {
    if (!this.meta) return;
    this.meta = { ...this.meta, day: meta.day, settlements: meta.settlements, civs: meta.civs };
    this.renderer.setSettlementLayout(this.meta);
    this.buildLabels();
    this.shell.setSummary(this.summary());
    this.lastDay = meta.day;
    this.shell.setDate(meta.day);
  }

  protected maybeMount(): void {
    if (!this.meta || !this.pendingTerrain || !this.doc) return;
    const meta = this.meta;
    const terrain = this.pendingTerrain;
    this.pendingTerrain = null;

    requestAnimationFrame(() => {
      const bakeStart = performance.now();
      const baked = bakeTerrain(terrain.grids, terrain.width, terrain.height, meta.seaLevel);
      this.lastBakeMs = Math.round(performance.now() - bakeStart);
      this.renderer.mountWorld(meta, baked, terrain.grids);
      this.buildLabels();
      this.shell.showWorld(this.summary());
      this.shell.setSpeed(0);
      this.speed = 0;
      this.busy = false;
      this.lastSavedDay = meta.day;
      this.layerDay = -1;
      this.shell.setActiveLayer('terrain');
      this.renderer.clearLayer();
      this.shell.setPrefs(this.prefs);
      this.updateSaveState();
      this.shell.toast(
        this.recovered
          ? t('toast.recovered')
          : t('toast.worldReady', { n: fmtCompact(meta.settlements.x.length) }),
      );
      if (this.debugEnabled) this.renderDebug();
      // a brand-new world has no generation on disk yet; persist it immediately so it appears in
      // the world list and can survive a kill
      this.shell.startOnboarding();
      if (this.doc && this.doc.currentGen === 0) void this.autosave(true);
    });
  }

  onDelta(delta: MirrorDelta): void {
    this.renderer.applyMirror(delta);
    this.lastDay = delta.day;
    this.population = sumInt32(delta.pop, delta.count);
    this.shell.setDate(delta.day);
    this.shell.setMapStats(this.summary());
    this.updateSaveState();
    if (this.selectedId !== null && this.shell.chipVisible) {
      const idx = delta.id.indexOf(this.selectedId);
      if (idx >= 0) {
        this.shell.showChip(
          this.nameOf(this.selectedId),
          `${tierLabel(delta.tier[idx] ?? 0)} · ${fmtCompact(delta.pop[idx] ?? 0)}`,
        );
      }
    }
    if (delta.day - this.lastSavedDay >= AUTOSAVE_DAYS) void this.autosave();
    const layerDays = this.prefs.lowPower ? 180 : this.layer === 'political' ? 90 : LAYER_REFRESH_DAYS;
    if (this.layer !== 'terrain' && delta.day - this.layerDay >= layerDays) {
      void this.refreshLayer(false);
    }
  }

  onStats(stats: TickStatsMsg): void {
    this.stats = stats;
  }

  onNotify(level: 'info' | 'warn' | 'error', code: string, msg: string): void {
    if (level === 'error') this.shell.toast(`${code}: ${msg}`);
  }

  onCrash(code: string, msg: string, lastGoodDay: number): void {
    this.busy = false;
    this.shell.toast(t('toast.simFailed', { code, day: lastGoodDay, msg }));
  }

  onPreview(payload: PreviewPayload): void {
    if (payload.token !== this.previewToken) return;
    this.shell.drawPreview(payload.width, payload.height, payload.biome, payload.elevation);
    this.shell.showPreview();
  }


  // ------------------------------------------------------------------ shell events

  pauseForBackground(): void {
    if (this.speed !== 0) {
      this.speedBeforeHide = this.speed;
      this.onSpeed(0);
    }
  }

  resumeFromBackground(): void {
    if (this.meta && this.speed === 0) this.onSpeed(this.speedBeforeHide);
  }

  protected pauseSimulation(): void {
    if (this.speed !== 0) {
      this.speedBeforeHide = this.speed;
      this.onSpeed(0);
    }
  }


  // ------------------------------------------------------------------ map interaction

  protected async handleTap(tileX: number, tileY: number): Promise<void> {
    const marker = this.renderer.markerAt(tileX, tileY);
    if (marker) {
      if (marker.layer === 'history') {
        this.shell.showEvent(marker.id);
        return;
      }
      if (marker.layer === 'population' || marker.layer === 'economy') {
        await this.tapSettlement(marker.id, true);
        return;
      }
    }
    const id = this.renderer.nearestSettlement(tileX, tileY, 6);
    if (id === null) {
      this.clearSelection();
      return;
    }
    await this.tapSettlement(id, false);
  }

  protected async handleLongPress(tileX: number, tileY: number): Promise<void> {
    const id = this.renderer.nearestSettlement(tileX, tileY, 4);
    if (id !== null) {
      await this.tapSettlement(id, true);
      return;
    }
    if (this.layer === 'history') {
      const marker = this.renderer.markerAt(tileX, tileY, 3);
      if (marker) this.shell.showEvent(marker.id);
    }
  }

  protected async tapSettlement(id: number, openPanel: boolean): Promise<void> {
    this.selectedId = id;
    this.renderer.setSelected(id);
    this.labels.setSelected(id);
    this.client.select(id);
    try {
      const detail = await this.client.query<SettlementView | null>({ kind: 'settlement', id });
      if (detail) {
        this.selectedCivId = detail.civId;
        this.shell.showChip(detail.name, `${tierLabel(detail.tier)} · ${fmtCompact(detail.pop)}`);
    this.shell.notifyInteraction('settlement');
      } else {
        this.shell.showChip(this.nameOf(id), '');
      }
    } catch {
      this.shell.showChip(this.nameOf(id), '');
    }
    if (openPanel || this.shell.panelsOpen) this.shell.showPanel('settlement');
    else this.shell.selectionChanged();
  }

  protected clearSelection(): void {
    this.selectedId = null;
    this.renderer.setSelected(null);
    this.labels.setSelected(null);
    this.client.select(null);
    this.shell.hideChip();
    if (this.shell.panelsOpen && (this.shell.activePanel === 'settlement' || this.shell.activePanel === 'influence')) {
      this.shell.selectionChanged();
    }
  }

  protected handleView(view: ViewState): void {
    const now = performance.now();
    if (now - this.lastViewSent > VIEW_SEND_MS) {
      this.lastViewSent = now;
      this.client.setView(view.x / TILE_PX, view.y / TILE_PX, view.tilesWide, view.tilesHigh, view.zoom);
    }
    this.labels.setZoom(view.zoom);
    const km = Math.max(1, Math.round((54 / (view.zoom * TILE_PX)) * 3));
    this.shell.setScale(km);
    const screen = this.renderer.app.screen;
    this.labels.update((wx, wy) => this.renderer.worldToScreen(wx, wy), screen.width, screen.height);
  }

  protected buildLabels(): void {
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
    const screen = this.renderer.app.screen;
    this.labels.setZoom(this.renderer.cam.zoom);
    this.labels.update((wx, wy) => this.renderer.worldToScreen(wx, wy), screen.width, screen.height);
  }

  protected nameOf(id: number): string {
    if (!this.doc) return `#${id}`;
    const seed = parseSeedText(this.doc.seedText);
    if (!seed) return `#${id}`;
    return settlementName(seed, this.meta?.settlements.nameIdx[id] ?? id);
  }

  protected summary(): WorldSummary {
    const meta = this.meta;
    const doc = this.doc;
    return {
      name: doc?.name ?? '—',
      seedText: doc?.seedText ?? '—',
      preset: doc?.preset ?? DEFAULT_PRESET,
      day: meta?.day ?? this.lastDay,
      settlements: meta?.settlements.x.length ?? 0,
      civs: meta?.civs.nameIdx.length ?? 0,
      population: this.population,
      landFraction: meta?.report.landFraction ?? 0,
    };
  }


  // ------------------------------------------------------------------ layers

  protected async refreshLayer(force: boolean): Promise<void> {
    if (!this.meta || this.layer === 'terrain' || this.layerBusy) return;
    if (!force && this.layerDay >= 0 && this.lastDay - this.layerDay < LAYER_REFRESH_DAYS) return;
    const requested = this.layer;
    this.layerBusy = true;
    try {
      const queryStart = performance.now();
      const data = await this.client.query<LayerData>({
        kind: 'layer',
        layer: requested,
        metric: requested === 'ecology' ? this.layerMetric : undefined,
      });
      if (this.layer !== requested) return;
      this.renderer.setLayer(data, {
        width: this.meta.width,
        height: this.meta.height,
        seaLevel: this.meta.seaLevel,
      });
      this.layerDay = this.lastDay;
      this.lastLayerMs = Math.round(performance.now() - queryStart);
    } catch (e) {
      this.shell.toast(`${t('toast.noLayerData')}: ${asErrorMessage(e)}`);
    } finally {
      this.layerBusy = false;
    }
  }
}

function sumInt32(arr: Int32Array, count = arr.length): number {
  let total = 0;
  for (let i = 0; i < count; i++) total += arr[i] ?? 0;
  return total;
}
