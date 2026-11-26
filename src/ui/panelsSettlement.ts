/** Settlement panel (Stage 5): one layer of the panel chain. */
import type { PanelTab } from './panels.ts';
import { PanelHostCore } from './panels.ts';
import { button, el, empty, kv, meter, num, pill, section, sparkline } from './dom.ts';
import { insight, linkButton, stat } from './panelKit.ts';
import { cohortLabel, fmtCompact, fmtNum, fmtPercent, infraLabel, resourceLabel, riskLabel, t, tierLabel } from './i18n.ts';

export class PanelHostSettlement extends PanelHostCore {
  protected override async renderPanel(tab: PanelTab): Promise<HTMLElement> {
    if (tab === 'settlement') return this.renderSettlement();
    return this.renderPanel2(tab);
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
    const sub = el('div', { class: 'hero-sub' });
    sub.append(el('span', { text: `${tierLabel(s.tier)} · ` }), linkButton(s.civName, () => this.api.selectCiv(s.civId)));
    head.append(sub);
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
    for (const risk of s.risks) riskRow.append(pill(riskLabel(risk.code), risk.severity >= 3 ? 'danger' : 'warn'));
    wrap.append(riskRow);

    const worst = s.risks.find((r) => r.severity >= 3) ?? s.risks[0];
    const trendText = s.trend.length >= 2
      ? `${s.trend[0]} → ${s.trend[s.trend.length - 1]}`.replace(/\d+/g, (n) => fmtNum(Number(n)))
      : t('common.noData');
    wrap.append(
      insight(
        t('panel.insight'),
        worst
          ? `${t(`risk.${worst.code}`)} · ${t('settlement.daysLeft')} ${fmtNum(s.daysOfFood)}`
          : `${t('panel.stable')} · ${t('settlement.daysLeft')} ${fmtNum(s.daysOfFood)}`,
        worst ? (worst.severity >= 3 ? 'danger' : 'warn') : 'neutral',
      ),
      el('p', { class: 'hint', text: `${t('panel.trend')}: ${trendText}` }),
    );

    wrap.append(
      el('div', { class: 'stat-grid' },
        stat(t('common.population'), num(s.pop)),
        stat(t('common.health'), num(s.health)),
        stat(t('common.stability'), num(s.stability)),
        stat(t('common.literacy'), num(s.literacy)),
        stat(t('common.treasury'), el('span', { dir: 'ltr', text: fmtCompact(s.treasury) })),
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

    wrap.append(
      section(t('panel.related'),
        el('div', { class: 'row' },
          button(t('settlement.openCiv'), () => this.api.selectCiv(s.civId)),
          button(t('nav.showOnMap'), () => this.api.focusSettlement(s.id)),
        ),
      ),
    );
    if (s.occupier > 0) wrap.append(pill(t('settlement.occupiedBy', { name: s.occupierName }), 'danger'));
    return wrap;
  }



}
