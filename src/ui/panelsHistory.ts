/** History, causality and chronicle panel (second specialised layer). */
import type { CivSummary, EventDetail, SettlementSummary } from '../worker/queries.ts';
import type { PanelTab } from './panels.ts';
import { PanelHostSocieties } from './panelsSocieties.ts';
import { button, el, empty, num, pill, raw, section, select, sparkline } from './dom.ts';
import { eventTypeLabel, fmtCompact, fmtNum, isRtl, t } from './i18n.ts';
import { stat } from './panelKit.ts';

export class PanelHostHistory extends PanelHostSocieties {
  protected override async renderPanel3(tab: PanelTab): Promise<HTMLElement> {
    if (tab === 'history') return this.renderHistory();
    return this.renderPanel4(tab);
  }

  // ------------------------------------------------------------------ history

  protected async renderHistory(): Promise<HTMLElement> {
    const wrap = el('div', { class: 'panel-content' });
    const mode = el('div', { class: 'seg' });
    mode.append(
      button(t('history.events'), () => {
        this.historyMode = 'events';
        this.eventId = null;
        this.historyOffset = 0;
        void this.render();
      }, { accent: this.historyMode === 'events' }),
      button(t('history.chronicle'), () => {
        this.historyMode = 'chronicle';
        this.eventId = null;
        this.chronicleOffset = 0;
        void this.render();
      }, { accent: this.historyMode === 'chronicle' }),
    );
    wrap.append(mode);

    if (this.eventId !== null) {
      const detail = await this.api.queryEvent(this.eventId);
      if (!detail) {
        wrap.append(empty(t('toast.eventNotFound')));
        return wrap;
      }
      wrap.append(this.renderEventDetail(detail));
      return wrap;
    }
    if (this.historyMode === 'chronicle') return this.renderChronicle(wrap);
    return this.renderEventList(wrap);
  }

