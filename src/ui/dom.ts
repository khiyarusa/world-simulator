/**
 * Small DOM builders shared by every panel. No framework: a panel is a tree of elements, rebuilt
 * from a query result. This keeps the UI honest (it renders exactly what it was given) and small.
 */
import { fmtNum, isRtl, t } from './i18n.ts';

export type Child = Node | string | number | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else if (key.startsWith('on') && typeof value === 'function') {
      // not used by callers; kept out deliberately
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  append(node, children);
  return node;
}

export function append(node: Element, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(node: Element): void {
  node.replaceChildren();
}

/** A number or code that must keep LTR order inside an RTL sentence. */
export function num(value: number): HTMLElement {
  return el('span', { class: 'num', dir: 'ltr', text: fmtNum(value) });
}

export function raw(value: string, className = 'v'): HTMLElement {
  return el('span', { class: className, dir: 'auto', text: value });
}

export function kv(label: string, value: string | Node, hint?: string): HTMLElement {
  const row = el('div', { class: 'kv-row' });
  row.append(el('span', { class: 'k', text: label }));
  const v = el('span', { class: 'v' });
  v.append(value instanceof Node ? value : document.createTextNode(value));
  row.append(v);
  if (hint) row.append(el('span', { class: 'hint', text: hint }));
  return row;
}

export function section(title: string, ...children: Child[]): HTMLElement {
  const box = el('section', { class: 'panel-section' });
  box.append(el('h3', { text: title }));
  append(box, children);
  return box;
}

export function bar(value: number, max: number, className = ''): HTMLElement {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  const track = el('div', { class: `bar ${className}`.trim() });
  const fill = el('i');
  fill.style.width = `${pct.toFixed(1)}%`;
  track.append(fill);
  return track;
}

export function meter(label: string, value: number, max: number, suffix?: string): HTMLElement {
  const row = el('div', { class: 'meter' });
  const head = el('div', { class: 'meter-head' });
  head.append(el('span', { class: 'k', text: label }));
  head.append(el('span', { class: 'v', dir: 'ltr', text: suffix ?? `${fmtNum(value)} / ${fmtNum(max)}` }));
  row.append(head, bar(value, max));
  return row;
}

export function pill(text: string, tone: 'neutral' | 'warn' | 'danger' | 'good' | 'accent' = 'neutral'): HTMLElement {
  return el('span', { class: `pill ${tone}`, text });
}

export function button(label: string, onClick: () => void, opts: { accent?: boolean; danger?: boolean; disabled?: boolean; title?: string } = {}): HTMLButtonElement {
  const b = el('button', {
    class: `btn${opts.accent ? ' accent' : ''}${opts.danger ? ' danger' : ''}`,
    type: 'button',
    title: opts.title,
  }, label);
  b.disabled = opts.disabled === true;
  b.addEventListener('click', onClick);
  return b;
}

export function iconButton(label: string, aria: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', { class: 'icon-btn', type: 'button', 'aria-label': aria, title: aria }, label);
  b.addEventListener('click', onClick);
  return b;
}

export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const wrap = el('label', { class: 'field' });
  wrap.append(el('span', { class: 'field-label', text: label }), control);
  if (hint) wrap.append(el('span', { class: 'hint', text: hint }));
  return wrap;
}

export function select(
  options: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>,
  value: string,
  onChange: (value: string) => void,
): HTMLSelectElement {
  const s = el('select', { class: 'input' });
  for (const option of options) {
    const o = el('option', { value: option.value, text: option.label });
    o.disabled = option.disabled === true;
    o.selected = option.value === value;
    s.append(o);
  }
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

export function input(value: string, onInput: (value: string) => void, type = 'text'): HTMLInputElement {
  const i = el('input', { class: 'input', type, value });
  i.addEventListener('input', () => onInput(i.value));
  return i;
}

export function numberInput(value: number, min: number, max: number, onInput: (value: number) => void): HTMLInputElement {
  const i = el('input', { class: 'input', type: 'number', min, max, value });
  i.addEventListener('input', () => onInput(Math.max(min, Math.min(max, Math.round(Number(i.value) || min)))));
  return i;
}

/** A compact line chart from real values. Missing/short series degrades to a message, never a fake line. */
export function sparkline(
  values: readonly number[],
  opts: { width?: number; height?: number; color?: string; fill?: string; label?: string } = {},
): HTMLElement {
  const width = opts.width ?? 300;
  const height = opts.height ?? 64;
  const box = el('div', { class: 'chart' });
  if (values.length === 0) {
    box.append(el('p', { class: 'empty', text: t('common.noData') }));
    return box;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 4;
  const points = values.length === 1
    ? (() => {
        const y = (height / 2).toFixed(1);
        return [`${pad},${y}`, `${width - pad},${y}`];
      })()
    : values.map((v, i) => {
        const x = pad + (i * (width - pad * 2)) / (values.length - 1);
        const y = height - pad - ((v - min) / span) * (height - pad * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      });
  const path = `M${points.join(' L')}`;
  const area = `${path} L${width - pad},${height - pad} L${pad},${height - pad} Z`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'sparkline');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', opts.label ?? '');
  const f = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  f.setAttribute('d', area);
  f.setAttribute('fill', opts.fill ?? 'rgba(200,160,90,0.14)');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', opts.color ?? '#c8a05a');
  p.setAttribute('stroke-width', '1.6');
  p.setAttribute('stroke-linejoin', 'round');
  p.setAttribute('stroke-linecap', 'round');
  svg.append(f, p);
  box.append(svg);
  const range = el('div', { class: 'chart-range' });
  range.append(el('span', { dir: 'ltr', text: fmtNum(min) }), el('span', { dir: 'ltr', text: fmtNum(max) }));
  box.append(range);
  return box;
}

export function tabs(
  items: ReadonlyArray<{ id: string; label: string; badge?: string }>,
  active: string,
  onSelect: (id: string) => void,
): HTMLElement {
  const barEl = el('div', { class: 'tabbar', role: 'tablist' });
  for (const item of items) {
    const b = el('button', {
      class: `tab${item.id === active ? ' active' : ''}`,
      type: 'button',
      role: 'tab',
      'aria-selected': item.id === active ? 'true' : 'false',
    });
    b.append(el('span', { text: item.label }));
    if (item.badge) b.append(el('span', { class: 'badge', text: item.badge }));
    b.addEventListener('click', () => onSelect(item.id));
    barEl.append(b);
  }
  return barEl;
}

export function empty(text: string): HTMLElement {
  return el('p', { class: 'empty', text });
}

export function spacer(): HTMLElement {
  return el('div', { class: 'spacer' });
}

export function scrollKey(): string {
  return isRtl() ? 'rtl' : 'ltr';
}
