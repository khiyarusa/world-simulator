/**
 * World list, creation, loading and autosave. Split from the core loop so each session file owns one
 * concern: this one changes when the player manages worlds, not when the simulation protocol changes.
 */
import { asErrorMessage } from '../core/errors.ts';
import { parseSeedText, seedToText } from '../core/seed.ts';
import { GENERATOR_VERSION } from '../sim/state/worldState.ts';
import type { WorldRecipe } from '../sim/state/worldState.ts';
import { DEFAULT_PRESET, PRESETS } from '../sim/world/presets.ts';
import type { CreateInput, ShellHandlers } from '../ui/shell.ts';
import type { LayerKind, Speed } from '../worker/protocol.ts';
import type { PanelTab } from '../ui/panels.ts';
import { loadWorld, newWorldDoc, saveWorld } from '../platform/saves.ts';
import { migrateDoc } from '../platform/migrations.ts';
import { setLang, t, type Lang } from '../ui/i18n.ts';
import { formatDebug } from './debug.ts';
import { calendarOf } from '../core/clock.ts';
import type { SaveState } from '../ui/panels.ts';
import { SessionCore } from './sessionCore.ts';

export class SessionWorlds extends SessionCore implements ShellHandlers {
  saveState(): SaveState {
    return {
      savedDay: this.lastSavedDay,
      dirty: this.meta !== null && this.lastDay > this.lastSavedDay,
      saving: this.saving,
    };
  }

  async start(): Promise<void> {
    this.client.init();
    await this.refreshWorlds(false);
    this.shell.bootDone();
    this.shell.showWorlds(this.worlds);
    const requested = new URLSearchParams(location.search).get('world');
    if (requested) {
      const target = requested === 'last' ? this.worlds[0]?.id : requested;
      if (target) await this.onWorldsOpen(target);
    }
  }

  // ------------------------------------------------------------------ world list