  protected async renderEventList(wrap: HTMLElement): Promise<HTMLElement> {
    const page = await this.api.queryHistory(this.historyFilter, this.historyOffset, 50);
    const [settlements, civs] = await Promise.all([this.api.querySettlements(), this.api.queryCivs()]);
    this.historyEvents = this.historyEvents.length > 0 && this.historyOffset > 0 ? [...this.historyEvents, ...page.events] : [...page.events];
    this.historyTotal = page.total;

    const cats = el('div', { class: 'chip-row' });
    const currentCat = (this.historyFilter.types?.length ?? 0) > 0 ? 'custom' : this.historyCategory();
    for (const id of ['all', 'war', 'disaster', 'migration', 'politics', 'economy', 'player'] as const) {
      const b = el('button', { class: `chip-btn${currentCat === id ? ' active' : ''}`, type: 'button' }, t(`history.category.${id}`));
      b.addEventListener('click', () => {
        this.historyOffset = 0;
        this.historyEvents = [];
        this.historyFilter = id === 'all' ? {} : { ...this.historyFilter, types: categoryTypes(id) };
        void this.render();
      });
      cats.append(b);
    }
    wrap.append(cats);

    const search = el('input', {
      class: 'input search',
      type: 'search',
      placeholder: t('history.searchPlaceholder'),
      value: this.historySearch,
    });
    search.addEventListener('input', () => {
      this.historySearch = search.value;
    });
    search.addEventListener('change', () => {
      this.historyOffset = 0;
      this.historyEvents = [];
      this.historyFilter = { ...this.historyFilter, search: this.historySearch || undefined };
      void this.render();
    });
    wrap.append(search);

    const filters = el('div', { class: 'filter-row' });
    const sev = select(
      [
        { value: '0', label: `${t('history.severity')}: ${t('common.all')}` },
        { value: '2', label: '≥ 2' },
        { value: '3', label: '≥ 3' },
        { value: '4', label: '≥ 4' },
        { value: '5', label: '5' },
      ],
      String(this.historyFilter.minSeverity ?? 0),
      (value) => {
        this.historyOffset = 0;
        this.historyEvents = [];
        this.historyFilter = { ...this.historyFilter, minSeverity: Number(value) || undefined };
        void this.render();
      },
    );
    filters.append(sev);
    for (const key of ['fromDay', 'toDay'] as const) {
      const year = this.historyFilter[key] === undefined ? '' : String(Math.floor(((this.historyFilter[key] ?? 1) - 1) / 360) + 1);
      const fieldEl = el('input', {
        class: 'input year',
        type: 'number',
        min: 1,
        placeholder: key === 'fromDay' ? t('history.yearFrom') : t('history.yearTo'),
        value: year,
      });
      fieldEl.addEventListener('change', () => {
        const value = Number(fieldEl.value);
        this.historyOffset = 0;
        this.historyEvents = [];
        this.historyFilter = {
          ...this.historyFilter,
          [key]: Number.isFinite(value) && value >= 1 ? (value - 1) * 360 + (key === 'fromDay' ? 1 : 360) : undefined,
        };
        void this.render();
      });
      filters.append(fieldEl);
    }
    const placeSelect = select(
      [{ value: '', label: t('history.allSettlements') }, ...settlements.rows.map((s: SettlementSummary) => ({ value: String(s.id), label: s.name }))],
      this.historyFilter.place === undefined ? '' : String(this.historyFilter.place),
      (value) => {
        this.historyOffset = 0;
        this.historyEvents = [];
        this.historyFilter = { ...this.historyFilter, place: value === '' ? undefined : Number(value) };
        void this.render();
      },
    );
    filters.append(placeSelect);
    const civSelect = select(
      [{ value: '', label: t('history.allCivs') }, ...civs.map((c: CivSummary) => ({ value: String(c.id), label: c.name }))],
      this.historyFilter.civ === undefined ? '' : String(this.historyFilter.civ),
      (value) => {
        this.historyOffset = 0;
        this.historyEvents = [];
        this.historyFilter = { ...this.historyFilter, civ: value === '' ? undefined : Number(value) };
        void this.render();
      },
    );
    filters.append(civSelect);
    const playerOnly = el('label', { class: 'check' });
    const check = el('input', { type: 'checkbox' });
    check.checked = this.historyFilter.playerOnly === true;
    check.addEventListener('change', () => {
      this.historyOffset = 0;
      this.historyEvents = [];
      this.historyFilter = { ...this.historyFilter, playerOnly: check.checked || undefined };
      void this.render();
    });
    playerOnly.append(check, el('span', { text: t('history.playerOnly') }));
    filters.append(playerOnly);
    wrap.append(filters);

    wrap.append(el('p', { class: 'hint', text: t('history.eventsCount', { n: fmtNum(page.total) }) }));
    if (this.historyEvents.length === 0) wrap.append(empty(t('history.noEvents')));
    for (const event of this.historyEvents) wrap.append(this.eventRow(event));
    if (this.historyOffset + this.historyEvents.length < this.historyTotal) {
      wrap.append(button(t('history.loadMore'), () => {
        this.historyOffset += 50;
        void this.render();
      }));
    }
    return wrap;
  }

  protected historyCategory(): string {
    const types = this.historyFilter.types;
    if (!types || types.length === 0) return 'all';
    for (const id of ['war', 'disaster', 'migration', 'politics', 'economy', 'player'] as const) {
      const set = categoryTypes(id);
      if (set.length === types.length && set.every((v) => types.includes(v))) return id;
    }
    return 'custom';
  }

