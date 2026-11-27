/**
 * PixiJS renderer (docs/TECHNICAL_ARCHITECTURE.md §7).
 *
 * Owns: the Application, the world container, the baked terrain sprite, pooled settlement
 * sprites, the selection ring, and touch input. Owns no game data: everything drawn here came
 * from a worker message.
 */
import { Application, CanvasSource, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { MirrorDelta, WorldMetaMsg } from '../worker/protocol.ts';
import { Camera, type Point } from './camera.ts';
import { MapInput } from './input.ts';
import { TILE_PX, markerWorldScale } from './markerGeometry.ts';
import { civColor } from './palette.ts';
import { createSettlementTextures, RUINED_TEXTURE_OFFSET } from './settlementSprites.ts';
import { LayerView, type LayerViewMeta } from './layers.ts';
import type { LayerData } from '../worker/queries.ts';
import type { BakedTerrain, Quality } from './terrainBake.ts';
import { TerrainDetail } from './terrainDetail.ts';
import { drawCityDetail } from './cityDetail.ts';
import { drawCampaignMarks } from './campaignMarks.ts';
import { applySettlementLod, drawStateMarks } from './settlementLod.ts';
import { drawSelection } from './selection.ts';
import type { TerrainArrays } from '../core/gridTypes.ts';

export { TILE_PX } from './markerGeometry.ts';

export interface ViewState {
  readonly zoom: number;
  readonly x: number;
  readonly y: number;
  readonly tilesWide: number;
  readonly tilesHigh: number;
}

export interface CampaignMarks {
  readonly steward: { readonly x: number; readonly y: number } | null;
  readonly objectives: readonly { readonly x: number; readonly y: number; readonly kind: number }[];
  readonly charters: readonly { readonly x: number; readonly y: number; readonly civ: number }[];
}

export interface RendererHandlers {
  onTap(world: Point): void;
  onTapEmpty(): void;
  onLongPress?(world: Point): void;
  onViewChange?(view: ViewState): void;
  /** Frame time in milliseconds, once per rendered frame (debug instrumentation only). */
  onFrame?(ms: number): void;
}

export class Renderer {
  readonly app: Application;
  readonly cam = new Camera();
  private readonly root = new Container({ isRenderGroup: true });
  private readonly settlementLayer = new Container();
  private readonly stateMarks = new Graphics();
  private readonly cityDetail = new Graphics();
  private readonly campaignLayer = new Graphics();
  private campaignMarks: CampaignMarks | null = null;
  private readonly selection = new Graphics();
  readonly layers: LayerView;
  private readonly textures: Texture[];
  private readonly sprites: Sprite[] = [];
  /** Tier per settlement sprite; marker size is derived from it at draw time (D-39). */
  private readonly spriteTier = new Uint8Array(200);
  /** Stage 4 visual state bits per sprite. */
  private readonly spriteState = new Uint8Array(200);
  private readonly capital = new Uint8Array(200);
  private readonly spritePop = new Int32Array(200);
  private readonly spriteInfra = new Uint32Array(200);
  private cityDirty = true;
  private lastCityZoom = -1;
  private lastCampaignZoom = -1;
  private lastCityX = -1e9;
  private lastCityY = -1e9;
  private count = 0;
  private lastLodZoom = -1;
  private destroyed = false;
  private readonly handlers: RendererHandlers;
  private terrain: Sprite | null = null;
  private detail: TerrainDetail | null = null;
  private grids: TerrainArrays | null = null;
  private quality: Quality = 'high';
  private meta: WorldMetaMsg | null = null;
  private selectedId: number | null = null;
  private lowPower = false;
  private reducedMotion = false;
  private lastSelectionZoom = 0;
  private selectionDirty = true;

  private readonly input: MapInput;

  private constructor(app: Application, handlers: RendererHandlers) {
    this.app = app;
    this.handlers = handlers;
    this.textures = createSettlementTextures();
    this.layers = new LayerView();
    this.root.addChild(this.layers.rasterContainer, this.settlementLayer, this.cityDetail, this.campaignLayer, this.stateMarks, this.layers.vector, this.selection);
    this.input = new MapInput(app.canvas, this.cam, handlers);
  }

  static async create(host: HTMLElement, handlers: RendererHandlers): Promise<Renderer> {
    const app = new Application();
    await app.init({
      backgroundAlpha: 0,
      resizeTo: host,
      antialias: false,
      preference: 'webgl',
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      roundPixels: false,
    });
    host.appendChild(app.canvas);

    const renderer = new Renderer(app, handlers);
    app.stage.addChild(renderer.root);
    app.renderer.on('resize', (w: number, h: number) => {
      renderer.cam.setViewport(w, h);
      renderer.cam.clampTarget();
    });
    app.ticker.add(() => renderer.frame(app.ticker.deltaMS / 1000));
    return renderer;
  }

  // ---------------------------------------------------------------- world mounting

  mountWorld(meta: WorldMetaMsg, baked: BakedTerrain, grids?: TerrainArrays): void {
    this.meta = meta;
    if (grids) this.grids = grids;
    const worldW = meta.width * TILE_PX;
    const worldH = meta.height * TILE_PX;

    if (this.terrain) {
      this.root.removeChild(this.terrain);
      this.terrain.destroy();
    }
    const source = new CanvasSource({ resource: baked.canvas, scaleMode: 'linear' });
    this.terrain = new Sprite(new Texture({ source }));
    this.terrain.width = worldW;
    this.terrain.height = worldH;
    this.root.addChildAt(this.terrain, 0);
    this.rebuildDetail();

    this.cam.setWorld(worldW, worldH);
    this.cam.setViewport(this.app.screen.width, this.app.screen.height);
    this.cam.fit();
    this.cam.snap();

    this.rebuildSettlements(meta);
    this.applyTransform();
    this.emitView();
  }

  setSettlementLayout(meta: WorldMetaMsg): void {
    this.meta = meta;
    this.rebuildSettlements(meta);
  }

  private rebuildSettlements(meta: WorldMetaMsg): void {
    for (const s of this.sprites) {
      s.visible = false;
    }
    this.capital.fill(0);
    for (let c = 0; c < meta.civs.capital.length; c++) {
      const at = meta.civs.capital[c] ?? 0;
      if (at < this.capital.length) this.capital[at] = 1;
    }
    const count = Math.min(meta.settlements.x.length, 200);
    this.count = count;
    for (let i = 0; i < count; i++) {
      let sprite = this.sprites[i];
      if (!sprite) {
        sprite = new Sprite(this.textures[0]);
        sprite.anchor.set(0.5);
        this.settlementLayer.addChild(sprite);
        this.sprites.push(sprite);
      }
      sprite.visible = true;
      sprite.texture = this.textures[meta.settlements.tier[i] ?? 0] ?? this.textures[0]!;
      sprite.position.set(((meta.settlements.x[i] ?? 0) + 0.5) * TILE_PX, ((meta.settlements.y[i] ?? 0) + 0.5) * TILE_PX);
      sprite.tint = civColor(meta.settlements.civ[i] ?? 0);
      this.spriteTier[i] = meta.settlements.tier[i] ?? 0;
      this.spritePop[i] = meta.settlements.pop[i] ?? 0;
      this.spriteInfra[i] = meta.settlements.infra[i] ?? 0;
    }
    for (let i = count; i < this.sprites.length; i++) {
      const s = this.sprites[i];
      if (s) s.visible = false;
    }
    this.applyLod();
    this.drawStateMarks();
  }

  // ---------------------------------------------------------------- live data

  applyMirror(delta: MirrorDelta): void {
    const count = Math.min(delta.count, this.sprites.length);
    for (let i = 0; i < count; i++) {
      const sprite = this.sprites[i];
      if (!sprite) continue;
      const tier = Math.min(4, delta.tier[i] ?? 0);
      const state = delta.state?.[i] ?? 0;
      const ruined = (state & 1) !== 0;
      const tex = this.textures[tier + (ruined ? RUINED_TEXTURE_OFFSET : 0)] ?? this.textures[0]!;
      if (sprite.texture !== tex) sprite.texture = tex;
      const civ = delta.civ[i] ?? 0;
      const tint = civColor(civ);
      if (sprite.tint !== tint) sprite.tint = tint;
      sprite.alpha = (state & 64) !== 0 || (state & 2) !== 0 ? 0.68 : 1;
      // Population is encoded by scale, never by number on the map (UX §9.2)
      this.spriteTier[i] = tier;
      this.spriteState[i] = state;
      this.spritePop[i] = delta.pop[i] ?? 0;
      this.spriteInfra[i] = delta.infra[i] ?? 0;
      this.cityDirty = true;
    }
    for (let i = count; i < this.sprites.length; i++) {
      const s = this.sprites[i];
      if (s) s.visible = false;
    }
    this.applyLod();
    this.drawStateMarks();
    this.drawSelection();
  }


  setCampaignMarks(marks: CampaignMarks | null): void {
    this.campaignMarks = marks;
    this.lastCampaignZoom = this.cam.zoom;
    this.drawCampaignMarks();
  }

  private drawCampaignMarks(): void {
    drawCampaignMarks(this.campaignLayer, this.campaignMarks, this.cam.zoom);
  }

  private drawCityDetail(): void {
    if (!this.meta) return;
    drawCityDetail(this.cityDetail, {
      cam: this.cam,
      meta: this.meta,
      count: this.count,
      tier: this.spriteTier,
      state: this.spriteState,
      infra: this.spriteInfra,
      pop: this.spritePop,
      capital: this.capital,
    });
  }

  /** Small state dots: occupied, starving, prosperous. Shape+colour, never colour alone. */
  private drawStateMarks(): void {
    drawStateMarks({
      g: this.stateMarks,
      sprites: this.sprites,
      count: this.count,
      state: this.spriteState,
      capital: this.capital,
      zoom: this.cam.zoom,
      meta: this.meta,
    });
  }

  private applyLod(): void {
    this.cityDetail.visible = applySettlementLod({
      sprites: this.sprites,
      textures: this.textures,
      count: this.count,
      tier: this.spriteTier,
      state: this.spriteState,
      capital: this.capital,
      zoom: this.cam.zoom,
    });
    this.lastLodZoom = this.cam.zoom;
  }

  setLowPower(on: boolean): void {
    this.lowPower = on;
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
  }

  setSelected(id: number | null): void {
    this.selectedId = id;
    this.selectionDirty = true;
    this.drawSelection();
  }

  setLayer(data: LayerData | null, meta: LayerViewMeta): void {
    this.layers.setData(data, meta);
    this.layers.setZoom(this.cam.zoom, true);
  }

  clearLayer(): void {
    this.layers.clear();
  }

  markerAt(tileX: number, tileY: number, radius = 2.2): { id: number; layer: string } | null {
    return this.layers.markerAt(tileX, tileY, radius);
  }

  layerProbe(): Record<string, number | string | boolean | null> {
    return this.layers.debugState();
  }

  /** Centre the camera on a tile, used by panel "show on map" actions. */
  flyTo(tileX: number, tileY: number, zoom = Math.max(this.cam.zoom, 0.9)): void {
    this.cam.centerOn((tileX + 0.5) * TILE_PX, (tileY + 0.5) * TILE_PX, zoom);
  }

  /** Real framebuffer capture for a saved-world thumbnail. */
  snapshotDataUrl(size = 256): string {
    this.cam.snap();
    this.applyTransform();
    this.applyMarkerScale();
    this.app.renderer.render(this.app.stage);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    // The Pixi canvas is transparent outside the atlas; crop a centred square and fill the sea so
    // the JPEG thumbnail has no black letterbox bars.
    ctx.fillStyle = '#14262f';
    ctx.fillRect(0, 0, size, size);
    const source = this.app.canvas;
    const side = Math.min(source.width, source.height);
    const sx = Math.floor((source.width - side) / 2);
    const sy = Math.floor((source.height - side) / 2);
    ctx.drawImage(source, sx, sy, side, side, 0, 0, size, size);
    return canvas.toDataURL('image/jpeg', 0.72);
  }

  private drawSelection(): void {
    this.lastSelectionZoom = this.cam.zoom;
    this.selectionDirty = false;
    drawSelection(this.selection, this.sprites, this.selectedId, this.spriteTier, this.cam.zoom);
  }

  /**
   * Read the live GL framebuffer after a render. Used by the browser smoke test to prove the
   * map actually drew something (a canvas element existing is not evidence).
   */
  probePixels(): { min: number; max: number; sum: number } {
    // Snap to the camera target first: a gesture only updates the target, and a probe taken before
    // the next ticker frame would otherwise read the previous view.
    this.cam.snap();
    this.applyMarkerScale();
    this.applyTransform();
    this.app.renderer.render(this.app.stage);
    const gl = (this.app.renderer as unknown as { gl: WebGL2RenderingContext }).gl;
    const size = 32;
    const px = new Uint8Array(size * size * 4);
    const cx = Math.max(0, Math.floor(this.app.screen.width / 2) - size / 2);
    const cy = Math.max(0, Math.floor(this.app.screen.height / 2) - size / 2);
    gl.readPixels(cx, cy, size, size, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let min = 255;
    let max = 0;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) {
      const v = px[i] ?? 0;
      if (v < min) min = v;
      if (v > max) max = v;
      sum = (sum + v * 3 + (px[i + 1] ?? 0) * 5 + (px[i + 2] ?? 0) * 7) % 1_000_003;
    }
    return { min, max, sum };
  }

  // ---------------------------------------------------------------- projection

  worldToScreen(wx: number, wy: number): Point {
    return this.cam.worldToScreen(wx, wy);
  }

  /** Nearest settlement to a tile coordinate, within `radius` tiles. */
  nearestSettlement(tileX: number, tileY: number, radius: number): number | null {
    const meta = this.meta;
    if (!meta) return null;
    let best: number | null = null;
    let bestDist = radius * radius;
    for (let i = 0; i < meta.settlements.x.length; i++) {
      const dx = (meta.settlements.x[i] ?? 0) - tileX;
      const dy = (meta.settlements.y[i] ?? 0) - tileY;
      const d = dx * dx + dy * dy;
      if (d <= bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- per-frame

  private frame(dt: number): void {
    this.handlers.onFrame?.(dt * 1000);
    this.input.applyInertia(dt);
    this.cam.update(dt);
    this.applyTransform();
    this.detail?.update(this.cam);
    if (Math.abs(this.cam.zoom - this.lastLodZoom) > this.lastLodZoom * 0.01 || this.lastLodZoom < 0) this.applyLod();
    if (this.selectedId !== null) {
      if (this.reducedMotion || this.lowPower) this.selection.alpha = 1;
      else this.selection.alpha = 0.78 + 0.22 * Math.sin(performance.now() / 420);
    } else {
      this.selection.alpha = 1;
    }
    if (this.cam.isSettled()) this.emitView();
  }

  /**
   * Screenshot-constant markers: a 64 px glyph is drawn at `markerPx` screen pixels regardless of
   * zoom, which is what keeps a settlement visible on a full-world view and unobtrusive when
   * zoomed in.
   */
  private applyMarkerScale(): void {
    for (let i = 0; i < this.sprites.length; i++) {
      const sprite = this.sprites[i];
      if (!sprite || !sprite.visible) continue;
      const scale = markerWorldScale(this.spriteTier[i] ?? 0, this.cam.zoom);
      if (Math.abs(sprite.scale.x - scale) > 0.0001) sprite.scale.set(scale);
    }
  }

  private applyTransform(): void {
    this.root.position.set(-this.cam.x * this.cam.zoom, -this.cam.y * this.cam.zoom);
    this.root.scale.set(this.cam.zoom);
    this.layers.setZoom(this.cam.zoom);
    // The ring is world-space: only its radius depends on zoom. Redrawing it every frame was a
    // needless Graphics clear/fill in the hot path (Stage 5 defect).
    if (this.selectionDirty || Math.abs(this.cam.zoom - this.lastSelectionZoom) > this.lastSelectionZoom * 0.004) {
      this.drawSelection();
      this.drawStateMarks();
    }
    if (this.campaignMarks && Math.abs(this.cam.zoom - this.lastCampaignZoom) > this.lastCampaignZoom * 0.01) {
      this.drawCampaignMarks();
      this.lastCampaignZoom = this.cam.zoom;
    }
    const cityMoved = Math.abs(this.cam.x - this.lastCityX) > TILE_PX || Math.abs(this.cam.y - this.lastCityY) > TILE_PX;
    if (this.cam.zoom >= 0.62 && (this.cityDirty || cityMoved || Math.abs(this.cam.zoom - this.lastCityZoom) > this.lastCityZoom * 0.02)) {
      this.drawCityDetail();
      this.lastCityZoom = this.cam.zoom;
      this.lastCityX = this.cam.x;
      this.lastCityY = this.cam.y;
      this.cityDirty = false;
    }
  }

  private rebuildDetail(): void {
    this.detail?.destroy();
    this.detail = null;
    if (!this.grids || !this.meta) return;
    this.detail = new TerrainDetail(this.grids, this.meta.width, this.meta.height, this.meta.seaLevel, this.quality);
    this.root.addChildAt(this.detail.container, 1);
  }

  setCamera(tileX: number, tileY: number, zoom: number): void {
    this.cam.centerOn((tileX + 0.5) * TILE_PX, (tileY + 0.5) * TILE_PX, zoom);
    this.cam.snap();
    this.applyTransform();
  }

  detailStats(): { entries: number; visible: number; zoom: number } {
    const stats = this.detail?.stats() ?? { entries: 0, visible: 0, zoom: 0 };
    return { ...stats, zoom: this.cam.zoom };
  }

  detailImage(): string {
    return this.detail?.image() ?? '';
  }

  setQuality(quality: Quality): void {
    if (this.quality === quality) return;
    this.quality = quality;
    this.rebuildDetail();
  }

  private emitView(): void {
    const view: ViewState = {
      zoom: this.cam.zoom,
      x: this.cam.x,
      y: this.cam.y,
      tilesWide: this.cam.vw / this.cam.zoom / TILE_PX,
      tilesHigh: this.cam.vh / this.cam.zoom / TILE_PX,
    };
    this.handlers.onViewChange?.(view);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.input.destroy();
    this.detail?.destroy();
    this.detail = null;
    this.app.destroy({ removeView: true, releaseGlobalResources: true }, { children: true });
  }
}
