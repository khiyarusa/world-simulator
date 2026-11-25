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
import { civColor } from './palette.ts';
import { createSettlementTextures } from './settlementSprites.ts';
import type { BakedTerrain } from './terrainBake.ts';

/** World pixels per tile at zoom 1.0 (docs/UX_AND_VISUAL_DIRECTION.md §1). */
export const TILE_PX = 32;

/** Marker size in screen pixels per settlement tier (camp → metropolis). */
function markerPx(tier: number): number {
  return [15, 19, 24, 30, 38][tier] ?? 15;
}

export interface ViewState {
  readonly zoom: number;
  readonly x: number;
  readonly y: number;
  readonly tilesWide: number;
  readonly tilesHigh: number;
}

export interface RendererHandlers {
  onTap(world: Point): void;
  onTapEmpty(): void;
  onLongPress?(world: Point): void;
  onViewChange?(view: ViewState): void;
  /** Frame time in milliseconds, once per rendered frame (debug instrumentation only). */
  onFrame?(ms: number): void;
}

interface PointerState {
  id: number;
  x: number;
  y: number;
}

export class Renderer {
  readonly app: Application;
  readonly cam = new Camera();
  private readonly root = new Container({ isRenderGroup: true });
  private readonly settlementLayer = new Container();
  private readonly selection = new Graphics();
  private readonly textures: Texture[];
  private readonly sprites: Sprite[] = [];
  /** Screen-space size per settlement, so a marker stays readable at every zoom (UX §9.2). */
  private readonly basePx = new Float32Array(200);
  private readonly handlers: RendererHandlers;
  private terrain: Sprite | null = null;
  private meta: WorldMetaMsg | null = null;
  private selectedId: number | null = null;

  private readonly pointers = new Map<number, PointerState>();
  private dragging = false;
  private moved = 0;
  private pinchDistance = 0;
  private pinchMid: Point = { x: 0, y: 0 };
  private velX = 0;
  private velY = 0;
  private lastMoveAt = 0;
  private lastTapAt = 0;
  private lastTap: Point = { x: 0, y: 0 };
  private longPressTimer: number | null = null;

  private constructor(app: Application, handlers: RendererHandlers) {
    this.app = app;
    this.handlers = handlers;
    this.textures = createSettlementTextures();
  }

