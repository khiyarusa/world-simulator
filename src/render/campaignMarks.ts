/** Screen-constant stewardship marks: steward capital, objective targets, charter halos. */
import type { Graphics } from 'pixi.js';
import type { CampaignMarks } from './app.ts';
import { TILE_PX } from './markerGeometry.ts';
import { civColor } from './palette.ts';

export function drawCampaignMarks(g: Graphics, marks: CampaignMarks | null, zoom: number): void {
  g.clear();
  if (!marks) return;
  const s = 1 / Math.max(0.04, zoom);
  if (marks.steward) {
    const x = (marks.steward.x + 0.5) * TILE_PX;
    const y = (marks.steward.y + 0.5) * TILE_PX;
    g.circle(x, y, 15 * s).stroke({ width: 1.6 * s, color: 0xd8c07a, alpha: 0.9 });
    g.circle(x, y, 18.5 * s).stroke({ width: 0.8 * s, color: 0xd8c07a, alpha: 0.45 });
    g.poly([x, y - 23 * s, x + 4 * s, y - 19 * s, x, y - 15 * s, x - 4 * s, y - 19 * s]).fill({ color: 0xd8c07a, alpha: 0.98 });
  }
  for (const o of marks.objectives) {
    const x = (o.x + 0.5) * TILE_PX;
    const y = (o.y + 0.5) * TILE_PX;
    const color = o.kind === 1 ? 0xc08a3e : o.kind === 4 ? 0x6f9a7a : o.kind === 2 ? 0x8c5a72 : 0x8a6f3e;
    g.poly([x, y - 9 * s, x + 5 * s, y - 3 * s, x, y + 3 * s, x - 5 * s, y - 3 * s]).fill({ color, alpha: 0.95 });
    g.circle(x, y, 12 * s).stroke({ width: 1 * s, color, alpha: 0.6 });
  }
  for (const c of marks.charters) {
    const x = (c.x + 0.5) * TILE_PX;
    const y = (c.y + 0.5) * TILE_PX;
    g.circle(x, y, 13 * s).stroke({ width: 1.2 * s, color: civColor(c.civ), alpha: 0.5 });
  }
}