  protected async refreshWorlds(show = true): Promise<void> {
    try {
      this.worlds = await this.db.listWorlds();
      this.worlds.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (e) {
      this.shell.toast(asErrorMessage(e));
      this.worlds = [];
    }
    if (show) this.shell.showWorlds(this.worlds);
  }

  async onWorldsOpen(id: string): Promise<void> {
    if (this.busy) return;
    try {
      const loaded = await loadWorld(this.db, id);
      if (!loaded) {
        this.shell.toast(t('toast.eventNotFound'));
        return;
      }
      this.resetTransient();
      this.doc = migrateDoc(loaded.doc);
      this.recovered = loaded.recovered;
      this.busy = true;
      this.lastSavedDay = this.doc.day;
      this.lastDay = this.doc.day;
      this.shell.hideWorlds();
      this.shell.setProgress(1);
      this.shell.toast(t('toast.loadingWorld', { name: this.doc.name }));
      this.client.load(loaded.shards);
    } catch (e) {
      this.busy = false;
      this.shell.toast(`${t('toast.saveFailed', { msg: asErrorMessage(e) })}`);
      await this.refreshWorlds(true);
    }
  }

  onWorldsNew(): void {
    this.pauseSimulation();
    this.shell.showCreation();
  }

  async onWorldsRename(id: string, name: string): Promise<void> {
    try {
      const doc = await this.db.getWorld(id);
      if (!doc) return;
      const next = { ...doc, name, updatedAt: Date.now() };
      await this.db.putWorld(next);
      if (this.doc?.id === id) {
        this.doc = { ...this.doc, name };
        this.shell.setSummary(this.summary());
      }
      await this.refreshWorlds(true);
      this.shell.toast(t('toast.worldRenamed'));
    } catch (e) {
      this.shell.toast(t('toast.renameFailed', { msg: asErrorMessage(e) }));
    }
  }

  async onWorldsDelete(id: string): Promise<void> {
    try {
      await this.db.deleteWorld(id);
      if (this.doc?.id === id) this.unloadWorld();
      await this.refreshWorlds(true);
      this.shell.toast(t('toast.worldDeleted'));
    } catch (e) {
      this.shell.toast(t('toast.deleteFailed', { msg: asErrorMessage(e) }));
    }
  }

  protected unloadWorld(): void {
    this.pauseSimulation();
    this.doc = null;
    this.meta = null;
    this.pendingTerrain = null;
    this.selectedId = null;
    this.selectedCivId = null;
    this.layer = 'terrain';
    this.layerDay = -1;
    this.busy = false;
    this.renderer.setSelected(null);
    this.renderer.clearLayer();
    this.labels.setItems([]);
    this.shell.hideChip();
    this.shell.closePanels();
  }

  // ------------------------------------------------------------------ creation

  protected resetTransient(): void {
    this.selectedId = null;
    this.selectedCivId = null;
    this.layer = 'terrain';
    this.layerDay = -1;
    this.speed = 0;
    this.renderer.setSelected(null);
    this.renderer.clearLayer();
    this.labels.setItems([]);
    this.shell.hideChip();
    this.shell.closePanels();
    this.shell.setActiveLayer('terrain');
  }

  async onCreate(input: CreateInput): Promise<void> {
    if (this.busy) return;
    this.pauseSimulation();
    const recipe = this.recipeFrom(input);
    if (!recipe) {
      this.shell.toast(t('create.badSeed'));
      return;
    }
    const name = input.name.trim().length > 0 ? input.name.trim() : defaultWorldName(seedToText(recipe.seed));
    this.busy = true;
    this.recovered = false;
    this.layer = 'terrain';
    this.layerDay = -1;
    this.selectedId = null;
    this.selectedCivId = null;
    this.renderer.setSelected(null);
    this.renderer.clearLayer();
    this.labels.setItems([]);
    this.shell.hideChip();
    this.shell.closePanels();
    this.doc = newWorldDoc(uniqueWorldId(), name, seedToText(recipe.seed), recipe.preset);
    this.doc.thumbnail = '';
    this.population = 0;
    this.lastDay = 1;
    this.lastSavedDay = 0;
    this.shell.setProgress(2);
    this.client.create(recipe);
  }

  async onPreviewRequest(input: CreateInput): Promise<void> {
    const recipe = this.recipeFrom(input);
    if (!recipe) {
      this.shell.toast(t('create.badSeed'));
      return;
    }
    this.previewToken++;
    this.client.preview(recipe, this.previewToken);
  }

  protected recipeFrom(input: CreateInput): WorldRecipe | null {
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


  onSpeed(speed: Speed): void {
    this.speed = speed;
    this.client.setSpeed(speed);
    this.shell.setSpeed(speed);
  }

  onLayer(layer: LayerKind): void {
    this.layer = layer;
    this.shell.setActiveLayer(layer);
    if (layer === 'terrain') {
      this.renderer.clearLayer();
      this.layerDay = this.lastDay;
      return;
    }
    this.shell.toast(t('toast.layerChanged', { name: t(`layer.${layer}`) }));
    void this.refreshLayer(true);
  }

  onOpenPanel(tab: PanelTab): void {
    if (!this.meta) return;
    this.shell.showPanel(tab);
  }

  onChipTap(): void {
    if (this.selectedId === null) return;
    this.shell.showPanel('settlement');
  }

  protected renderDebug(): void {
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
  async onSave(): Promise<void> {
    // A player's Save must not be dropped because an autosave is in flight.
    for (let i = 0; i < 120 && this.saving; i++) await new Promise((resolve) => setTimeout(resolve, 25));
    await this.autosave(true);
  }

  async onBackToWorlds(): Promise<void> {
    this.pauseSimulation();
    await this.refreshWorlds(true);
  }

  onLanguage(lang: Lang): void {
    setLang(lang);
    this.shell.relabel();
  }


  // ------------------------------------------------------------------ saving

  protected updateSaveState(): void {
    this.shell.setSaveState(this.saveState());
  }

  protected async autosave(force = false): Promise<void> {
    if (!this.doc || !this.meta || this.busy || this.saving) return;
    if (!force && Date.now() - this.lastSaveReal < 2_000) return;
    this.saving = true;
    this.updateSaveState();
    try {
      this.doc.counts = {
        settlements: this.meta.settlements.x.length,
        civs: this.meta.civs.nameIdx.length,
        population: this.population,
      };
      const result = await this.client.save();
      const thumbnail = this.renderer.snapshotDataUrl(288);
      if (thumbnail) this.doc.thumbnail = thumbnail;
      this.doc = await saveWorld(this.db, this.doc, result.shards, this.lastDay, result.checksum, this.population);
      this.lastSavedDay = this.lastDay;
      this.lastSaveReal = Date.now();
      this.shell.setSummary(this.summary());
      this.updateSaveState();
      this.shell.toast(t('common.saved'));
      const exists = this.worlds.some((w) => w.id === this.doc?.id);
      if (!exists) await this.refreshWorlds(false);
    } catch (e) {
      this.shell.toast(t('toast.saveFailed', { msg: asErrorMessage(e) }));
    } finally {
      this.saving = false;
      this.updateSaveState();
    }
  }

}

function uniqueWorldId(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return `w-${Date.now().toString(36)}-${(buf[0] ?? 0).toString(36)}`;
}

function defaultWorldName(seedText: string): string {
  return `${t('world.title')} ${seedText.slice(0, 4)}`;
}
