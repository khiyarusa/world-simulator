/**
 * The session facade: panel API, debug surface and creation entry point. All simulation and world
 * management live in the two base classes; this file only exposes them to the UI and tests.
 */
import type { CommandResult } from '../worker/client.ts';
import type { EcologyMetric, HistoryFilter, LayerKind, PlayerCommand } from '../worker/protocol.ts';
import type { PanelApi, PanelTab } from '../ui/panels.ts';
import type { ChroniclePage, CivSummary, CivView, EconomyView, EcologyView, EventDetail, HistoryPage, InterventionInfo, LayerData, SettlementSummary, SettlementView, WorldView } from '../worker/queries.ts';
import { SessionWorlds } from './sessionWorlds.ts';
import { Shell } from '../ui/shell.ts';
import { Renderer, TILE_PX } from '../render/app.ts';
import type { WorldDoc } from '../platform/storage.ts';
import { initLang, t, type Lang } from '../ui/i18n.ts';

export class Session extends SessionWorlds implements PanelApi {
  private disposed = false;

  constructor(shell: Shell, renderer: Renderer) {
    super(shell, renderer);
    shell.attachPanels(this);
    if (this.debugEnabled) window.setInterval(() => this.renderDebug(), 500);
    window.setInterval(() => void this.autosave(), 60_000);
    window.setInterval(() => {
      if (this.speed !== 0 && this.shell.panelsOpen && this.lastDay !== this.lastPanelDay) {
        const now = Date.now();
        if (now - this.panelRefreshAt > 4_000) {
          this.panelRefreshAt = now;
          this.lastPanelDay = this.lastDay;
          this.shell.refreshPanels();
        }
      }
    }, 1_500);
  }

  static async create(host: HTMLElement): Promise<Session> {
    initLang();
    const ref: { session: Session | null } = { session: null };
    const shell = new Shell({
      onCreate: (input) => void ref.session?.onCreate(input),
      onPreviewRequest: (input) => void ref.session?.onPreviewRequest(input),
      onSpeed: (speed) => ref.session?.onSpeed(speed),
      onSave: () => void ref.session?.onSave(),
      onLayer: (layer) => ref.session?.onLayer(layer),
      onLayerMetric: (metric) => ref.session?.onLayerMetric(metric),
      onOpenPanel: (tab) => ref.session?.onOpenPanel(tab),
      onChipTap: () => ref.session?.onChipTap(),
      onBackToWorlds: () => void ref.session?.onBackToWorlds(),
      onWorldsOpen: (id) => void ref.session?.onWorldsOpen(id),
      onWorldsNew: () => ref.session?.onWorldsNew(),
      onWorldsRename: (id, name) => void ref.session?.onWorldsRename(id, name),
      onWorldsDelete: (id) => void ref.session?.onWorldsDelete(id),
      onLanguage: (lang) => ref.session?.onLanguage(lang),
      onPrefs: (prefs) => ref.session?.onPrefs(prefs),
      onReplayOnboarding: () => ref.session?.onReplayOnboarding(),
    });
    const renderer = await Renderer.create(host, {
      onTap: (p) => void ref.session?.handleTap(p.x / TILE_PX, p.y / TILE_PX),
      onTapEmpty: () => ref.session?.clearSelection(),
      onLongPress: (p) => void ref.session?.handleLongPress(p.x / TILE_PX, p.y / TILE_PX),
      onViewChange: (view) => ref.session?.handleView(view),
      onFrame: (ms) => ref.session?.frames.push(ms),
    });
    const session = new Session(shell, renderer);
    ref.session = session;
    return session;
  }

  // ------------------------------------------------------------------ PanelApi

  async queryWorld(): Promise<WorldView> {
    return this.client.query<WorldView>({ kind: 'world' });
  }

  async querySettlement(id: number): Promise<SettlementView | null> {
    return this.client.query<SettlementView | null>({ kind: 'settlement', id });
  }

  async querySettlements(): Promise<{ total: number; offset: number; rows: SettlementSummary[] }> {
    return this.client.query<{ total: number; offset: number; rows: SettlementSummary[] }>({ kind: 'settlements', limit: 200 });
  }

  async queryCivs(): Promise<CivSummary[]> {
    return this.client.query<CivSummary[]>({ kind: 'civs' });
  }

  async queryCiv(id: number): Promise<CivView | null> {
    return this.client.query<CivView | null>({ kind: 'civ', id });
  }

  async queryEconomy(civ?: number): Promise<EconomyView> {
    return this.client.query<EconomyView>({ kind: 'economy', civ });
  }

  async queryEcology(settlement?: number): Promise<EcologyView> {
    return this.client.query<EcologyView>({ kind: 'ecology', settlement });
  }

  async queryHistory(filter: HistoryFilter, offset: number, limit: number): Promise<HistoryPage> {
    return this.client.query<HistoryPage>({ kind: 'history', filter, offset, limit });
  }

  async queryEvent(id: number): Promise<EventDetail | null> {
    return this.client.query<EventDetail | null>({ kind: 'event', id });
  }

