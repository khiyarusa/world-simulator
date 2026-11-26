/**
 * The six player panels (Stage 4 WP4) and the Why?/chronicle interface (WP5).
 *
 * Every panel is a projection of a worker query. It holds only view state (which tab, which filter,
 * which page), never a second copy of the world. Commands are sent to the worker and their structured
 * result is what the panel reports; the UI never assumes success.
 */
import type { CommandResult } from '../worker/client.ts';
import type { HistoryFilter, LayerKind, PlayerCommand } from '../worker/protocol.ts';
import type {
  ChroniclePage,
  CivSummary,
  CivView,
  EconomyView,
  EcologyView,
  EventDetail,
  EventView,
  HistoryPage,
  InterventionInfo,
  SettlementSummary,
  SettlementView,
  WorldView,
} from '../worker/queries.ts';
import {
  button,
  el,
  empty,
  kv,
  meter,
  num,
  pill,
  raw,
  section,
  sparkline,
  tabs,
} from './dom.ts';
import { icon } from './icons.ts';
import { counterKey, stat } from './panelKit.ts';
import {
  cohortLabel,
  eventTypeLabel,
  fmtNum,
  fmtPercent,
  infraLabel,
  isRtl,
  resourceLabel,
  riskLabel,
  t,
  tierLabel,
  type Lang,
} from './i18n.ts';

export type PanelTab = 'world' | 'settlement' | 'civ' | 'economy' | 'history' | 'influence';const TAB_ORDER: readonly PanelTab[] = ['world', 'settlement', 'civ', 'economy', 'history', 'influence'];

export interface SaveState {
  readonly savedDay: number;
  readonly dirty: boolean;
  readonly saving: boolean;
}

export interface PanelApi {
  queryWorld(): Promise<WorldView>;
  querySettlement(id: number): Promise<SettlementView | null>;
  querySettlements(): Promise<{ total: number; offset: number; rows: SettlementSummary[] }>;
  queryCivs(): Promise<CivSummary[]>;
  queryCiv(id: number): Promise<CivView | null>;
  queryEconomy(civ?: number): Promise<EconomyView>;
  queryEcology(settlement?: number): Promise<EcologyView>;
  queryHistory(filter: HistoryFilter, offset: number, limit: number): Promise<HistoryPage>;
  queryEvent(id: number): Promise<EventDetail | null>;
  queryChronicle(fromYear: number | undefined, toYear: number | undefined, offset: number, limit: number): Promise<ChroniclePage>;
  queryInterventions(): Promise<InterventionInfo[]>;
  command(command: PlayerCommand): Promise<CommandResult>;
  focusSettlement(id: number): void;
  selectSettlement(id: number): void;
  selectCiv(id: number): void;
  setLayer(layer: LayerKind): void;
  save(): Promise<void>;
  renameWorld(name: string): Promise<void>;
  deleteWorld(): Promise<void>;
  manageWorlds(): void;
  applyLanguage(lang: Lang): void;
  notify(message: string): void;
  selectedSettlement(): number | null;
  selectedCiv(): number | null;
  saveState(): SaveState;
  openEvent(id: number): void;
}

export class PanelHostCore {
  readonly root: HTMLDivElement;
  protected readonly api: PanelApi;
  protected readonly body: HTMLDivElement;
  protected readonly title: HTMLElement;
  protected tabbar: HTMLElement;
  protected active: PanelTab = 'world';
  protected token = 0;
  protected open = false;
  protected eventId: number | null = null;
  protected historyMode: 'events' | 'chronicle' = 'events';
  protected historyFilter: HistoryFilter = {};
  protected historySearch = '';
  protected historyOffset = 0;
  protected historyEvents: EventView[] = [];
  protected historyTotal = 0;
  protected chronicleOffset = 0;
  protected chronicleEntries: ChroniclePage['entries'] = [];
  protected chronicleTotal = 0;
  protected readonly influence = {
    bless: { settlement: null as number | null, resource: 0, amount: 1 },
    blight: { settlement: null as number | null, intensity: 1, duration: 180 },
    fertilize: { settlement: null as number | null, intensity: 1 },
    incite: { a: 0, b: 1 },
    result: null as CommandResult | null,
    op: 'bless' as 'bless' | 'blight' | 'fertilize' | 'incite',
  };
  protected language: Lang = isRtl() ? 'fa' : 'en';
  protected worldNameForConfirm = '';

