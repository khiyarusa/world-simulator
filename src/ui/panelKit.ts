/** Tiny shared panel pieces. */
import { el } from './dom.ts';
import { t } from './i18n.ts';

export function stat(label: string, value: string | Node): HTMLElement {
  const box = el('div', { class: 'stat' });
  box.append(el('span', { class: 'stat-k', text: label }));
  const v = el('span', { class: 'stat-v' });
  v.append(value instanceof Node ? value : document.createTextNode(value));
  box.append(v);
  return box;
}

export function counterKey(key: string): string {
  const map: Record<string, string> = {
    births: 'cohort.children',
    deaths: 'common.health',
    migrants: 'layer.migration',
    warsDeclared: 'common.war',
    techDiscovered: 'civ.tech',
    tradeVolume: 'economy.tradeVolume',
  };
  return t(map[key] ?? key);
}
