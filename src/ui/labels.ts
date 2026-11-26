/**
 * Settlement labels (Stage 5 WP3.4): DOM labels with measured collision avoidance.
 *
 * A fixed pool is reused; no node is created per settlement and no text object is allocated per
 * frame. Priority is selection > capital > population, so a small settlement never hides the city
 * the player is inspecting. Labels are clamped inside the safe viewport instead of being clipped.
 */
export interface LabelItem {
  readonly id: number;
  readonly wx: number;
  readonly wy: number;
  readonly name: string;
  readonly weight: number;
  readonly capital: boolean;
}

const POOL_SIZE = 32;

interface Placed {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class Labels {
  private readonly nodes: HTMLDivElement[] = [];
  private items: readonly LabelItem[] = [];
  private visible = true;
  private zoom = 1;
  private selectedId: number | null = null;

  constructor(host: HTMLElement) {
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

  setSelected(id: number | null): void {
    this.selectedId = id;
  }

  setZoom(zoom: number): void {
    this.zoom = zoom;
    this.visible = zoom > 0.035;
    if (!this.visible) this.hideAll();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (!visible) this.hideAll();
  }

  private hideAll(): void {
    for (const node of this.nodes) node.style.display = 'none';
  }

  update(project: (wx: number, wy: number) => { x: number; y: number }, viewW: number, viewH: number): void {
    if (!this.visible) {
      this.hideAll();
      return;
    }
    const marginTop = 68;
    const marginBottom = 108;
    const limit = this.zoom < 0.12 ? 8 : this.zoom < 0.3 ? 14 : this.zoom < 1 ? 22 : POOL_SIZE;
    const candidates: Array<{ item: LabelItem; x: number; y: number; priority: number }> = [];
    for (const item of this.items) {
      const p = project(item.wx, item.wy);
      if (p.x < 22 || p.y < marginTop || p.x > viewW - 22 || p.y > viewH - marginBottom) continue;
      const priority = item.id === this.selectedId ? 1e9 : (item.capital ? 500_000 : 0) + item.weight;
      candidates.push({ item, x: p.x, y: p.y, priority });
    }
    candidates.sort((a, b) => b.priority - a.priority || a.item.id - b.item.id);

    const placed: Placed[] = [];
    let used = 0;
    for (const candidate of candidates) {
      if (used >= this.nodes.length) break;
      if (used >= limit && candidate.item.id !== this.selectedId) continue;
      const text = candidate.item.name;
      const w = Math.min(150, 14 + text.length * 6.6);
      const h = 19;
      let y = candidate.y - 20;
      if (y < marginTop) y = candidate.y + 12;
      const x = Math.max(w / 2 + 6, Math.min(viewW - w / 2 - 6, candidate.x));
      const box = { x: x - w / 2 - 2, y: y - h / 2, w: w + 4, h: h + 2 };
      const selected = candidate.item.id === this.selectedId;
      if (!selected && overlaps(box, placed)) continue;
      placed.push(box);
      const node = this.nodes[used++]!;
      node.style.display = 'block';
      node.style.left = `${x.toFixed(1)}px`;
      node.style.top = `${y.toFixed(1)}px`;
      node.textContent = candidate.item.capital ? `◆ ${text}` : text;
      node.className = `settlement-label${candidate.item.capital ? ' capital' : ''}${selected ? ' selected' : ''}`;
    }
    for (let i = used; i < this.nodes.length; i++) this.nodes[i]!.style.display = 'none';
  }
}

function overlaps(a: Placed, placed: readonly Placed[]): boolean {
  for (const b of placed) {
    if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) return true;
  }
  return false;
}
