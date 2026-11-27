/** Selected-settlement chip above the dock. */
import { el } from './dom.ts';

export class SelectionChip {
  readonly root: HTMLDivElement;
  private readonly name: HTMLElement;
  private readonly meta: HTMLElement;
  private open = false;

  constructor(onTap: () => void) {
    this.root = el('div', { class: 'chip', hidden: true });
    this.name = el('span', { class: 'name' });
    this.meta = el('span', { class: 'meta' });
    this.root.append(this.name, this.meta);
    this.root.addEventListener('click', onTap);
  }

  show(name: string, meta: string): void {
    this.name.textContent = name;
    this.meta.textContent = meta;
    this.root.hidden = false;
    this.open = true;
  }

  hide(): void {
    this.root.hidden = true;
    this.open = false;
  }

  get visible(): boolean {
    return this.open;
  }
}