  static async create(host: HTMLElement, handlers: RendererHandlers): Promise<Renderer> {
    const app = new Application();
    await app.init({
      background: '#12110e',
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
    renderer.root.addChild(renderer.settlementLayer, renderer.selection);
    renderer.bindInput(app.canvas);
    app.renderer.on('resize', (w: number, h: number) => {
      renderer.cam.setViewport(w, h);
      renderer.cam.clampTarget();
    });
    app.ticker.add(() => renderer.frame(app.ticker.deltaMS / 1000));
    return renderer;
  }

  // ---------------------------------------------------------------- world mounting

  mountWorld(meta: WorldMetaMsg, baked: BakedTerrain): void {
    this.meta = meta;
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

    this.cam.setWorld(worldW, worldH);
    this.cam.setViewport(this.app.screen.width, this.app.screen.height);
    this.cam.fit();
    this.cam.snap();

    this.rebuildSettlements(meta);
    this.applyTransform();
    this.emitView();
  }

  private rebuildSettlements(meta: WorldMetaMsg): void {
    for (const s of this.sprites) {
      s.visible = false;
    }
    const count = Math.min(meta.settlements.x.length, 200);
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
      this.basePx[i] = markerPx(meta.settlements.tier[i] ?? 0);
    }
    for (let i = count; i < this.sprites.length; i++) {
      const s = this.sprites[i];
      if (s) s.visible = false;
    }
  }

  // ---------------------------------------------------------------- live data

  applyMirror(delta: MirrorDelta): void {
    const count = Math.min(delta.count, this.sprites.length);
    for (let i = 0; i < count; i++) {
      const sprite = this.sprites[i];
      if (!sprite) continue;
      const tier = delta.tier[i] ?? 0;
      const tex = this.textures[tier] ?? this.textures[0]!;
      if (sprite.texture !== tex) sprite.texture = tex;
      const civ = delta.civ[i] ?? 0;
      const tint = civColor(civ);
      if (sprite.tint !== tint) sprite.tint = tint;
      // Population is encoded by scale, never by number on the map (UX §9.2)
      this.basePx[i] = markerPx(tier);
    }
    for (let i = count; i < this.sprites.length; i++) {
      const s = this.sprites[i];
      if (s) s.visible = false;
    }
    this.drawSelection();
  }

  setSelected(id: number | null): void {
    this.selectedId = id;
    this.drawSelection();
  }

  private drawSelection(): void {
    this.selection.clear();
    if (this.selectedId === null) return;
    const sprite = this.sprites[this.selectedId];
    if (!sprite || !sprite.visible) return;
    const worldPerScreen = 1 / (TILE_PX * this.cam.zoom);
    this.selection
      .circle(sprite.x, sprite.y, (this.basePx[this.selectedId] ?? 18) * worldPerScreen * 0.95)
      .stroke({ width: 2 / Math.max(0.15, this.cam.zoom), color: 0xece5d8, alpha: 0.95 });
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
    this.applyInertia(dt);
    this.cam.update(dt);
    this.applyTransform();
    this.applyMarkerScale();
    if (this.cam.isSettled()) this.emitView();
  }

  /**
   * Screenshot-constant markers: a 64 px glyph is drawn at `markerPx` screen pixels regardless of
   * zoom, which is what keeps a settlement visible on a full-world view and unobtrusive when
   * zoomed in.
   */
  private applyMarkerScale(): void {
    const worldPerScreen = 1 / (TILE_PX * this.cam.zoom);
    for (let i = 0; i < this.sprites.length; i++) {
      const sprite = this.sprites[i];
      if (!sprite || !sprite.visible) continue;
      const scale = (this.basePx[i] ?? 18) * worldPerScreen / 64;
      if (Math.abs(sprite.scale.x - scale) > 0.0001) sprite.scale.set(scale);
    }
  }

  private applyTransform(): void {
    this.root.position.set(-this.cam.x * this.cam.zoom, -this.cam.y * this.cam.zoom);
    this.root.scale.set(this.cam.zoom);
    this.drawSelection();
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

  private applyInertia(dt: number): boolean {
    if (this.dragging) return false;
    if (Math.abs(this.velX) < 0.01 && Math.abs(this.velY) < 0.01) return false;
    const decay = Math.exp(-6 * dt);
    this.cam.panByScreen(this.velX * dt * 1000, this.velY * dt * 1000);
    this.velX *= decay;
    this.velY *= decay;
    return true;
  }

  // ---------------------------------------------------------------- input

  private bindInput(canvas: HTMLCanvasElement): void {
    canvas.style.touchAction = 'none';

    canvas.addEventListener('pointerdown', (e: PointerEvent) => {
      canvas.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { id: e.pointerId, x: e.offsetX, y: e.offsetY });
      this.moved = 0;
      this.velX = 0;
      this.velY = 0;
      if (this.pointers.size === 1) {
        this.dragging = true;
        this.startLongPress(e.offsetX, e.offsetY);
      } else if (this.pointers.size === 2) {
        this.clearLongPress();
        const [a, b] = this.firstTwo();
        if (a && b) {
          this.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
          this.pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        }
      }
    });

    canvas.addEventListener('pointermove', (e: PointerEvent) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      // PointerEvent.movementX is 0 for touch input, so derive the delta ourselves.
      const dx = e.offsetX - prev.x;
      const dy = e.offsetY - prev.y;
      prev.x = e.offsetX;
      prev.y = e.offsetY;

      if (this.pointers.size === 1) {
        this.moved += Math.abs(dx) + Math.abs(dy);
        if (this.moved > 8) this.clearLongPress();
        this.cam.panByScreen(dx, dy);
        const now = performance.now();
        const dt = Math.max(1, now - this.lastMoveAt);
        this.lastMoveAt = now;
        this.velX = dx / dt;
        this.velY = dy / dt;
      } else if (this.pointers.size === 2) {
        const [a, b] = this.firstTwo();
        if (!a || !b) return;
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (this.pinchDistance > 0 && dist > 0) {
          this.cam.panByScreen(mid.x - this.pinchMid.x, mid.y - this.pinchMid.y);
          this.cam.zoomAtScreen(mid.x, mid.y, dist / this.pinchDistance);
        }
        this.pinchDistance = dist;
        this.pinchMid = mid;
      }
    });

    const end = (e: PointerEvent): void => {
      const wasSingle = this.pointers.size === 1;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinchDistance = 0;
      if (this.pointers.size === 0) {
        this.dragging = false;
        this.clearLongPress();
        if (wasSingle && this.moved <= 8) this.handleTap(e.offsetX, e.offsetY);
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  /** First two active pointers without allocating an array. */
  private firstTwo(): [PointerState | undefined, PointerState | undefined] {
    let a: PointerState | undefined;
    let b: PointerState | undefined;
    for (const p of this.pointers.values()) {
      if (!a) a = p;
      else {
        b = p;
        break;
      }
    }
    return [a, b];
  }

  private startLongPress(x: number, y: number): void {
    this.clearLongPress();
    this.longPressTimer = window.setTimeout(() => {
      this.longPressTimer = null;
      const world = this.cam.screenToWorld(x, y);
      this.handlers.onLongPress?.(world);
    }, 500);
  }

  private clearLongPress(): void {
    if (this.longPressTimer !== null) {
      window.clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  private handleTap(x: number, y: number): void {
    const now = performance.now();
    const world = this.cam.screenToWorld(x, y);

    // double tap -> 2x zoom toward the point
    if (now - this.lastTapAt < 300 && Math.hypot(x - this.lastTap.x, y - this.lastTap.y) < 24) {
      this.lastTapAt = 0;
      this.cam.zoomToPoint(x, y, Math.min(this.cam.maxZoom(), this.cam.zoom * 2));
      return;
    }
    this.lastTapAt = now;
    this.lastTap = { x, y };
    this.handlers.onTap(world);
  }

  destroy(): void {
    this.clearLongPress();
    this.app.destroy({ removeView: true, releaseGlobalResources: true }, { children: true });
  }
}
