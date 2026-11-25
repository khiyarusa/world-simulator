/**
 * Settlement labels in the DOM, not in PixiJS (docs/TECHNICAL_ARCHITECTURE.md §7).
 *
 * A fixed pool of nodes is reused; we never create a Text object per settlement, and we never
 * add a node per settlement either. Only the settlements that matter on screen get a label.
 */

export interface LabelItem {
  readonly id: number;
  /** world pixels */
  readonly wx: number;
  readonly wy: number;
  readonly name: string;
  readonly weight: number;
  readonly capital: boolean;
}

const POOL_SIZE = 28;

export class Labels {
  private readonly host: HTMLElement;
  private readonly nodes: HTMLDivElement[] = [];
  private items: readonly LabelItem[] = [];
  private visible = true;

  constructor(host: HTMLElement) {
    this.host = host;
    for (let i = 0; i < POOL_SIZE; i++) {
      const node = document.createElement('div');
      node.className = 'settlement-label';
      node.style.display = 'none';
      host.appendChild(node);
      this.nodes.push(node);
    }
  }

  setItems(items: readonly LabelItem[]): void {
    this.items = items;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (!visible) {
      for (const node of this.nodes) node.style.display = 'none';
    }
  }

  /**
   * Reposition the pool for the current camera. `project` maps world pixels to CSS pixels.
   * Labels are picked by weight (population, capital, selection) so the important names survive.
   */
  update(project: (wx: number, wy: number) => { x: number; y: number }, viewW: number, viewH: number): void {
    if (!this.visible) return;
    const candidates: LabelItem[] = [];
    for (const item of this.items) {
      const p = project(item.wx, item.wy);
      if (p.x < -60 || p.y < -30 || p.x > viewW + 60 || p.y > viewH + 30) continue;
      candidates.push(item);
      if (candidates.length >= POOL_SIZE * 2) break;
    }
    candidates.sort((a, b) => b.weight - a.weight);

    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i]!;
      const item = candidates[i];
      if (!item) {
        node.style.display = 'none';
        continue;
      }
      const p = project(item.wx, item.wy);
      node.style.display = 'block';
      node.style.left = `${p.x.toFixed(1)}px`;
      node.style.top = `${p.y.toFixed(1)}px`;
      node.textContent = item.name;
      node.className = item.capital ? 'settlement-label capital' : 'settlement-label';
    }
  }
}