  async queryChronicle(fromYear: number | undefined, toYear: number | undefined, offset: number, limit: number): Promise<ChroniclePage> {
    return this.client.query<ChroniclePage>({ kind: 'chronicle', fromYear, toYear, offset, limit });
  }

  async queryInterventions(): Promise<InterventionInfo[]> {
    return this.client.query<InterventionInfo[]>({ kind: 'interventions' });
  }

  async command(command: PlayerCommand): Promise<CommandResult> {
    return this.client.command(command);
  }

  /**
   * Release the GPU context and the simulation worker when the page is really going away.
   * Navigation in a WebView fires `pagehide`; backgrounding only fires `visibilitychange`, so the
   * running app is never destroyed by a normal app switch.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.client.dispose();
    this.renderer.destroy();
  }

  focusSettlement(id: number): void {
    const meta = this.meta;
    if (!meta || id < 0 || id >= meta.settlements.x.length) return;
    this.renderer.flyTo(meta.settlements.x[id] ?? 0, meta.settlements.y[id] ?? 0);
    void this.tapSettlement(id, true);
  }

  selectSettlement(id: number): void {
    void this.tapSettlement(id, true);
  }

  selectCiv(id: number): void {
    this.selectedCivId = id;
    this.shell.showPanel('civ');
  }

  setLayer(layer: LayerKind): void {
    this.onLayer(layer);
  }

  async save(): Promise<void> {
    await this.onSave();
  }

  async renameWorld(name: string): Promise<void> {
    if (!this.doc) return;
    this.doc = { ...this.doc, name };
    await this.db.putWorld({ ...this.doc, updatedAt: Date.now() });
    this.shell.setSummary(this.summary());
    await this.refreshWorlds(false);
  }

  async deleteWorld(): Promise<void> {
    if (!this.doc) return;
    const id = this.doc.id;
    await this.db.deleteWorld(id);
    this.unloadWorld();
    await this.refreshWorlds(true);
    this.shell.toast(t('toast.worldDeleted'));
  }

  async manageWorlds(): Promise<void> {
    this.pauseSimulation();
    await this.refreshWorlds(true);
  }

  applyLanguage(lang: Lang): void {
    this.onLanguage(lang);
  }

  notify(message: string): void {
    this.shell.toast(message);
  }

  selectedSettlement(): number | null {
    return this.selectedId;
  }

  selectedCiv(): number | null {
    return this.selectedCivId;
  }



  openEvent(id: number): void {
    this.shell.showEvent(id);
  }


  // ------------------------------------------------------------------ debug



  debugState(): { day: number; savedDay: number; bakeMs: number; layerMs: number; settlements: number; speed: number; world: boolean; zoom: number; selected: number | null; layer: LayerKind; panel: PanelTab | null } {
    return {
      day: this.lastDay,
      savedDay: this.lastSavedDay,
      bakeMs: this.lastBakeMs,
      layerMs: this.lastLayerMs,
      settlements: this.meta?.settlements.x.length ?? 0,
      speed: this.speed,
      world: this.meta !== null,
      zoom: this.renderer.cam.zoom,
      selected: this.selectedId,
      layer: this.layer,
      panel: this.shell.activePanel,
    };
  }

  probe(): { min: number; max: number; sum: number } {
    return this.renderer.probePixels();
  }

  async worldChecksum(): Promise<number> {
    const data = await this.client.query<WorldView>({ kind: 'world' });
    return data.checksum;
  }

  settlementScreen(id: number): { x: number; y: number } | null {
    const meta = this.meta;
    if (!meta || id < 0 || id >= meta.settlements.x.length) return null;
    const p = this.renderer.worldToScreen(
      ((meta.settlements.x[id] ?? 0) + 0.5) * TILE_PX,
      ((meta.settlements.y[id] ?? 0) + 0.5) * TILE_PX,
    );
    return { x: Math.round(p.x), y: Math.round(p.y) };
  }

  // --- test-facing helpers (the same queries the panels use)
  listWorlds(): WorldDoc[] {
    return [...this.worlds];
  }

  async debugLayer(layer: LayerKind, metric?: EcologyMetric): Promise<LayerData> {
    return this.client.query<LayerData>({ kind: 'layer', layer, metric });
  }

  layerProbe(): Record<string, number | string | boolean | null> {
    return this.renderer.layerProbe();
  }

  async debugOpenEvent(id: number): Promise<EventDetail | null> {
    return this.queryEvent(id);
  }

  async debugHistory(filter: HistoryFilter = {}): Promise<HistoryPage> {
    return this.queryHistory(filter, 0, 20);
  }

  async debugCommand(command: PlayerCommand): Promise<CommandResult> {
    return this.client.command(command);
  }

  showPanel(tab: PanelTab): void {
    this.shell.showPanel(tab);
  }

  /** Test/QA only: deterministic fast-forward through the real pipeline. */
  advanceDays(days: number): void {
    this.client.advance(days);
  }
}
