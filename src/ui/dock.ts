/** Bottom arc: three thumb-reachable keys. */
import { el } from './dom.ts';
import { icon } from './icons.ts';
import { t } from './i18n.ts';

export function buildDock(onLayers: () => void, onMenu: () => void): HTMLElement {
  const dock = el('div', { class: 'dock' });
  const layers = el('button', { class: 'dock-btn', type: 'button' });
  layers.dataset.labelKey = 'nav.layers';
  layers.append(icon('layers'), el('span', { class: 'dock-label', text: t('nav.layers') }));
  layers.addEventListener('click', onLayers);
  dock.append(layers);

  const speed = el('div', { class: 'dock-slot', 'data-slot': 'speed' });
  dock.append(speed);

  const menu = el('button', { class: 'dock-btn', type: 'button' });
  menu.dataset.labelKey = 'nav.menu';
  menu.append(icon('menu'), el('span', { class: 'dock-label', text: t('nav.menu') }));
  menu.addEventListener('click', onMenu);
  dock.append(menu);
  return dock;
}
