/**
 * DOM shell (Stage 4): top bar, bottom arc, layer picker, legend, panels, world selection, creation,
 * selection chip, toast and debug readout.
 *
 * The shell renders what it is told. It owns no simulation value; numbers arrive from `Session` or a
 * panel query. Layout is mobile-first and RTL-aware through logical properties in `styles.css`.
 */
import type { Speed } from '../worker/protocol.ts';
import { LAYER_KINDS, type LayerKind } from '../worker/protocol.ts';
import type { WorldDoc } from '../platform/storage.ts';
import type { PanelApi, PanelTab, SaveState } from './panels.ts';
import { PanelHost } from './panelsFull.ts';
import { CreationPanel, defaultCreateInput, type CreateInput } from './creation.ts';
import { WorldsScreen } from './worlds.ts';
import { button, el, empty } from './dom.ts';
import { icon, LAYER_ICONS } from './icons.ts';
import { fmtNum, lang, localDate, t, type Lang } from './i18n.ts';
import { renderLegend } from './legend.ts';

export type { CreateInput, PresetId } from './creation.ts';

export interface ShellHandlers {
  onCreate(input: CreateInput): void;
  onPreviewRequest(input: CreateInput): void;
  onSpeed(speed: Speed): void;
  onSave(): void;
  onLayer(layer: LayerKind): void;
  onOpenPanel(tab: PanelTab): void;
  onChipTap(): void;
  onBackToWorlds(): void;
  onWorldsOpen(id: string): void;
  onWorldsNew(): void;
  onWorldsRename(id: string, name: string): void;
  onWorldsDelete(id: string): void;
  onLanguage(lang: Lang): void;
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

type Sheet = 'layers' | 'speed' | null;

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
  private readonly chip: HTMLDivElement;
  private readonly chipName: HTMLElement;
  private readonly chipMeta: HTMLElement;
  private readonly sheet: HTMLDivElement;
  private readonly layerLegend: HTMLDivElement;
  private readonly creationHost: HTMLDivElement;
  private creation: CreationPanel | null = null;
  private creationLang: Lang = 'fa';
  private lastCreateInput: CreateInput = defaultCreateInput();
  private readonly worlds: WorldsScreen;
  private panels: PanelHost | null = null;
  private currentSpeed: Speed = 0;
  private toastTimer: number | null = null;
  private summary: WorldSummary | null = null;
  private chipOpen = false;
  private sheetOpen: Sheet = null;
  private activeLayer: LayerKind = 'terrain';
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
    this.topbar.append(this.iconButton('save', t('common.save'), () => this.handlers.onSave()));
    this.topbar.append(this.iconButton('menu', t('nav.menu'), () => this.handlers.onOpenPanel('world')));
    this.ui.append(this.topbar);

    this.ui.append(this.buildDock());

    this.chip = el('div', { class: 'chip', hidden: true });
    this.chipName = el('span', { class: 'name' });
    this.chipMeta = el('span', { class: 'meta' });
    this.chip.append(this.chipName, this.chipMeta);
    this.chip.addEventListener('click', () => this.handlers.onChipTap());
    this.ui.append(this.chip);

    this.layerLegend = el('div', { class: 'legend', hidden: true });
    this.ui.append(this.layerLegend);

    this.sheet = el('div', { class: 'sheet', role: 'dialog' });
    const handle = el('div', { class: 'sheet-handle' });
    this.sheet.append(handle, el('div', { class: 'sheet-body' }));
    this.ui.append(this.sheet);

    if (!existingToast) this.ui.append(this.toastEl);

