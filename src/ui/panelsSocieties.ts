/** Civilisation and economy panels (the first specialised layer). */
import type { PanelTab } from './panels.ts';
import { PanelHostSettlement } from './panelsSettlement.ts';
import { insight, stat } from './panelKit.ts';
import { bar, button, el, empty, kv, meter, num, pill, section, select, sparkline } from './dom.ts';
import { fmtCompact, fmtNum, isRtl, resourceLabel, t, treatyLabel, techLabel } from './i18n.ts';

export class PanelHostSocieties extends PanelHostSettlement {
  protected override async renderPanel2(tab: PanelTab): Promise<HTMLElement> {
    switch (tab) {
      case 'civ':
        return this.renderCiv();
      case 'economy':
        return this.renderEconomy();
      default:
        return this.renderPanel3(tab);
    }
  }


  // ------------------------------------------------------------------ civ

  protected async renderCiv(): Promise<HTMLElement> {
    const civs = await this.api.queryCivs();
    const selected = this.api.selectedCiv();
    const wrap = el('div', { class: 'panel-content' });
    const picker = section(t('civ.pick'));
    const options = civs.map((c) => ({ value: String(c.id), label: `${c.name} · ${fmtCompact(c.population)}` }));
    const current = selected === null ? (civs[0]?.id ?? 0) : selected;
    picker.append(select(options, String(current), (value) => {
      this.api.selectCiv(Number(value));
      void this.render();
    }));
    wrap.append(picker);
    if (civs.length === 0) {
      wrap.append(empty(t('civ.selectHint')));
      return wrap;
    }
    const [view, allSettlements] = await Promise.all([
      this.api.queryCiv(current),
      this.api.querySettlements(),
    ]);
    if (!view) {
      wrap.append(empty(t('civ.selectHint')));
      return wrap;
    }
    const head = el('div', { class: 'hero' });
    head.append(el('div', { class: 'hero-title', text: view.name }));
    head.append(el('div', { class: 'hero-sub', text: `${t('civ.capital')}: ${view.capitalName}` }));
    const actions = el('div', { class: 'hero-actions' });
    actions.append(button(t('nav.showOnMap'), () => this.api.focusSettlement(view.capital)));
    head.append(actions);
    wrap.append(head);

    const war = view.wars[0];
    wrap.append(
      insight(
        t('panel.insight'),
        war
          ? `${t('common.war')} · ${war.opponentName} · ${t('civ.warScore')} ${fmtNum(war.score)}`
          : `${t('common.peace')} · ${t('civ.legitimacy')} ${fmtNum(view.legitimacy)} · ${t('civ.army')} ${fmtNum(view.army)}`,
        war ? 'danger' : 'neutral',
      ),
    );

    wrap.append(
      el('div', { class: 'stat-grid' },
        stat(t('common.population'), num(view.population)),
        stat(t('common.settlements'), num(view.settlements)),
        stat(t('civ.legitimacy'), num(view.legitimacy)),
        stat(t('civ.army'), num(view.army)),
        stat(t('civ.exhaustion'), num(view.exhaustion)),
        stat(t('civ.treasury'), el('span', { dir: 'ltr', text: fmtCompact(view.treasury) })),
      ),
    );

    const culture = section(t('civ.culture'));
    const axes: ReadonlyArray<[string, number]> = [
      [t('civ.martial'), view.culture[0] ?? 0],
      [t('civ.isolation'), view.culture[1] ?? 0],
      [t('civ.scholarly'), view.culture[2] ?? 0],
    ];
    for (const [label, value] of axes) {
      const row = el('div', { class: 'axis' });
      row.append(el('span', { class: 'k', text: label }));
      const track = el('div', { class: 'axis-track' });
      const mark = el('i');
      mark.style.left = `${((value + 100) / 200) * 100}%`;
      track.append(mark);
      row.append(track);
      row.append(el('span', { class: 'v', dir: 'ltr', text: fmtNum(value) }));
      culture.append(row);
    }
    wrap.append(culture);

    const tech = section(t('civ.tech'));
    for (let i = 0; i < view.tech.length; i++) {
      const known = (view.tech[i] ?? 0) === 1;
      const progress = view.techProgress[i] ?? 0;
      const row = el('div', { class: `tech-row${known ? ' known' : ''}` });
      row.append(pill(known ? '✓' : `${Math.round(progress / 10)}%`, known ? 'good' : 'neutral'));
      row.append(el('span', { class: 'k', text: techLabel(i) }));
      if (!known && progress > 0) row.append(bar(progress, 1000));
      tech.append(row);
    }
    wrap.append(tech);

    const relations = section(t('civ.relations'));
    if (view.relations.length === 0) relations.append(empty(t('common.nothingHere')));
    for (const rel of view.relations) {
      const row = el('button', { class: 'list-row clickable', type: 'button' });
      row.addEventListener('click', () => this.api.selectCiv(rel.civ));
      row.append(el('span', { class: 'k', dir: 'auto', text: rel.name }));
      row.append(el('span', { class: `v ${rel.war ? 'danger' : ''}`, dir: 'ltr', text: `${fmtNum(rel.relation)} · ${fmtNum(rel.grievance)}` }));
      if (rel.treaty) row.append(pill(treatyLabel(view.treaties.find((x) => x.withCiv === rel.civ)?.type ?? 0), 'good'));
      if (rel.war) row.append(pill(t('common.war'), 'danger'));
      relations.append(row);
    }
    wrap.append(relations);

    const wars = section(t('civ.wars'));
    if (view.wars.length === 0) wars.append(empty(t('civ.noWars')));
    for (const war of view.wars) {
      const row = el('button', { class: 'list-row clickable', type: 'button' });
      row.append(el('span', { class: 'k', text: war.opponentName }));
      row.append(el('span', { class: 'v', dir: 'ltr', text: `${fmtNum(war.score)} · ${fmtNum(war.battles)}` }));
      row.addEventListener('click', () => this.api.selectCiv(war.opponent));
      wars.append(row, meter(t('civ.exhaustion'), war.exhaustSelf, 100));
    }
    wrap.append(wars);

    const gate = section(t('civ.gate'));
    if (view.gate) {
      gate.append(
        kv(t('civ.gateStrength'), el('span', { dir: 'ltr', text: `${fmtNum(view.gate.strength)}‰` })),
        kv(t('civ.gateGrievance'), num(view.gate.grievance)),
        kv(t('civ.gateCapacity'), num(view.gate.capacity)),
        kv(t('civ.gateUtility'), num(view.gate.utility)),
        pill(view.gate.pass ? t('civ.gatePass') : t('civ.gateFail'), view.gate.pass ? 'warn' : 'good'),
      );
    } else gate.append(empty(t('common.nothingHere')));
    wrap.append(gate);

    if (view.strengths.length > 0) {
      const strengths = section(t('civ.strengths'));
      const row = el('div', { class: 'pill-row' });
      for (const key of view.strengths) row.append(pill(t(`civ.strength.${key}`), 'good'));
      strengths.append(row);
      wrap.append(strengths);
    }
    if (view.weaknesses.length > 0) {
      const weaknesses = section(t('civ.weaknesses'));
      const row = el('div', { class: 'pill-row' });
      for (const key of view.weaknesses) row.append(pill(t(`civ.weakness.${key}`), 'danger'));
      weaknesses.append(row);
      wrap.append(weaknesses);
    }

    const milestones = section(t('civ.milestones'));
    if (view.milestones.length === 0) milestones.append(empty(t('common.nothingHere')));
    for (const event of view.milestones) milestones.append(this.eventRow(event));
    wrap.append(milestones);

    const settlements = allSettlements.rows.filter((row) => row.civId === view.id).slice(0, 8);
    if (settlements.length > 0) {
      const list = section(t('civ.settlementsList'));
      for (const row of settlements) {
        const item = el('button', { class: 'list-row clickable', type: 'button' });
        item.append(el('span', { class: 'k', text: row.name }), el('span', { class: 'v', dir: 'ltr', text: fmtCompact(row.pop) }));
        item.addEventListener('click', () => this.api.focusSettlement(row.id));
        list.append(item);
      }
      wrap.append(list);
    }

    const incite = button(t('influence.incite'), () => {
      this.active = 'influence';
      this.influence.op = 'incite';
      this.influence.incite.a = view.id;
      this.influence.incite.b = view.relations[0]?.civ ?? (view.id === 0 ? 1 : 0);
      this.renderTabs();
      void this.render();
    });
    wrap.append(incite);
    return wrap;
  }