  constructor(api: PanelApi) {
    this.api = api;
    this.root = el('div', { class: 'panel', role: 'dialog', 'aria-modal': 'false' });
    const handle = el('div', { class: 'panel-handle' });
    const header = el('div', { class: 'panel-head' });
    this.title = el('h2', { text: t('nav.world') });
    const close = el('button', { class: 'icon-btn', type: 'button', 'aria-label': t('nav.close') });
    close.append(icon('close'));
    close.addEventListener('click', () => this.close());
    header.append(this.title, el('div', { class: 'spacer' }), close);
    this.tabbar = el('div', { class: 'tabbar', role: 'tablist' });
    this.body = el('div', { class: 'panel-body' });
    this.root.append(handle, header, this.tabbar, this.body);
  }

  get isOpen(): boolean {
    return this.open;
  }

  get activeTab(): PanelTab {
    return this.active;
  }

  show(tab?: PanelTab): void {
    if (tab) this.active = tab;
    this.open = true;
    this.root.classList.add('open');
    this.renderTabs();
    void this.render();
  }

  hide(): void {
    this.open = false;
    this.root.classList.remove('open');
  }

  close(): void {
    this.hide();
  }

  toggle(tab?: PanelTab): void {
    if (this.open && (!tab || tab === this.active)) this.hide();
    else this.show(tab);
  }

  /** Language changed: the tab strip and the title are localised too, not only the body. */
  relabel(): void {
    this.renderTabs();
    if (this.open) void this.render();
  }

  /** Re-read the active panel. Throttled by the session; safe to call often. */
  refresh(): void {
    if (!this.open) return;
    // the history feed owns its pagination; a background refresh must not append a second page
    if (this.active === 'history') return;
    void this.render();
  }

  showEvent(id: number): void {
    this.eventId = id;
    this.active = 'history';
    this.historyMode = 'events';
    this.open = true;
    this.root.classList.add('open');
    this.renderTabs();
    void this.render();
  }

  setSelectionChanged(): void {
    if (!this.open) return;
    if (this.active === 'settlement' || this.active === 'influence') void this.render();
  }

  protected renderTabs(): void {
    this.title.textContent = t(`nav.${this.active === 'civ' ? 'civ' : this.active}`);
    const items = TAB_ORDER.map((id) => ({ id, label: t(`nav.${id}`) }));
    const next = tabs(items, this.active, (id) => {
      this.active = id as PanelTab;
      this.eventId = null;
      this.historyOffset = 0;
      this.chronicleOffset = 0;
      this.renderTabs();
      void this.render();
    });
    this.tabbar.replaceWith(next);
    this.tabbar = next;
  }

  protected async renderTab(tab: PanelTab): Promise<HTMLElement> {
    switch (tab) {
      case 'world':
        return this.renderWorld();
      case 'settlement':
        return this.renderSettlement();
      default:
        return this.renderExtra(tab);
    }
  }

  /** Subclass hooks for the specialised panels, extended in two further layers. */
  protected async renderExtra(tab: PanelTab): Promise<HTMLElement> {
    return this.renderExtra2(tab);
  }

  protected async renderExtra2(_tab: PanelTab): Promise<HTMLElement> {
    return empty(t('common.noData'));
  }

  protected async renderExtra3(_tab: PanelTab): Promise<HTMLElement> {
    return empty(t('common.noData'));
  }

  protected async render(): Promise<void> {
    const mine = ++this.token;
    this.body.replaceChildren(el('p', { class: 'empty', text: t('common.loading') }));
    try {
      const content = await this.renderTab(this.active);
      if (mine !== this.token || !this.open) return;
      this.body.replaceChildren(content);
    } catch (e) {
      if (mine !== this.token) return;
      this.body.replaceChildren(el('p', { class: 'empty danger', text: (e as Error).message }));
    }
  }
  // ------------------------------------------------------------------ world

