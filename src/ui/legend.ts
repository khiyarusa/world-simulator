/** Layer legend: symbols and scales, localised and RTL-aware. */
import type { LayerKind } from '../worker/protocol.ts';
import { el } from './dom.ts';
import { t } from './i18n.ts';

export function renderLegend(host: HTMLElement, layer: LayerKind): void {
    host.replaceChildren();
    host.append(el('span', { class: 'legend-title', text: t(`layer.${layer}`) }));
    if (layer === 'terrain') {
      host.hidden = true;
      return;
    }
    host.hidden = false;

    if (layer === 'political') {
      const swatch = el('span', { class: 'legend-swatch' });
      swatch.style.background = '#b4553f';
      host.append(swatch, el('span', { class: 'legend-item', text: t('layer.territory') }));
      host.append(el('span', { class: 'legend-diamond' }), el('span', { class: 'legend-item', text: t('layer.capital') }));
      host.append(el('span', { class: 'legend-line war' }), el('span', { class: 'legend-item', text: t('layer.war') }));
      host.append(el('span', { class: 'legend-line treaty' }), el('span', { class: 'legend-item', text: t('layer.treaty') }));
      return;
    }
    if (layer === 'history') {
      for (let severity = 1; severity <= 5; severity++) {
        const dot = el('span', { class: `legend-dot sev${severity}` });
        dot.style.width = `${4 + severity * 2}px`;
        dot.style.height = `${4 + severity * 2}px`;
        host.append(dot);
      }
      host.append(el('span', { class: 'legend-item', text: t('layer.severity') }));
      return;
    }
    if (layer === 'population' || layer === 'economy' || layer === 'ecology') {
      const scale = el('span', { class: `legend-scale ${layer}` });
      host.append(el('span', { class: 'legend-item', text: t('layer.low') }), scale, el('span', { class: 'legend-item', text: t('layer.high') }));
      if (layer === 'population') host.append(el('span', { class: 'legend-ring' }), el('span', { class: 'legend-item', text: t('layer.migration') }));
      if (layer === 'economy') host.append(el('span', { class: 'legend-ring danger' }), el('span', { class: 'legend-item', text: t('layer.shortage') }));
      if (layer === 'ecology') host.append(el('span', { class: 'legend-ring' }), el('span', { class: 'legend-item', text: t('layer.drought') }));
      return;
    }
  }