  protected renderEventDetail(detail: EventDetail): HTMLElement {
    const wrap = el('div', { class: 'event-detail' });
    const back = button(isRtl() ? '→' : '←', () => {
      this.eventId = null;
      void this.render();
    }, {});
    back.classList.add('back', 'ghost');
    wrap.append(back);
    const e = detail.event;
    wrap.append(el('h3', { text: eventTypeLabel(e.typeName) }));
    wrap.append(el('p', { class: 'hero-sub', text: `${t('history.year')} ${fmtNum(e.year)} · ${t('common.day')} ${fmtNum(e.day)}` }));
    const grid = el('div', { class: 'stat-grid compact' });
    grid.append(
      stat(t('history.severityLabel'), num(e.severity)),
      stat(t('history.place'), raw(e.placeName)),
      stat(t('history.actors'), raw(`${e.actorAName}${e.actorB !== e.actorA ? ` · ${e.actorBName}` : ''}`)),
      stat(t('history.magnitude'), num(e.magnitude)),
    );
    wrap.append(grid);
    const links = el('div', { class: 'row' });
    if (e.place >= 0) links.append(button(t('history.showOnMap'), () => this.api.focusSettlement(e.place)));
    if (e.actorAName !== '—') links.append(button(`${t('history.openCiv')}: ${e.actorAName}`, () => this.api.selectCiv(e.actorA)));
    if (e.actorB !== e.actorA && e.actorBName !== '—') links.append(button(`${t('history.openCiv')}: ${e.actorBName}`, () => this.api.selectCiv(e.actorB)));
    if (links.childElementCount > 0) wrap.append(links);
    if (e.player) wrap.append(pill(t('history.playerCause'), 'accent'));

    const causes = section(t('history.causes'));
    if (detail.chain.length <= 1) {
      causes.append(el('p', { class: 'hint', text: detail.root.kind === 'player' ? t('history.playerCause') : t('history.rootExplanation') }));
    } else {
      const chain = el('div', { class: 'chain' });
      for (const link of detail.chain) {
        const row = el('button', { class: 'chain-link', type: 'button' });
        row.append(el('span', { class: `dot sev${link.severity}` }), el('span', { text: eventTypeLabel(link.typeName) }), el('span', { class: 'hint', text: `${fmtNum(link.year)}` }));
        row.addEventListener('click', () => this.api.openEvent(link.id));
        chain.append(row);
      }
      causes.append(chain);
    }
    wrap.append(causes);

    const consequences = section(t('history.consequences'));
    if (detail.consequences.length === 0) consequences.append(empty(t('history.noConsequences')));
    for (const child of detail.consequences) consequences.append(this.eventRow(child));
    wrap.append(consequences);

    const root = section(t('history.rootCause'));
    const rootText =
      detail.root.kind === 'player'
        ? t('history.playerCause')
        : detail.root.kind === 'root'
          ? t('history.rootExplanation')
          : t('history.parentEvent', { id: fmtNum(e.cause) });
    root.append(el('p', { text: rootText }));
    wrap.append(root);
    return wrap;
  }

  protected async renderChronicle(wrap: HTMLElement): Promise<HTMLElement> {
    const page = await this.api.queryChronicle(undefined, undefined, this.chronicleOffset, 40);
    this.chronicleEntries = this.chronicleOffset > 0 ? [...this.chronicleEntries, ...page.entries] : page.entries;
    this.chronicleTotal = page.total;
    wrap.append(
      sparkline(page.series.map((p) => p.population), { label: t('world.populationSeries'), color: '#c8a05a' }),
      el('p', { class: 'hint', text: t('history.chronicleHint') }),
    );
    let lastYear = -1;
    for (const entry of this.chronicleEntries) {
      if (entry.year !== lastYear) {
        wrap.append(el('h3', { class: 'year-head', text: `${t('common.year')} ${fmtNum(entry.year)}` }));
        lastYear = entry.year;
      }
      const row = el('div', { class: 'chronicle-row' });
      row.append(el('span', { class: 'k', dir: 'auto', text: entry.civName }));
      row.append(el('span', { class: 'v', dir: 'ltr', text: `${fmtCompact(entry.population)} · ${fmtNum(entry.settlements)}` }));
      if (entry.notableEvents > 0) row.append(pill(t('history.notable', { n: fmtNum(entry.notableEvents) }), 'warn'));
      wrap.append(row);
    }
    if (this.chronicleEntries.length === 0) wrap.append(empty(t('common.noData')));
    if (this.chronicleOffset + this.chronicleEntries.length < this.chronicleTotal) {
      wrap.append(button(t('history.loadMore'), () => {
        this.chronicleOffset += 40;
        void this.render();
      }));
    }
    return wrap;
  }


}

function categoryTypes(id: string): number[] {
  // numeric EVENT_TYPE values are part of the persisted format (society/state.ts)
  switch (id) {
    case 'war':
      return [13, 14, 15];
    case 'disaster':
      return [3, 4, 5, 6, 7, 18, 24];
    case 'migration':
      return [9];
    case 'politics':
      return [0, 1, 2, 12, 17, 21, 22];
    case 'economy':
      return [8, 10, 11, 16, 19, 20, 23];
    case 'player':
      return [24, 25, 26, 27];
    default:
      return [];
  }
}