  private async renderWorld(): Promise<HTMLElement> {
    const world = await this.api.queryWorld();
    const save = this.api.saveState();
    this.worldNameForConfirm = world.seedText;
    const wrap = el('div', { class: 'panel-content' });

    const head = el('div', { class: 'hero' });
    head.append(el('div', { class: 'hero-title', text: t('world.title') }));
    head.append(el('div', { class: 'hero-sub', text: world.seedText }));
    wrap.append(head);

    wrap.append(
      el('div', { class: 'stat-grid' },
        stat(t('common.day'), num(world.day)),
        stat(t('common.year'), num(world.year)),
        stat(t('common.population'), num(world.population)),
        stat(t('common.settlements'), num(world.livingSettlements)),
        stat(t('common.civs'), num(world.civs)),
        stat(t('world.land'), el('span', { dir: 'ltr', text: fmtPercent(world.landFraction) })),
      ),
    );

    wrap.append(
      section(t('world.series'),
        el('h4', { text: t('world.populationSeries') }),
        sparkline(world.series.map((p) => p.population), { label: t('world.populationSeries'), color: '#c8a05a' }),
        el('h4', { text: t('world.treasurySeries') }),
        sparkline(world.series.map((p) => p.treasury), { label: t('world.treasurySeries'), color: '#6f8f8a', fill: 'rgba(111,143,138,0.12)' }),
        el('p', { class: 'hint', text: t('world.seriesHint') }),
      ),
    );

    const saveBox = section(t('world.saveStatus'));
    if (save.saving) saveBox.append(el('p', { class: 'hint', text: t('common.saving') }));
    else if (save.dirty) saveBox.append(pill(t('common.unsaved'), 'warn'));
    else saveBox.append(pill(t('common.saved'), 'good'));
    saveBox.append(el('p', { class: 'hint', text: t('world.lastSaved', { day: fmtNum(save.savedDay) }) }));
    saveBox.append(el('p', { class: 'hint', text: t('world.autosave') }));
    const saveRow = el('div', { class: 'row' });
    saveRow.append(button(t('common.saveNow'), () => void this.api.save(), { accent: true }));
    saveRow.append(button(t('world.manage'), () => this.api.manageWorlds()));
    saveBox.append(saveRow);
    wrap.append(saveBox);

    const info = section(t('world.title'));
    info.append(
      kv(t('world.seed'), raw(world.seedText)),
      kv(t('world.preset'), t(`world.preset.${world.preset}`)),
      kv(t('create.water'), `${world.recipe.water}%`),
      kv(t('create.harshness'), `${world.recipe.harshness}%`),
      kv(t('create.peoples'), num(world.recipe.peoples)),
      kv(t('world.checksum'), el('span', { dir: 'ltr', class: 'mono', text: world.checksum.toString(16).padStart(8, '0') })),
      kv(t('common.settlements'), `${fmtNum(world.livingSettlements)} / ${fmtNum(world.settlements)}`),
      kv(t('common.ruined'), num(world.ruinedSettlements)),
    );
    wrap.append(info);

    const counters = section(t('world.counters'));
    const counterGrid = el('div', { class: 'stat-grid compact' });
    const interesting: ReadonlyArray<[string, number]> = [
      ['births', world.counters.births ?? 0],
      ['deaths', world.counters.deaths ?? 0],
      ['migrants', world.counters.migrants ?? 0],
      ['warsDeclared', world.counters.warsDeclared ?? 0],
      ['techDiscovered', world.counters.techDiscovered ?? 0],
      ['tradeVolume', world.counters.tradeVolume ?? 0],
    ];
    for (const [key, value] of interesting) {
      counterGrid.append(stat(counterKey(key), num(value)));
    }
    counters.append(counterGrid);
    wrap.append(counters);

    const langBox = section(t('common.language'));
    const langRow = el('div', { class: 'seg' });
    for (const code of ['fa', 'en'] as const) {
      const b = button(code === 'fa' ? t('common.persian') : t('common.english'), () => {
        this.language = code;
        this.api.applyLanguage(code);
        void this.render();
      }, { accent: this.language === code });
      langRow.append(b);
    }
    langBox.append(langRow);
    wrap.append(langBox);

    const actions = el('div', { class: 'row' });
    actions.append(button(t('world.rename'), () => void this.renameWorld(), {}));
    actions.append(button(t('world.delete'), () => void this.deleteWorld(), { danger: true }));
    wrap.append(actions);
    return wrap;
  }

