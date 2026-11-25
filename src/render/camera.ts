/**
 * Camera math for a top-down map (docs/UX_AND_VISUAL_DIRECTION.md §2).
 *
 * Deliberately DOM-free so the numeric contract is unit-testable: pinch keeps the world point
 * under the fingers fixed, panning never reveals outside the world, and smoothing is
 * frame-rate independent.
 */

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 8;

export interface Point {
  readonly x: number;
  readonly y: number;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export class Camera {
  /** World coordinate shown at the top-left of the viewport. */
  x = 0;
  y = 0;
  /** Screen pixels per world pixel. */
  zoom = 1;

  tx = 0;
  ty = 0;
  tzoom = 1;

  vw = 1;
  vh = 1;
  worldW = 1;
  worldH = 1;

  setViewport(vw: number, vh: number): void {
    this.vw = Math.max(1, vw);
    this.vh = Math.max(1, vh);
  }

  setWorld(worldW: number, worldH: number): void {
    this.worldW = Math.max(1, worldW);
    this.worldH = Math.max(1, worldH);
  }

  /** Zoom at which the whole world fits the viewport. */
  fitZoom(): number {
    return Math.min(this.vw / this.worldW, this.vh / this.worldH);
  }

  /**
   * The zoom floor lets the player always see the whole world, even when that is below the
   * nominal 0.25 floor (a full-world view on a phone is ~0.06).
   */
  minZoom(): number {
    return Math.min(MIN_ZOOM, this.fitZoom());
  }

  maxZoom(): number {
    return MAX_ZOOM;
  }

  fit(): void {
    this.tzoom = this.fitZoom();
    this.tx = (this.worldW - this.vw / this.tzoom) / 2;
    this.ty = (this.worldH - this.vh / this.tzoom) / 2;
    this.clampTarget();
  }

  /** Snap current state to the target (used on world load and after a fly-to). */
  snap(): void {
    this.x = this.tx;
    this.y = this.ty;
    this.zoom = this.tzoom;
  }

  screenToWorld(sx: number, sy: number): Point {
    return { x: this.x + sx / this.zoom, y: this.y + sy / this.zoom };
  }

  worldToScreen(wx: number, wy: number): Point {
    return { x: (wx - this.x) * this.zoom, y: (wy - this.y) * this.zoom };
  }

  private screenToWorldTarget(sx: number, sy: number): Point {
    return { x: this.tx + sx / this.tzoom, y: this.ty + sy / this.tzoom };
  }

  /** Pan by a screen-space delta (a finger drag maps 1:1 to the map). */
  panByScreen(dx: number, dy: number): void {
    this.tx -= dx / this.tzoom;
    this.ty -= dy / this.tzoom;
    this.clampTarget();
  }

  /**
   * Zoom around a screen focal point. The world point under (fx, fy) stays under it, which is
   * the only behaviour that feels correct with two fingers.
   */
  zoomAtScreen(fx: number, fy: number, factor: number): void {
    const before = this.screenToWorldTarget(fx, fy);
    this.tzoom = clamp(this.tzoom * factor, this.minZoom(), this.maxZoom());
    const after = this.screenToWorldTarget(fx, fy);
    this.tx += before.x - after.x;
    this.ty += before.y - after.y;
    this.clampTarget();
  }

  /** Instant zoom for double-tap: keeps the tapped point centred-ish without a jump. */
  zoomToPoint(fx: number, fy: number, zoom: number): void {
    const p = this.screenToWorld(fx, fy);
    this.tzoom = clamp(zoom, this.minZoom(), this.maxZoom());
    this.tx = p.x - fx / this.tzoom;
    this.ty = p.y - fy / this.tzoom;
    this.clampTarget();
  }

  centerOn(wx: number, wy: number, zoom?: number): void {
    if (zoom !== undefined) this.tzoom = clamp(zoom, this.minZoom(), this.maxZoom());
    this.tx = wx - this.vw / (2 * this.tzoom);
    this.ty = wy - this.vh / (2 * this.tzoom);
    this.clampTarget();
  }

  /** Clamp the view (not the centre) so no empty space is ever shown on an axis that overflows. */
  clampTarget(): void {
    this.tzoom = clamp(this.tzoom, this.minZoom(), this.maxZoom());
    const viewW = this.vw / this.tzoom;
    const viewH = this.vh / this.tzoom;
    this.tx = viewW >= this.worldW ? (this.worldW - viewW) / 2 : clamp(this.tx, 0, this.worldW - viewW);
    this.ty = viewH >= this.worldH ? (this.worldH - viewH) / 2 : clamp(this.ty, 0, this.worldH - viewH);
  }

  /** Frame-rate independent exponential smoothing: same feel at 30 and 144 FPS. */
  update(dtSeconds: number, rate = 12): void {
    if (!(dtSeconds > 0)) return;
    const k = 1 - Math.exp(-rate * dtSeconds);
    this.x += (this.tx - this.x) * k;
    this.y += (this.ty - this.y) * k;
    this.zoom += (this.tzoom - this.zoom) * k;
    // current values are clamped too, so a resize cannot leave the map off-screen mid-ease
    const viewW = this.vw / this.zoom;
    const viewH = this.vh / this.zoom;
    this.x = viewW >= this.worldW ? (this.worldW - viewW) / 2 : clamp(this.x, 0, this.worldW - viewW);
    this.y = viewH >= this.worldH ? (this.worldH - viewH) / 2 : clamp(this.y, 0, this.worldH - viewH);
  }

  /** True when the current state is (almost) at its target — used to stop re-rendering idle frames. */
  isSettled(): boolean {
    return (
      Math.abs(this.x - this.tx) < 0.01 &&
      Math.abs(this.y - this.ty) < 0.01 &&
      Math.abs(this.zoom - this.tzoom) < 0.0001
    );
  }
}
