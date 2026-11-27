/**
 * The session facade: panel API, debug surface and creation entry point. All simulation and world
 * management live in the two base classes; this file only exposes them to the UI and tests.
 */
import type { CommandResult } from '../worker/client.ts';
import type { CampaignCommand, CampaignSummary } from '../worker/protocol.ts';
import type { CampaignView } from '../worker/queryCampaign.ts';
import type { EcologyMetric, HistoryFilter, LayerKind, PlayerCommand } from '../worker/protocol.ts';
import type { PanelApi, PanelTab } from '../ui/panels.ts';
import type { ChroniclePage, CivSummary, CivView, EconomyView, EcologyView, EventDetail, HistoryPage, InterventionInfo, LayerData, SettlementSummary, SettlementView, WorldView } from '../worker/queries.ts';
import { SessionWorlds } from './sessionWorlds.ts';
import { Shell } from '../ui/shell.ts';
import { Renderer, TILE_PX, type CampaignMarks } from '../render/app.ts';
import type { WorldDoc } from '../platform/storage.ts';
import { initLang, t, type Lang } from '../ui/i18n.ts';

export class Session extends SessionWorlds implements PanelApi {
  private disposed = false;
  private lastCampaignDay = -1;

  constructor(shell: Shell, renderer: Renderer) {
    super(shell, renderer);
    shell.attachPanels(this);
    if (this.debugEnabled) window.setInterval(() => this.renderDebug(), 500);
    window.setInterval(() => void this.autosave(), 60_000);
    window.setInterval(() => {
      if (this.shell.campaignOpen && this.lastDay !== this.lastCampaignDay) {
        this.lastCampaignDay = this.lastDay;
        void this.refreshCampaign();
      }
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
      onCampaignOpen: () => ref.session?.openCampaign(),
      onCampaignClose: () => shell.closeCampaign(),
      onCampaignCommand: (command) => void ref.session?.campaignCommand(command),
      onCampaignShowTarget: (target, kind) => ref.session?.showCampaignTarget(target, kind),
      onCampaignOpenCiv: (civ) => ref.session?.openCampaignCiv(civ),
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

  async queryCampaign(): Promise<CampaignView> {
    return this.client.query<CampaignView>({ kind: 'campaign' });
  }

  async refreshCampaign(open = false): Promise<void> {
    try {
      const view = await this.queryCampaign();
      this.shell.setCampaignView(view);
      this.renderer.setCampaignMarks(this.campaignMarksOf(view));
      if (open) this.shell.openCampaign();
    } catch {
      // A world switch during the query is not a player-facing error; the next tick retries.
    }
  }

  async campaignCommand(command: CampaignCommand): Promise<void> {
    await this.commandCampaign(command);
  }

  async commandCampaign(command: CampaignCommand): Promise<CommandResult> {
    this.shell.setCampaignBusy(true);
    try {
      const result = await this.client.campaign(command);
      if (!result.ok) {
        this.shell.toast(`${result.code}: ${result.message}`);
        return result;
      }
      this.shell.toast(t(`campaign.${command.op}.done`));
      await this.refreshCampaign(true);
      return result;
    } finally {
      this.shell.setCampaignBusy(false);
    }
  }

  override onCampaignMeta(summary: CampaignSummary | undefined): void {
    if (summary?.mode === 1) void this.refreshCampaign(summary.targetCiv === 255);
    else {
      this.shell.setCampaignSummary(undefined);
      this.renderer.setCampaignMarks(null);
    }
  }

  private campaignMarksOf(view: CampaignView): CampaignMarks | null {
    const meta = this.meta;
    if (!meta || view.mode !== 1 || view.targetCiv === 255) return null;
    const at = (settlement: number): { x: number; y: number } => ({
      x: meta.settlements.x[settlement] ?? 0,
      y: meta.settlements.y[settlement] ?? 0,
    });
    const capital = (civ: number): { x: number; y: number } => at(meta.civs.capital[civ] ?? 0);
    const objectives = view.objectives
      .filter((o) => o.state === 1 || o.state === 2)
      .slice(0, 4)
      .map((o) => {
        const settlement = o.kind === 2 || o.kind === 3 ? meta.civs.capital[o.target] ?? 0 : o.kind === 5 ? meta.civs.capital[view.targetCiv] ?? 0 : o.target;
        return { ...at(settlement), kind: o.kind };
      });
    const charters = view.charters.map((c) => ({ ...capital(c.civ), civ: c.civ }));
    return { steward: capital(view.targetCiv), objectives, charters };
  }

  openCampaign(): void {
    void this.refreshCampaign(true);
  }

  closeCampaign(): void {
    this.shell.closeCampaign();
  }

  openCampaignCiv(civ: number): void {
    this.shell.closeCampaign();
    this.selectCiv(civ);
  }

  showCampaignTarget(target: number, kind: number): void {
    this.shell.closeCampaign();
    if (kind === 2 || kind === 3) this.selectCiv(target);
    else if (kind === 5) this.selectCiv(this.meta?.campaign?.targetCiv ?? target);
    else this.focusSettlement(target);
  }

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

  setCamera(tileX: number, tileY: number, zoom: number): void {
    this.renderer.setCamera(tileX, tileY, zoom);
  }

  detailStats(): { entries: number; visible: number; zoom: number } {
    return this.renderer.detailStats();
  }

  detailImage(): string {
    return this.renderer.detailImage();
  }

  focusSettlement(id: number, zoom?: number): void {
    const meta = this.meta;
    if (!meta || id < 0 || id >= meta.settlements.x.length) return;
    this.renderer.flyTo(meta.settlements.x[id] ?? 0, meta.settlements.y[id] ?? 0, zoom);
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