  private async renameWorld(): Promise<void> {
    const name = window.prompt(t('world.renamePrompt'), '');
    if (name === null) return;
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    await this.api.renameWorld(trimmed);
    this.api.notify(t('toast.worldRenamed'));
    void this.render();
  }

  private async deleteWorld(): Promise<void> {
    if (!window.confirm(t('world.deleteConfirm', { name: this.worldNameForConfirm }))) return;
    await this.api.deleteWorld();
  }
  // ------------------------------------------------------------------ settlement

  private async renderSettlement(): Promise<HTMLElement> {
    const id = this.api.selectedSettlement();
    if (id === null) return empty(t('settlement.selectHint'));
    const s = await this.api.querySettlement(id);
    if (!s) return empty(t('settlement.selectHint'));
    const ecology = await this.api.queryEcology(id);
    const wrap = el('div', { class: 'panel-content' });

    const head = el('div', { class: 'hero' });
    head.append(el('div', { class: 'hero-title', text: s.name }));
    head.append(el('div', { class: 'hero-sub', text: `${tierLabel(s.tier)} · ${s.civName}` }));
    const actions = el('div', { class: 'hero-actions' });
    actions.append(button(t('nav.showOnMap'), () => this.api.focusSettlement(s.id)));
    actions.append(button(t('settlement.bless'), () => {
      this.active = 'influence';
      this.influence.op = 'bless';
      this.influence.bless.settlement = s.id;
      this.renderTabs();
      void this.render();
    }));
    head.append(actions);
    wrap.append(head);

    const riskRow = el('div', { class: 'pill-row' });
    if (!s.alive) riskRow.append(pill(t('risk.ruined'), 'danger'));
    if (s.risks.length === 0) riskRow.append(pill(t('settlement.noRisks'), 'good'));
    for (const risk of s.risks) {
      riskRow.append(pill(riskLabel(risk.code), risk.severity >= 3 ? 'danger' : 'warn'));
    }
    wrap.append(riskRow);

    wrap.append(
      el('div', { class: 'stat-grid' },
        stat(t('common.population'), num(s.pop)),
        stat(t('common.health'), num(s.health)),
        stat(t('common.stability'), num(s.stability)),
        stat(t('common.literacy'), num(s.literacy)),
        stat(t('common.treasury'), num(s.treasury)),
        stat(t('settlement.daysLeft'), num(s.daysOfFood)),
      ),
    );

    wrap.append(
      section(t('settlement.trend'),
        sparkline(s.trend, { label: t('settlement.trend'), color: '#6f8f8a', fill: 'rgba(111,143,138,0.12)' }),
        el('p', { class: 'hint', text: t('settlement.trendHint') }),
      ),
    );

    const people = section(t('settlement.cohorts'));
    const total = Math.max(1, s.pop);
    for (let c = 0; c < s.cohorts.length; c++) {
      people.append(meter(cohortLabel(c), s.cohorts[c] ?? 0, total, `${fmtNum(s.cohorts[c] ?? 0)} · ${fmtPercent(((s.cohorts[c] ?? 0) * 1000) / total)}`));
    }
    const occ = el('div', { class: 'pill-row' });
    for (let k = 0; k < s.occShare.length; k++) {
      const names = ['cohort.farmers', 'cohort.extractors', 'cohort.crafters', 'cohort.traders', 'cohort.soldiers'];
      occ.append(pill(`${t(names[k]!)} ${fmtPercent(s.occShare[k] ?? 0)}`));
    }
    people.append(el('h4', { text: t('settlement.occupations') }), occ);
    wrap.append(people);

    const resources = section(t('settlement.resources'));
    for (let r = 0; r < s.stock.length; r++) {
      const stock = s.stock[r] ?? 0;
      const cap = Math.max(1, s.cap[r] ?? 0);
      resources.append(
        meter(
          `${resourceLabel(r)} · ${t('settlement.price')} ${fmtNum(s.price[r] ?? 0)}`,
          stock,
          cap,
          `${fmtNum(stock)} / ${fmtNum(cap)}`,
        ),
      );
      if (r === 0 || r === 1) {
        const days = r === 0 ? s.daysOfFood : s.daysOfWater;
        resources.append(el('p', { class: `hint${days < 10 ? ' danger' : ''}`, text: `${t('settlement.daysLeft')}: ${fmtNum(days)}` }));
      }
    }
    wrap.append(resources);

    const infra = section(t('settlement.infrastructure'));
    if (s.infraNames.length === 0) infra.append(empty(t('settlement.noInfrastructure')));
    else {
      const row = el('div', { class: 'pill-row' });
      for (const name of s.infraNames) {
        const index = ['granary', 'well', 'irrigation', 'walls', 'market', 'workshop', 'road', 'temple', 'academy', 'aqueduct', 'barracks', 'harbour'].indexOf(name);
        row.append(pill(index >= 0 ? infraLabel(index) : name, 'accent'));
      }
      infra.append(row);
    }
    wrap.append(infra);

    const routes = section(t('settlement.routes'));
    if (s.routes.length === 0) routes.append(empty(t('settlement.noRoutes')));
    for (const route of s.routes.slice(0, 6)) {
      const other = route.from === s.id ? route.toName : route.fromName;
      const row = el('div', { class: 'list-row' });
      row.append(el('span', { class: 'k', text: other }));
      row.append(el('span', { class: 'v', dir: 'ltr', text: `${fmtNum(route.volume)} · ${fmtNum(route.tariff)}‰` }));
      routes.append(row);
    }
    wrap.append(routes);

    const eco = section(t('settlement.ecology'));
    eco.append(
      meter(t('common.fertility'), s.fertility, 255),
      meter(t('common.vegetation'), s.vegetation, 255),
      meter(t('common.moisture'), s.moisture, 255),
      kv(t('common.temperature'), `${fmtNum(s.temperature)}°C`),
      kv(t('settlement.biome'), s.biomeName),
      kv(t('settlement.region'), num(s.region)),
      kv(t('settlement.founded'), `${t('common.day')} ${fmtNum(s.foundedDay)}`),
      kv(t('settlement.position'), el('span', { dir: 'ltr', text: `${s.x}, ${s.y}` })),
    );
    if (ecology.local) {
      if (ecology.local.drought) eco.append(pill(t('risk.drought'), 'warn'));
      if (ecology.local.blight) eco.append(pill(t('risk.blight'), 'danger'));
    }
    wrap.append(eco);

    const recent = section(t('settlement.recent'));
    if (s.recentEvents.length === 0) recent.append(empty(t('common.nothingHere')));
    for (const event of s.recentEvents) recent.append(this.eventRow(event));
    wrap.append(recent);

    if (s.occupier > 0) wrap.append(pill(t('settlement.occupiedBy', { name: s.occupierName }), 'danger'));
    return wrap;
  }


  protected eventRow(event: EventView): HTMLElement {
    const row = el('button', { class: `event-row${event.player ? ' player' : ''}`, type: 'button' });
    const dot = el('span', { class: `dot sev${event.severity}` });
    const body = el('span', { class: 'event-body' });
    body.append(el('span', { class: 'event-title', text: eventTypeLabel(event.typeName) }));
    body.append(el('span', { class: 'event-meta', text: `${t('common.year')} ${fmtNum(event.year)} · ${event.placeName}` }));
    row.append(dot, body);
    if (event.player) row.append(pill(t('common.player'), 'accent'));
    row.addEventListener('click', () => this.api.openEvent(event.id));
    return row;
  }

}