  // ------------------------------------------------------------------ economy

  protected async renderEconomy(): Promise<HTMLElement> {
    const economy = await this.api.queryEconomy();
    const wrap = el('div', { class: 'panel-content' });
    wrap.append(el('div', { class: 'hero' }, el('div', { class: 'hero-title', text: t('economy.title') })));
    const worst = economy.shortages[0];
    wrap.append(
      insight(
        t('economy.worst'),
        worst ? `${worst.name} · ${resourceLabel(worst.resource)} · ${t('economy.daysShort', { n: fmtNum(worst.days) })}` : t('economy.noPressure'),
        worst ? 'danger' : 'neutral',
      ),
    );
    wrap.append(
      el('div', { class: 'stat-grid' },
        stat(t('common.population'), num(economy.population)),
        stat(t('common.treasury'), el('span', { dir: 'ltr', text: fmtCompact(economy.treasury) })),
        stat(t('economy.tradeVolume'), el('span', { dir: 'ltr', text: fmtCompact(economy.tradeVolume) })),
        stat(t('economy.tax'), el('span', { dir: 'ltr', text: fmtCompact(economy.taxCollected) })),
        stat(t('economy.produced'), el('span', { dir: 'ltr', text: fmtCompact(economy.foodProduced) })),
        stat(t('economy.consumed'), el('span', { dir: 'ltr', text: fmtCompact(economy.foodConsumed) })),
      ),
    );

    const series = section(t('economy.series'));
    series.append(
      sparkline(economy.series.map((p) => p.tradeVolume), { label: t('economy.tradeVolume'), color: '#6f8f8a', fill: 'rgba(111,143,138,0.12)' }),
      el('p', { class: 'hint', text: t('economy.seriesHint') }),
      sparkline(economy.series.map((p) => p.treasury), { label: t('economy.wealth'), color: '#c8a05a' }),
    );
    wrap.append(series);

    const table = section(t('settlement.resources'));
    const header = el('div', { class: 'list-row head' });
    header.append(
      el('span', { text: t('economy.resource') }),
      el('span', { text: t('economy.stock') }),
      el('span', { text: t('economy.avgPrice') }),
      el('span', { text: t('economy.scarcity') }),
    );
    table.append(header);
    for (const res of economy.resources) {
      const row = el('div', { class: 'list-row' });
      row.append(el('span', { class: 'k', text: resourceLabel(res.id) }));
      row.append(el('span', { class: 'v', dir: 'ltr', text: `${fmtCompact(res.stock)} / ${fmtCompact(res.cap)}` }));
      row.append(el('span', { class: 'v', dir: 'ltr', text: fmtNum(res.avgPrice) }));
      row.append(el('span', { class: 'v', dir: 'ltr', text: fmtNum(res.scarcity) }));
      table.append(row);
    }
    wrap.append(table);

    const shortages = section(t('economy.shortages'));
    if (economy.shortages.length === 0) shortages.append(pill(t('economy.noShortages'), 'good'));
    for (const shortage of economy.shortages.slice(0, 10)) {
      const row = el('div', { class: 'list-row' });
      row.append(el('span', { class: 'k', dir: 'auto', text: shortage.name }));
      row.append(el('span', { class: 'v', text: `${resourceLabel(shortage.resource)} · ${t('economy.daysShort', { n: fmtNum(shortage.days) })}` }));
      row.addEventListener('click', () => this.api.selectSettlement(shortage.settlement));
      shortages.append(row);
    }
    wrap.append(shortages);

    const routes = section(t('economy.routes'));
    if (economy.routes.length === 0) routes.append(empty(t('economy.noRoutes')));
    for (const route of economy.routes.slice(0, 12)) {
      const row = el('div', { class: 'route-row' });
      const names = el('div', { class: 'route-names' });
      names.append(el('span', { text: route.fromName }), el('span', { class: 'arrow', text: isRtl() ? '←' : '→' }), el('span', { text: route.toName }));
      row.append(names);
      row.append(el('span', { class: 'v', dir: 'ltr', text: `${fmtNum(route.volume)} · ${fmtNum(route.tariff)}‰ · ${fmtNum(route.length)}` }));
      routes.append(row);
    }
    wrap.append(routes);
    return wrap;
  }

}
