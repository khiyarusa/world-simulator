/**
 * DOM shell (Stage 4): top bar, bottom arc, layer picker, legend, panels, world selection, creation,
 * selection chip, toast and debug readout.
 *
 * The shell renders what it is told. It owns no simulation value; numbers arrive from `Session` or a
 * panel query. Layout is mobile-first and RTL-aware through logical properties in `styles.css`.
 */
import type { CampaignCommand, CampaignSummary, Speed } from '../worker/protocol.ts';
import type { CampaignView } from '../worker/queryCampaign.ts';
import type { EcologyMetric, LayerKind } from '../worker/protocol.ts';
import type { WorldDoc } from '../platform/storage.ts';
import type { PanelApi, PanelTab, SaveState } from './panels.ts';
import { PanelHost } from './panelsFull.ts';
import { type CreateInput } from './creation.ts';
import { CreationHost } from './creationHost.ts';
import { WorldsScreen } from './worlds.ts';
import { el, empty } from './dom.ts';
import { icon } from './icons.ts';
import { fmtNum, localDate, t, type Lang } from './i18n.ts';
import { renderLegend } from './legend.ts';
import { applyPrefs, DEFAULT_PREFS, loadPrefs, savePrefs, type UiPrefs } from './prefs.ts';
import { Sheets } from './sheets.ts';
import { buildDock } from './dock.ts';
import { MapChrome } from './mapChrome.ts';
import { Coach } from './coach.ts';
import { LegacyChrome } from './legacyChrome.ts';
import { SelectionChip } from './chip.ts';
export type { CreateInput, PresetId } from './creation.ts';
export interface ShellHandlers {
  onCreate(input: CreateInput): void;
  onPreviewRequest(input: CreateInput): void;
  onSpeed(speed: Speed): void;
  onSave(): void;
  onLayer(layer: LayerKind): void;
  onLayerMetric(metric: EcologyMetric): void;
  onOpenPanel(tab: PanelTab): void;
  onChipTap(): void;
  onBackToWorlds(): void;
  onWorldsOpen(id: string): void;
  onWorldsNew(): void;
  onWorldsRename(id: string, name: string): void;
  onWorldsDelete(id: string): void;
  onLanguage(lang: Lang): void;
  onPrefs(prefs: UiPrefs): void;
  onReplayOnboarding(): void;
  onCampaignOpen(): void;
  onCampaignClose(): void;
  onCampaignCommand(command: CampaignCommand): void;
  onCampaignShowTarget(target: number, kind: number): void;
  onCampaignOpenCiv(civ: number): void;
}
export interface WorldSummary {
  readonly name: string;
  readonly seedText: string;
  readonly preset: string;
  readonly day: number;
  readonly settlements: number;
  readonly civs: number;
  readonly population: number;
  readonly landFraction: number;
}
export class Shell {
  readonly labelsHost: HTMLElement;
  private readonly handlers: ShellHandlers;
  private readonly ui: HTMLElement;
  private readonly boot: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly debugEl: HTMLDivElement;
  private readonly topbar: HTMLDivElement;
  private readonly worldNameEl: HTMLElement;
  private readonly dateEl: HTMLElement;
  private readonly saveEl: HTMLElement;
  private readonly speedBtn: HTMLButtonElement;
  private readonly chip: SelectionChip;
  private readonly sheets: Sheets;
  private readonly chrome: MapChrome;
  private readonly coach: Coach;
  private readonly legacy: LegacyChrome;
  private prefs: UiPrefs = DEFAULT_PREFS;
  private readonly layerLegend: HTMLDivElement;
  private readonly creationUi: CreationHost;
  private readonly worlds: WorldsScreen;
  private panels: PanelHost | null = null;
  private currentSpeed: Speed = 0;
  private toastTimer: number | null = null;
  private summary: WorldSummary | null = null;
  private activeLayer: LayerKind = 'terrain';
  private layerMetric: EcologyMetric = 'fertility';
  private lastDay = 1;
  private lastSaveState: SaveState = { savedDay: 0, dirty: false, saving: false };
  constructor(handlers: ShellHandlers) {
    this.handlers = handlers;
    this.ui = el('div', { class: 'ui' });
    const host = document.getElementById('ui');
    if (host) host.replaceWith(this.ui);
    else document.body.append(this.ui);
    this.boot = document.getElementById('boot') ?? el('div', { class: 'boot' });
    const existingToast = document.getElementById('toast');
    this.toastEl = existingToast ?? el('div', { class: 'toast', id: 'toast', role: 'status', 'aria-live': 'polite' });
    this.labelsHost = document.getElementById('labels') ?? el('div', { class: 'labels' });
    this.debugEl = el('div', { class: 'debug', hidden: true });
    this.ui.append(this.debugEl);

    this.topbar = el('div', { class: 'topbar hidden' });
    const titles = el('div', { class: 'topbar-titles' });
    this.worldNameEl = el('div', { class: 'world-name', dir: 'auto' });
    this.dateEl = el('div', { class: 'date', dir: 'auto' });
    titles.append(this.worldNameEl, this.dateEl);
    this.saveEl = el('div', { class: 'save-state' });
    this.topbar.append(titles, el('div', { class: 'spacer' }), this.saveEl);
    this.saveEl.classList.add('clickable');
    this.saveEl.setAttribute('role', 'button');
    this.saveEl.setAttribute('tabindex', '0');
    this.saveEl.setAttribute('aria-label', t('common.saveNow'));
    this.saveEl.addEventListener('click', () => this.handlers.onSave());
    this.saveEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') this.handlers.onSave();
    });
    const settingsBtn = this.iconButton('settings', t('settings.title'), () => this.openSettingsSheet());
    settingsBtn.id = 'settings-btn';
    this.topbar.append(settingsBtn);
    const menuBtn = this.iconButton('menu', t('nav.menu'), () => this.handlers.onOpenPanel('world'));
    menuBtn.id = 'menu-btn';
    this.topbar.append(menuBtn);
    this.ui.append(this.topbar);

    this.legacy = new LegacyChrome({
      onOpen: () => this.handlers.onCampaignOpen(),
      onClose: () => this.handlers.onCampaignClose(),
      onCommand: (command) => this.handlers.onCampaignCommand(command),
      onShowTarget: (target, kind) => this.handlers.onCampaignShowTarget(target, kind),
      onOpenCiv: (civ) => this.handlers.onCampaignOpenCiv(civ),
    });
    this.topbar.insertBefore(this.legacy.button, this.topbar.querySelector('#settings-btn'));
    this.ui.append(this.legacy.strip, this.legacy.board.root);

    this.chrome = new MapChrome(this.ui);
    this.ui.append(buildDock(() => this.openLayerSheet(), () => this.handlers.onOpenPanel('world')));

    this.chip = new SelectionChip(() => this.handlers.onChipTap());
    this.ui.append(this.chip.root);

    this.layerLegend = el('div', { class: 'legend', hidden: true });
    this.ui.append(this.layerLegend);

    if (!existingToast) this.ui.append(this.toastEl);

    const creationHost = el('div');
    this.ui.append(creationHost);
    this.creationUi = new CreationHost(creationHost, handlers, () => this.hideCreation());

    this.worlds = new WorldsScreen({
      onOpen: (id) => this.handlers.onWorldsOpen(id),
      onNew: () => this.handlers.onWorldsNew(),
      onRename: (id, name) => this.handlers.onWorldsRename(id, name),
      onDelete: (id) => this.handlers.onWorldsDelete(id),
      onLanguage: (code) => this.handlers.onLanguage(code),
    });
    this.worlds.root.hidden = true;
    this.ui.append(this.worlds.root);

    this.speedBtn = el('button', {
      class: 'dock-btn speed',
      id: 'speed-btn',
      type: 'button',
      'aria-label': t('speed.title'),
    });
    this.speedBtn.append(icon('speed'), el('span', { class: 'dock-label', text: '❚❚' }));
    this.speedBtn.addEventListener('click', () => this.openSpeedSheet());
    const speedSlot = this.ui.querySelector('[data-slot="speed"]');
    if (speedSlot) speedSlot.replaceWith(this.speedBtn);
    this.prefs = loadPrefs();
    applyPrefs(this.prefs);
    this.coach = new Coach(this.ui, () => this.prefs, (next) => {
      this.prefs = next;
      applyPrefs(next);
      savePrefs(next);
    });
    this.sheets = new Sheets(this.ui, {
      onLayer: (layer) => {
        this.handlers.onLayer(layer);
        this.setActiveLayer(layer);
      },
      onLayerMetric: (metric) => {
        this.handlers.onLayerMetric(metric);
        this.setLayerMetric(metric);
      },
      onSpeed: (speed) => {
        this.handlers.onSpeed(speed);
        this.setSpeed(speed);
      },
      onPrefs: (next) => {
        this.prefs = next;
        applyPrefs(next);
        savePrefs(next);
        this.handlers.onPrefs(next);
        this.relabel();
      },
      onLanguage: (code) => {
        this.handlers.onLanguage(code);
        this.relabel();
      },
      onReplayOnboarding: () => {
        this.prefs = { ...this.prefs, onboarding: 0 };
        savePrefs(this.prefs);
        this.handlers.onReplayOnboarding();
      },
    });
    this.attachVisible(false);
  }

  attachPanels(api: PanelApi): void {
    this.panels = new PanelHost(api);
    this.ui.append(this.panels.root);
  }

  private iconButton(name: string, aria: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', { class: 'icon-btn', type: 'button', 'aria-label': aria, title: aria });
    b.append(icon(name));
    b.addEventListener('click', onClick);
    return b;
  }

  bootDone(): void {
    this.boot.classList.add('hidden');
  }

  get labels(): HTMLElement {
    return this.labelsHost;
  }

  showWorlds(docs: readonly WorldDoc[]): void {
    this.creationUi.hidePanelOnly();
    this.worlds.show(docs);
    this.topbar.classList.add('hidden');
    this.hideChip();
    this.attachVisible(false);
    this.layerLegend.hidden = true;
    this.bootDone();
  }

  hideWorlds(): void {
    this.worlds.hide();
  }

  showCreation(prefill?: Partial<CreateInput>): void {
    this.worlds.hide();
    this.creationUi.show(prefill);
    this.topbar.classList.add('hidden');
    this.layerLegend.hidden = true;
  }

  hideCreation(): void {
    this.creationUi.hide();
    this.handlers.onBackToWorlds();
  }

  showWorld(summary: WorldSummary): void {
    this.summary = summary;
    this.worldNameEl.textContent = summary.name;
    this.creationUi.hidePanelOnly();
    this.worlds.hide();
    this.topbar.classList.remove('hidden');
    this.attachVisible(true);
    this.setMapStats(summary);
    this.bootDone();
    this.setSpeed(this.currentSpeed);
  }

  private attachVisible(visible: boolean): void {
    const dock = this.ui.querySelector<HTMLElement>('.dock');
    if (dock) dock.hidden = !visible;
    const panel = this.panels?.root;
    if (panel && !visible) panel.classList.remove('open');
  }

  setProgress(pct: number): void {
    this.creationUi.setProgress(pct);
  }

  setSummary(summary: WorldSummary): void {
    this.summary = summary;
    this.worldNameEl.textContent = summary.name;
    this.setMapStats(summary);
  }

  setDate(day: number): void {
    this.lastDay = day;
    const d = localDate(day);
    this.dateEl.textContent = d.text;
  }

  setSpeed(speed: Speed): void {
    this.currentSpeed = speed;
    const label = this.speedBtn.querySelector('.dock-label');
    if (label) label.textContent = speed === 0 ? '❚❚' : `${fmtNum(speed)}×`;
    this.speedBtn.classList.toggle('paused', speed === 0);
  }

  setSaveState(state: SaveState): void {
    this.lastSaveState = state;
    this.saveEl.replaceChildren();
    const dot = el('span', { class: `dot ${state.saving ? 'busy' : state.dirty ? 'dirty' : 'clean'}` });
    const label = state.saving ? t('common.saving') : state.dirty ? t('common.unsaved') : t('common.saved');
    this.saveEl.append(dot, el('span', { text: label }));
    this.saveEl.title = t('world.lastSaved', { day: fmtNum(state.savedDay) });
  }

  get worldSummary(): WorldSummary | null {
    return this.summary;
  }

  get currentInput(): CreateInput {
    return this.creationUi.currentInput;
  }


  showChip(name: string, meta: string): void {
    this.chip.show(name, meta);
  }

  hideChip(): void {
    this.chip.hide();
  }

  get chipVisible(): boolean {
    return this.chip.visible;
  }


  closeSheet(): void {
    this.sheets.close();
  }

  private openLayerSheet(): void {
    this.sheets.openLayers(this.activeLayer, this.layerMetric);
  }

  setActiveLayer(layer: LayerKind): void {
    this.activeLayer = layer;
    this.chip.root.classList.toggle('with-legend', layer !== 'terrain');
    renderLegend(this.layerLegend, layer, this.layerMetric);
  }

  setLayerMetric(metric: EcologyMetric): void {
    this.layerMetric = metric;
    renderLegend(this.layerLegend, this.activeLayer, metric);
  }

  get layer(): LayerKind {
    return this.activeLayer;
  }

  openSpeedSheet(): void {
    this.sheets.openSpeed(this.currentSpeed);
  }


  setPrefs(prefs: UiPrefs): void {
    this.prefs = prefs;
    applyPrefs(prefs);
    this.relabel();
  }

  setMapStats(summary: WorldSummary): void {
    this.chrome.setStats({ population: summary.population, settlements: summary.settlements, civs: summary.civs });
  }

  setScale(km: number): void {
    this.chrome.setScale(km);
  }

  openSettingsSheet(): void {
    this.sheets.openSettings(this.prefs);
  }

  startOnboarding(): void {
    this.coach.start();
  }

  setCampaignSummary(summary: CampaignSummary | undefined): void {
    this.legacy.setSummary(summary);
  }

  setCampaignView(view: CampaignView | null): void {
    this.legacy.setView(view);
  }

  openCampaign(): void {
    this.legacy.open();
  }

  closeCampaign(): void {
    this.legacy.close();
  }

  setCampaignBusy(busy: boolean): void {
    this.legacy.setBusy(busy);
  }

  get campaignOpen(): boolean {
    return this.legacy.isOpen;
  }


  notifyInteraction(kind: 'settlement' | 'layer' | 'panel'): void {
    this.coach.notify(kind);
  }


  showPanel(tab?: PanelTab): void {
    this.panels?.show(tab);
  }

  showEvent(id: number): void {
    this.panels?.showEvent(id);
  }

  refreshPanels(): void {
    this.panels?.refresh();
  }

  selectionChanged(): void {
    this.panels?.setSelectionChanged();
  }

  closePanels(): void {
    this.panels?.hide();
  }

  get panelsOpen(): boolean {
    return this.panels?.isOpen ?? false;
  }

  get activePanel(): PanelTab | null {
    return this.panels?.activeTab ?? null;
  }

  /** Re-apply localised labels that are created once at boot (never a partial RTL switch). */
  relabel(): void {
    for (const node of this.ui.querySelectorAll<HTMLElement>('[data-label-key]')) {
      const key = node.dataset.labelKey ?? '';
      const label = node.querySelector('.dock-label');
      if (label && key) label.textContent = t(key);
    }
    this.speedBtn.setAttribute('aria-label', t('speed.title'));
    const buttons = this.ui.querySelectorAll<HTMLButtonElement>('.topbar .icon-btn');
    if (buttons[0]) {
      buttons[0].setAttribute('aria-label', t('settings.title'));
      buttons[0].title = t('settings.title');
    }
    if (buttons[1]) {
      buttons[1].setAttribute('aria-label', t('nav.menu'));
      buttons[1].title = t('nav.menu');
    }
    this.saveEl.setAttribute('aria-label', t('common.saveNow'));
    renderLegend(this.layerLegend, this.activeLayer, this.layerMetric);
    this.setDate(this.lastDay);
    this.setSaveState(this.lastSaveState);
    this.panels?.relabel();
  }


  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.classList.remove('show');
      this.toastTimer = null;
    }, 2800);
  }

  setDebug(text: string | null): void {
    if (text === null) {
      this.debugEl.hidden = true;
      return;
    }
    this.debugEl.hidden = false;
    this.debugEl.textContent = text;
  }

  drawPreview(width: number, height: number, biome: Uint8Array, elevation: Int16Array): void {
    this.creationUi.drawPreview(width, height, biome, elevation);
  }

  showPreview(): void {
    this.creationUi.showPreview();
  }

  showCreationError(message: string): void {
    this.toast(message);
  }

  emptyWorldsNotice(): void {
    const body = this.worlds.root.querySelector('.worlds-list');
    if (body) body.replaceChildren(empty(t('worlds.empty')));
  }
}
