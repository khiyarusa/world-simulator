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

/** A one-line interpretation at the top of a panel: what matters right now. */
export function insight(kicker: string, value: string, tone: 'neutral' | 'warn' | 'danger' = 'neutral'): HTMLElement {
  const box = el('div', { class: `insight ${tone}`.trim() });
  const glyph = el('span', { class: 'insight-icon', text: '◆' });
  const text = el('span', { class: 'insight-text' });
  text.append(el('span', { class: 'insight-k', text: kicker }), el('span', { class: 'insight-v', text: value }));
  box.append(glyph, text);
  return box;
}

/** An inline, text-like navigation button used inside panel prose. */
export function linkButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', { class: 'link-btn', type: 'button' }, label);
  b.addEventListener('click', onClick);
  return b;
}
