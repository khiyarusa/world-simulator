/** Atlas plate, compass and scale: deliberate map composition in the letterbox space. */
import { el } from './dom.ts';
import { fmtNum, t } from './i18n.ts';

export interface MapStats {
  readonly population: number;
  readonly settlements: number;
  readonly civs: number;
}

export class MapChrome {
  readonly root: HTMLDivElement;
  private stats: MapStats = { population: 0, settlements: 0, civs: 0 };
  private km = 0;

  constructor(parent: HTMLElement) {
    this.root = el('div', { class: 'map-chrome', 'aria-hidden': 'true' });
    parent.append(this.root);
    this.render();
  }

  setStats(stats: MapStats): void {
    this.stats = stats;
    this.render();
  }

  setScale(km: number): void {
    this.km = km;
    const label = this.root.querySelector<HTMLElement>('.map-scale span');
    if (label) label.textContent = km > 0 ? `${t('map.scale')} ≈ ${fmtNum(km)} km` : t('map.scale');
  }

  render(): void {
    this.root.replaceChildren(
      el('div', { class: 'atlas-plate' },
        el('span', { class: 'plate-kicker', text: t('app.tagline') }),
        el('div', { class: 'plate-stats' },
          el('span', {}, el('strong', { text: fmtNum(this.stats.population) }), ` ${t('map.population')}`),
          el('span', {}, el('strong', { text: fmtNum(this.stats.settlements) }), ` ${t('map.settlements')}`),
          el('span', {}, el('strong', { text: fmtNum(this.stats.civs) }), ` ${t('map.civs')}`),
        ),
      ),
      el('div', { class: 'map-compass' }, el('span', { text: t('map.compass') })),
      el('div', { class: 'map-scale' }, el('i'), el('span', { text: this.km > 0 ? `${t('map.scale')} ≈ ${fmtNum(this.km)} km` : t('map.scale') })),
    );
  }
}
