/** Layer, speed and settings sheets. One owner for modal sheet lifecycle and scroll reset. */
import { LAYER_KINDS, type EcologyMetric, type LayerKind, type Speed } from '../worker/protocol.ts';
import { button, el } from './dom.ts';
import { icon, LAYER_ICONS } from './icons.ts';
import { lang, t, type Lang } from './i18n.ts';
import { renderSettings } from './settings.ts';
import type { UiPrefs } from './prefs.ts';

export interface SheetHandlers {
  onLayer(layer: LayerKind): void;
  onLayerMetric(metric: EcologyMetric): void;
  onSpeed(speed: Speed): void;
  onPrefs(prefs: UiPrefs): void;
  onLanguage(lang: Lang): void;
  onReplayOnboarding(): void;
}

export class Sheets {
  private readonly body: HTMLElement;
  private readonly root: HTMLDivElement;
  private readonly handlers: SheetHandlers;

  constructor(parent: HTMLElement, handlers: SheetHandlers) {
    this.handlers = handlers;
    this.root = el('div', { class: 'sheet', role: 'dialog' });
    this.root.append(el('div', { class: 'sheet-handle' }));
    this.body = el('div', { class: 'sheet-body' });
    this.root.append(this.body);
    parent.append(this.root);
  }

  close(): void {
    this.root.classList.remove('open');
  }

  openLayers(activeLayer: LayerKind, metric: EcologyMetric): void {
    this.body.replaceChildren(
      el('h2', { text: t('nav.layers') }),
      el('p', { class: 'sub', text: t('layer.active') }),
    );
    const list = el('div', { class: 'layer-list' });
    for (const layer of LAYER_KINDS) {
      const row = el('button', { class: `layer-row${activeLayer === layer ? ' active' : ''}`, type: 'button' });
      const glyph = el('span', { class: 'layer-glyph' });
      glyph.append(icon(LAYER_ICONS[layer] ?? 'map'));
      const text = el('span', { class: 'layer-text' });
      text.append(
        el('span', { class: 'layer-name', text: t(`layer.${layer}`) }),
        el('span', { class: 'layer-desc', text: t(`layer.${layer}.desc`) }),
      );
      row.append(glyph, text);
      if (activeLayer === layer) row.append(el('span', { class: 'check', text: '✓' }));
      row.addEventListener('click', () => {
        this.handlers.onLayer(layer);
        if (layer === 'ecology') this.openLayers(layer, metric);
        else this.close();
      });
      list.append(row);
    }
    this.body.append(list);

    if (activeLayer === 'ecology') {
      const row = el('div', { class: 'metric-row' });
      row.append(el('span', { class: 'settings-label', text: t('layer.ecology') }));
      const seg = el('div', { class: 'seg wrap' });
      for (const key of ['fertility', 'vegetation', 'moisture', 'temperature'] as const) {
        seg.append(button(t(`common.${key}`), () => {
          this.handlers.onLayerMetric(key);
          this.openLayers('ecology', key);
        }, { accent: metric === key }));
      }
      row.append(seg);
      this.body.append(row);
    }
    this.appendClose();
    this.show();
  }

  openSpeed(current: Speed): void {
    this.body.replaceChildren(
      el('h2', { text: t('speed.title') }),
      el('p', { class: 'sub', text: t('speed.hint') }),
    );
    const options: Array<[string, Speed]> = [
      [t('speed.0'), 0],
      [t('speed.1'), 1],
      [t('speed.2'), 2],
      [t('speed.4'), 4],
      [t('speed.8'), 8],
    ];
    for (const [label, value] of options) {
      const b = button(`${label}${current === value ? ' •' : ''}`, () => {
        this.handlers.onSpeed(value);
        this.close();
      }, { accent: current === value });
      b.classList.add('wide');
      this.body.append(b);
    }
    this.show();
  }

  openSettings(prefs: UiPrefs): void {
    const render = (current: UiPrefs): void => {
      this.body.replaceChildren(
        renderSettings(current, lang(), {
          onPrefs: (next) => {
            this.handlers.onPrefs(next);
            render(next);
          },
          onLanguage: (code) => {
            this.handlers.onLanguage(code);
            render(current);
          },
          onReplayOnboarding: () => {
            this.handlers.onReplayOnboarding();
            this.close();
          },
        }),
      );
      this.appendClose();
    };
    render(prefs);
    this.show();
  }

  private appendClose(): void {
    const close = button(t('nav.close'), () => this.close());
    close.classList.add('ghost');
    this.body.append(close);
  }

  private show(): void {
    this.body.scrollTop = 0;
    this.root.classList.add('open');
  }
}