    this.creationHost = el('div');
    this.ui.append(this.creationHost);

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
    this.attachVisible(false);
  }

  attachPanels(api: PanelApi): void {
    this.panels = new PanelHost(api);
    this.ui.append(this.panels.root);
  }

  // ------------------------------------------------------------------ structure

  private buildDock(): HTMLElement {
    const dock = el('div', { class: 'dock' });
    const layers = el('button', { class: 'dock-btn', type: 'button' });
    layers.dataset.labelKey = 'nav.layers';
    layers.append(icon('layers'), el('span', { class: 'dock-label', text: t('nav.layers') }));
    layers.addEventListener('click', () => this.openLayerSheet());
    dock.append(layers);

    const speed = el('div', { class: 'dock-slot', 'data-slot': 'speed' });
    dock.append(speed);

    const menu = el('button', { class: 'dock-btn', type: 'button' });
    menu.dataset.labelKey = 'nav.menu';
    menu.append(icon('menu'), el('span', { class: 'dock-label', text: t('nav.menu') }));
    menu.addEventListener('click', () => this.handlers.onOpenPanel('world'));
    dock.append(menu);
    return dock;
  }

  private iconButton(name: string, aria: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', { class: 'icon-btn', type: 'button', 'aria-label': aria, title: aria });
    b.append(icon(name));
    b.addEventListener('click', onClick);
    return b;
  }

  // ------------------------------------------------------------------ flow

  bootDone(): void {
    this.boot.classList.add('hidden');
  }

  get labels(): HTMLElement {
    return this.labelsHost;
  }

  private ensureCreation(): CreationPanel {
    const current = lang();
    if (!this.creation || this.creationLang !== current) {
      if (this.creation) this.creation.hide();
      this.creationHost.replaceChildren();
      this.creationLang = current;
      this.creation = new CreationPanel(
        {
          onCreate: (input) => {
            this.lastCreateInput = input;
            this.handlers.onCreate(input);
          },
          onPreviewRequest: (input) => this.handlers.onPreviewRequest(input),
          onBack: () => this.hideCreation(),
        },
        this.lastCreateInput,
      );
      this.creationHost.append(this.creation.root);
    }
    return this.creation;
  }

  showWorlds(docs: readonly WorldDoc[]): void {
    this.creation?.hide();
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
    this.ensureCreation().show(prefill);
    this.topbar.classList.add('hidden');
    this.layerLegend.hidden = true;
  }

  hideCreation(): void {
    this.creation?.hide();
    this.handlers.onBackToWorlds();
  }

  showWorld(summary: WorldSummary): void {
    this.summary = summary;
    this.worldNameEl.textContent = summary.name;
    this.creation?.hide();
    this.worlds.hide();
    this.topbar.classList.remove('hidden');
    this.attachVisible(true);
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
    this.creation?.setProgress(pct);
  }

  setSummary(summary: WorldSummary): void {
    this.summary = summary;
    this.worldNameEl.textContent = summary.name;
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
    return this.creation?.currentInput ?? { ...this.lastCreateInput };
  }

  // ------------------------------------------------------------------ chip

  showChip(name: string, meta: string): void {
    this.chipName.textContent = name;
    this.chipMeta.textContent = meta;
    this.chip.hidden = false;
    this.chipOpen = true;
  }

  hideChip(): void {
    this.chip.hidden = true;
    this.chipOpen = false;
  }

  get chipVisible(): boolean {
    return this.chipOpen;
  }

  // ------------------------------------------------------------------ sheets

  private setSheet(which: Sheet): void {
    this.sheetOpen = which;
    this.sheet.classList.toggle('open', which !== null);
  }

  closeSheet(): void {
    this.setSheet(null);
  }

  private openLayerSheet(): void {
    if (this.sheetOpen === 'layers') {
      this.setSheet(null);
      return;
    }
    const body = this.sheet.querySelector('.sheet-body');
    if (!body) return;
    body.replaceChildren(
      el('h2', { text: t('nav.layers') }),
      el('p', { class: 'sub', text: t('layer.active') }),
    );
    const list = el('div', { class: 'layer-list' });
    for (const layer of LAYER_KINDS) {
      const row = el('button', { class: `layer-row${this.activeLayer === layer ? ' active' : ''}`, type: 'button' });
      const glyph = el('span', { class: 'layer-glyph' });
      glyph.append(icon(LAYER_ICONS[layer] ?? 'map'));
      const text = el('span', { class: 'layer-text' });
      text.append(el('span', { class: 'layer-name', text: t(`layer.${layer}`) }), el('span', { class: 'layer-desc', text: t(`layer.${layer}.desc`) }));
      row.append(glyph, text);
      if (this.activeLayer === layer) row.append(el('span', { class: 'check', text: '✓' }));
      row.addEventListener('click', () => {
        this.handlers.onLayer(layer);
        this.setActiveLayer(layer);
        this.setSheet(null);
      });
      list.append(row);
    }
    body.append(list);
    const close = button(t('nav.close'), () => this.setSheet(null));
    close.classList.add('ghost');
    body.append(close);
    this.setSheet('layers');
  }

  setActiveLayer(layer: LayerKind): void {
    this.activeLayer = layer;
    renderLegend(this.layerLegend, layer);
  }

  get layer(): LayerKind {
    return this.activeLayer;
  }

  openSpeedSheet(): void {
    if (this.sheetOpen === 'speed') {
      this.setSheet(null);
      return;
    }
    const body = this.sheet.querySelector('.sheet-body');
    if (!body) return;
    body.replaceChildren(el('h2', { text: t('speed.title') }), el('p', { class: 'sub', text: t('speed.hint') }));
    const options: Array<[string, Speed]> = [
      [t('speed.0'), 0],
      [t('speed.1'), 1],
      [t('speed.2'), 2],
      [t('speed.4'), 4],
      [t('speed.8'), 8],
    ];
    for (const [label, value] of options) {
      const b = button(`${label}${this.currentSpeed === value ? ' •' : ''}`, () => {
        this.handlers.onSpeed(value);
        this.setSpeed(value);
        this.setSheet(null);
      }, { accent: this.currentSpeed === value });
      b.classList.add('wide');
      body.append(b);
    }
    this.setSheet('speed');
  }

  // ------------------------------------------------------------------ panels

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
      buttons[0].setAttribute('aria-label', t('common.save'));
      buttons[0].title = t('common.save');
    }
    if (buttons[1]) {
      buttons[1].setAttribute('aria-label', t('nav.menu'));
      buttons[1].title = t('nav.menu');
    }
    renderLegend(this.layerLegend, this.activeLayer);
    this.setDate(this.lastDay);
    this.setSaveState(this.lastSaveState);
    this.panels?.relabel();
    // the creation screen is rebuilt on its next open in the active language
    if (this.creation && this.creationLang !== lang()) {
      const open = this.creation.isOpen;
      const input = this.creation.currentInput;
      this.lastCreateInput = input;
      this.creation.hide();
      this.creation = null;
      if (open) this.showCreation(input);
    }
  }

  // ------------------------------------------------------------------ misc

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
    this.creation?.drawPreview(width, height, biome, elevation);
  }

  showPreview(): void {
    this.creation?.showPreview();
  }

  showCreationError(message: string): void {
    this.toast(message);
  }

  emptyWorldsNotice(): void {
    const body = this.worlds.root.querySelector('.worlds-list');
    if (body) body.replaceChildren(empty(t('worlds.empty')));
  }
}
