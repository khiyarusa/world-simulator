/**
 * World selection (Stage 4 WP6). A saved-world list built from the IndexedDB metadata, with a real
 * thumbnail captured from the last saved render. Opening, renaming and deleting are explicit actions;
 * deletion requires confirmation.
 */
import type { WorldDoc } from '../platform/storage.ts';
import { button, el, empty, pill } from './dom.ts';
import { icon } from './icons.ts';
import { fmtNum, lang, presetLabel, setLang, t, type Lang } from './i18n.ts';

export interface WorldsHandlers {
  onOpen(id: string): void;
  onNew(): void;
  onRename(id: string, name: string): void;
  onDelete(id: string): void;
  onLanguage(lang: Lang): void;
}

export class WorldsScreen {
  readonly root: HTMLDivElement;
  private readonly headerHost: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly handlers: WorldsHandlers;

  constructor(handlers: WorldsHandlers) {
    this.handlers = handlers;
    this.root = el('div', { class: 'worlds', hidden: true });
    this.headerHost = el('div');
    this.list = el('div', { class: 'worlds-list' });
    this.root.append(this.headerHost, this.list);
  }

  private lastDocs: WorldDoc[] = [];

  show(docs: readonly WorldDoc[]): void {
    this.root.hidden = false;
    this.render(docs);
  }

  hide(): void {
    this.root.hidden = true;
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  render(docs: readonly WorldDoc[]): void {
    this.lastDocs = [...docs];
    this.renderHeader();
    this.list.replaceChildren();
    if (docs.length === 0) {
      this.list.append(empty(t('worlds.empty')));
      return;
    }
    const sorted = [...docs].sort((a, b) => b.updatedAt - a.updatedAt);
    for (const doc of sorted) this.list.append(this.card(doc));
  }

  private renderHeader(): void {
    const head = el('header', { class: 'worlds-head' });
    const titles = el('div', {});
    titles.append(el('h1', { text: t('worlds.title') }), el('p', { class: 'lede', text: t('worlds.lede') }));
    head.append(titles);
    const actions = el('div', { class: 'worlds-actions' });
    const langSeg = el('div', { class: 'seg' });
    for (const code of ['fa', 'en'] as const) {
      langSeg.append(button(code === 'fa' ? t('common.persian') : t('common.english'), () => {
        setLang(code);
        this.handlers.onLanguage(code);
        this.render(this.lastDocs);
      }, { accent: lang() === code }));
    }
    actions.append(langSeg);
    actions.append(button(t('worlds.new'), () => this.handlers.onNew(), { accent: true }));
    head.append(actions);
    this.headerHost.replaceChildren(head);
  }

  private card(doc: WorldDoc): HTMLElement {
    const card = el('article', { class: 'world-card' });
    const thumb = el('div', { class: 'world-thumb' });
    if (doc.thumbnail) {
      const img = el('img', { src: doc.thumbnail, alt: '', loading: 'lazy' });
      thumb.append(img);
    } else {
      thumb.append(el('span', { class: 'world-monogram', text: doc.name.slice(0, 2).toUpperCase() }));
    }
    card.append(thumb);

    const body = el('div', { class: 'world-body' });
    body.append(el('h2', { text: doc.name }));
    const meta = el('p', { class: 'world-meta' });
    meta.append(
      el('span', { dir: 'ltr', text: doc.seedText }),
      el('span', { class: 'dot-sep', text: '·' }),
      el('span', { text: presetLabel(doc.preset) }),
      el('span', { class: 'dot-sep', text: '·' }),
      el('span', { text: `${t('common.day')} ${fmtNum(doc.day)}` }),
    );
    body.append(meta);
    const stats = el('div', { class: 'world-stats' });
    stats.append(
      stat(t('common.population'), fmtNum(doc.counts.population)),
      stat(t('common.settlements'), fmtNum(doc.counts.settlements)),
      stat(t('common.civs'), fmtNum(doc.counts.civs)),
    );
    body.append(stats);
    body.append(el('p', { class: 'hint', text: doc.updatedAt > 0 ? t('worlds.lastUpdated', { time: relativeTime(doc.updatedAt) }) : t('world.notSaved') }));

    const actions = el('div', { class: 'world-card-actions' });
    actions.append(button(t('worlds.play'), () => this.handlers.onOpen(doc.id), { accent: true }));
    actions.append(iconAction('pencil', t('worlds.rename'), () => {
      const name = window.prompt(t('worlds.renamePrompt'), doc.name);
      if (name === null) return;
      const trimmed = name.trim();
      if (trimmed.length > 0) this.handlers.onRename(doc.id, trimmed);
    }));
    actions.append(iconAction('trash', t('common.delete'), () => {
      if (window.confirm(t('worlds.deleteConfirm', { name: doc.name }))) this.handlers.onDelete(doc.id);
    }));
    body.append(actions);
    if (doc.day > 0) body.append(pill(t('worlds.day', { year: Math.floor((doc.day - 1) / 360) + 1, day: doc.day }), 'neutral'));
    card.append(body);
    return card;
  }
}

function stat(label: string, value: string): HTMLElement {
  const box = el('div', { class: 'stat' });
  box.append(el('span', { class: 'stat-k', text: label }), el('span', { class: 'stat-v', dir: 'ltr', text: value }));
  return box;
}

function iconAction(name: string, aria: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', { class: 'icon-btn bordered', type: 'button', 'aria-label': aria, title: aria });
  b.append(icon(name));
  b.addEventListener('click', onClick);
  return b;
}

function relativeTime(ms: number): string {
  const delta = Date.now() - ms;
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return lang() === 'fa' ? 'همین حالا' : 'just now';
  if (minutes < 60) return lang() === 'fa' ? `${fmtNum(minutes)} دقیقه پیش` : `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return lang() === 'fa' ? `${fmtNum(hours)} ساعت پیش` : `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return lang() === 'fa' ? `${fmtNum(days)} روز پیش` : `${days} d ago`;
}
