/**
 * Local-zoom city footprint renderer. Every structure comes from real infrastructure bits; placement
 * and roof variation are deterministic from the settlement id. Pure drawing: no simulation writes.
 */
import type { Graphics } from 'pixi.js';
import type { WorldMetaMsg } from '../worker/protocol.ts';
import type { Camera } from './camera.ts';
import { TILE_PX } from './markerGeometry.ts';
import { civColor } from './palette.ts';

export interface CityDetailInput {
  readonly cam: Camera;
  readonly meta: WorldMetaMsg;
  readonly count: number;
  readonly tier: Uint8Array;
  readonly state: Uint8Array;
  readonly infra: Uint32Array;
  readonly pop: Int32Array;
  readonly capital: Uint8Array;
}

export function drawCityDetail(g: Graphics, input: CityDetailInput): void {
  const { cam, meta, count, tier: tiers, state: states, infra: infras, pop: pops, capital: capitals } = input;
  g.clear();
    const zoom = Math.max(0.2, cam.zoom);
    const line = (px: number): number => px / zoom;
    const u = TILE_PX;
    const viewX = cam.x / u;
    const viewY = cam.y / u;
    const viewW = cam.vw / zoom / u;
    const viewH = cam.vh / zoom / u;
    const minX = viewX - 2;
    const maxX = viewX + viewW + 2;
    const minY = viewY - 2;
    const maxY = viewY + viewH + 2;
    const hash = (i: number, salt: number): number => {
      let h = Math.imul(i + 1, 374761393) + Math.imul(salt + 7, 668265263);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
    };
    for (let i = 0; i < count; i++) {
      const tx = meta.settlements.x[i] ?? 0;
      const ty = meta.settlements.y[i] ?? 0;
      if (tx < minX || tx > maxX || ty < minY || ty > maxY) continue;
      if ((pops[i] ?? 0) <= 0) continue;
      const tier = tiers[i] ?? 0;
      const infra = infras[i] ?? 0;
      const ruined = ((states[i] ?? 0) & 1) !== 0;
      const capital = capitals[i] !== 0;
      const civ = meta.settlements.civ[i] ?? 0;
      const accent = civColor(civ);
      const x = (tx + 0.5) * u;
      const y = (ty + 0.5) * u;
      const r = u * (0.7 + tier * 0.22 + (capital ? 0.1 : 0));
      const rot = hash(i, 1) * Math.PI * 2;

      g.ellipse(x, y + r * 0.34, r * 1.2, r * 0.5).fill({ color: 0x17140d, alpha: 0.26 });
      if (tier >= 2) g.circle(x, y, r * 0.92).fill({ color: 0x88805f, alpha: 0.16 });

      if (!ruined) {
        // fields and irrigation: real agriculture is visible as worked land, not decoration
        const plots = tier === 0 ? 2 : tier === 1 ? 3 : 5;
        for (let k = 0; k < plots; k++) {
          const a = rot + (k / plots) * Math.PI * 2 + hash(i, k + 3) * 0.5;
          const d = r * (1.08 + hash(i, k + 9) * 0.24);
          const w = r * 0.2;
          const h = r * 0.11;
          const cx = x + Math.cos(a) * d;
          const cy = y + Math.sin(a) * d;
          g.poly([cx - w, cy - h, cx + w, cy - h, cx + w, cy + h, cx - w, cy + h]).fill({
            color: (infra & 1 << 2) !== 0 ? 0x879c5f : 0xa89a63,
            alpha: tier >= 3 ? 0.5 : 0.68,
          });
        }
        if ((infra & 1 << 2) !== 0) {
          g.moveTo(x, y).lineTo(x - r * 0.9, y - r * 0.55).stroke({ width: line(1.4), color: 0x6f9a95, alpha: 0.75 });
          g.moveTo(x, y).lineTo(x - r * 1.1, y + r * 0.2).stroke({ width: line(1.2), color: 0x6f9a95, alpha: 0.7 });
        }
      }

      if ((infra & 1 << 6) !== 0 || tier >= 2) {
        const spokes = 4;
        for (let k = 0; k < spokes; k++) {
          const a = rot + (k / spokes) * Math.PI * 2;
          g.moveTo(x, y).lineTo(x + Math.cos(a) * r * 1.45, y + Math.sin(a) * r * 1.45).stroke({
            width: line(1.2),
            color: 0x6e5f43,
            alpha: 0.55,
          });
        }
      }

      if ((infra & 1 << 3) !== 0 || tier >= 2) {
        g.circle(x, y, r * 0.94).stroke({ width: line(2.1), color: 0x5c503b, alpha: 0.9 });
        const towers = tier >= 4 ? 8 : tier >= 3 ? 4 : 3;
        for (let k = 0; k < towers; k++) {
          const a = rot + (k / towers) * Math.PI * 2;
          const bx = x + Math.cos(a) * r * 0.94;
          const by = y + Math.sin(a) * r * 0.94;
          g.rect(bx - u * 0.08, by - u * 0.08, u * 0.16, u * 0.16).fill({ color: 0xc0b08a, alpha: 0.99 });
          g.rect(bx - u * 0.08, by - u * 0.08, u * 0.16, u * 0.16).stroke({ width: line(1), color: 0x4e4434, alpha: 0.95 });
          g.rect(bx - u * 0.09, by - u * 0.09, u * 0.18, u * 0.035).fill({ color: accent, alpha: 0.8 });
        }
      }

      // buildings on a deterministic ring; tier changes density and silhouette
      const buildings = ruined ? 3 + tier : 3 + tier * 3 + (capital ? 1 : 0);
      for (let k = 0; k < buildings; k++) {
        const a = rot + (k / Math.max(1, buildings)) * Math.PI * 2 + hash(i, k + 31) * 0.35;
        const d = r * (0.18 + hash(i, k + 47) * 0.62);
        const bx = x + Math.cos(a) * d;
        const by = y + Math.sin(a) * d;
        const w = u * (0.08 + hash(i, k + 61) * 0.055 + (tier >= 3 ? 0.02 : 0));
        const h = u * (0.09 + hash(i, k + 73) * 0.06 + (tier >= 3 ? 0.025 : 0));
        g.rect(bx - w / 2, by - h / 2, w, h).fill({ color: ruined ? 0x8c826a : 0xd6c7a1, alpha: 0.97 });
        g.rect(bx - w / 2, by - h / 2, w, h).stroke({ width: line(0.65), color: 0x4b4233, alpha: 0.8 });
        if (!ruined) {
          const roof = hash(i, k + 89) > 0.62 ? accent : 0x8d5b43;
          g.poly([bx - w * 0.55, by - h / 2, bx, by - h / 2 - h * 0.55, bx + w * 0.55, by - h / 2]).fill({ color: roof, alpha: 0.8 });
        }
      }
      if (ruined) {
        for (let k = 0; k < 5; k++) {
          const a = rot + k * 1.7;
          g.circle(x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7, u * 0.025).fill({ color: 0x6e6553, alpha: 0.8 });
        }
      }

      if (!ruined) {
        // infrastructure silhouettes
        if ((infra & 1 << 0) !== 0) {
          g.rect(x + r * 0.35, y - r * 0.45, u * 0.15, u * 0.24).fill({ color: 0xcbb783, alpha: 0.99 });
          g.circle(x + r * 0.35 + u * 0.075, y - r * 0.45, u * 0.1).fill({ color: 0xb9a26f, alpha: 0.99 });
        }
        if ((infra & 1 << 1) !== 0) g.circle(x - r * 0.3, y + r * 0.32, u * 0.055).stroke({ width: line(1), color: 0x7fb0b2, alpha: 0.95 });
        if ((infra & 1 << 4) !== 0) {
          const mx = x - r * 0.35;
          const my = y + r * 0.05;
          g.poly([mx - u * 0.13, my, mx, my - u * 0.1, mx + u * 0.13, my]).fill({ color: accent, alpha: 0.85 });
          g.rect(mx - u * 0.02, my, u * 0.04, u * 0.1).fill({ color: 0x5b4c38, alpha: 0.95 });
        }
        if ((infra & 1 << 5) !== 0) {
          g.rect(x - r * 0.55, y - r * 0.4, u * 0.08, u * 0.15).fill({ color: 0x9a8b70, alpha: 0.98 });
          g.rect(x - r * 0.55 - u * 0.02, y - r * 0.4 - u * 0.05, u * 0.12, u * 0.035).fill({ color: 0x5c503b, alpha: 0.9 });
        }
        if ((infra & 1 << 7) !== 0) {
          g.circle(x + r * 0.1, y - r * 0.28, u * 0.09).fill({ color: 0xe0d5bc, alpha: 0.98 });
          g.rect(x + r * 0.1 - u * 0.008, y - r * 0.28 - u * 0.17, u * 0.016, u * 0.09).fill({ color: 0xd8c07a, alpha: 0.98 });
        }
        if ((infra & 1 << 8) !== 0) {
          const ax = x - r * 0.55;
          const ay = y - r * 0.25;
          g.rect(ax, ay, u * 0.16, u * 0.32).fill({ color: 0xd2c5a6, alpha: 0.99 });
          g.poly([ax - u * 0.03, ay, ax + u * 0.08, ay - u * 0.12, ax + u * 0.19, ay]).fill({ color: accent, alpha: 0.85 });
        }
        if ((infra & 1 << 9) !== 0) {
          for (let k = 0; k < 3; k++) {
            const ax = x + r * (1.05 + k * 0.18);
            const ay = y;
            g.moveTo(ax, ay - u * 0.12).lineTo(ax, ay + u * 0.12).stroke({ width: line(1.1), color: 0xb6a98d, alpha: 0.9 });
            g.circle(ax, ay - u * 0.02, u * 0.07).stroke({ width: line(0.8), color: 0x8c806a, alpha: 0.9 });
          }
        }
        if ((infra & 1 << 10) !== 0) {
          g.rect(x - r * 0.45, y + r * 0.3, u * 0.24, u * 0.09).fill({ color: 0x9f9076, alpha: 0.98 });
          g.rect(x - r * 0.45, y + r * 0.3, u * 0.24, u * 0.09).stroke({ width: line(0.7), color: 0x4b4233, alpha: 0.8 });
        }
        if ((infra & 1 << 11) !== 0) {
          g.moveTo(x + r * 0.7, y - u * 0.12).lineTo(x + r * 1.15, y - u * 0.12).stroke({ width: line(1.4), color: 0x6d5c43, alpha: 0.95 });
          g.poly([x + r * 0.82, y - u * 0.12, x + r * 0.95, y - u * 0.2, x + r * 1.05, y - u * 0.12]).fill({ color: 0xe4d8be, alpha: 0.95 });
        }
      }

      if (capital && !ruined) {
        const px = x + r * 0.62;
        const py = y - r * 0.62;
        g.rect(px, py, u * 0.018, u * 0.22).fill({ color: 0xd8c07a, alpha: 0.95 });
        g.poly([px, py, px + u * 0.16, py + u * 0.04, px, py + u * 0.09]).fill({ color: accent, alpha: 0.95 });
        g.circle(x, y, r * 1.05).stroke({ width: line(0.8), color: 0xd8c07a, alpha: 0.35 });
      }
    }
}
