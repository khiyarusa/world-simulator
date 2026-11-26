/**
 * Map pointer controller (Stage 5 refactor): one finger pans, two zoom, tap selects, long-press
 * inspects, double-tap zooms. Kept out of the renderer so the hot input path has one owner and the
 * renderer file stays within the project's size contract.
 */
import type { Camera, Point } from './camera.ts';

export interface MapInputHandlers {
  onTap(world: Point): void;
  onTapEmpty(): void;
  onLongPress?(world: Point): void;
}

interface PointerState {
  id: number;
  x: number;
  y: number;
}

export class MapInput {
  private readonly canvas: HTMLCanvasElement;
  private readonly cam: Camera;
  private readonly handlers: MapInputHandlers;
  private readonly pointers = new Map<number, PointerState>();
  private draggingNow = false;
  private moved = 0;
  private pinchDistance = 0;
  private pinchUsed = false;
  private pinchMid: Point = { x: 0, y: 0 };
  private velX = 0;
  private velY = 0;
  private lastMoveAt = 0;
  private lastTapAt = 0;
  private lastTap: Point = { x: 0, y: 0 };
  private longPressTimer: number | null = null;

  constructor(canvas: HTMLCanvasElement, cam: Camera, handlers: MapInputHandlers) {
    this.canvas = canvas;
    this.cam = cam;
    this.handlers = handlers;
    this.bind();
  }

  get dragging(): boolean {
    return this.draggingNow;
  }

  /** Frame-rate independent momentum, called before the camera's smoothing step. */
  applyInertia(dt: number): void {
    if (this.draggingNow) return;
    if (Math.abs(this.velX) < 0.01 && Math.abs(this.velY) < 0.01) return;
    const decay = Math.exp(-6 * dt);
    this.cam.panByScreen(this.velX * dt * 1000, this.velY * dt * 1000);
    this.velX *= decay;
    this.velY *= decay;
  }

  destroy(): void {
    this.clearLongPress();
    this.pointers.clear();
  }

  private bind(): void {
    const canvas = this.canvas;
    canvas.style.touchAction = 'none';

    canvas.addEventListener('pointerdown', (e: PointerEvent) => {
      canvas.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { id: e.pointerId, x: e.offsetX, y: e.offsetY });
      this.moved = 0;
      this.velX = 0;
      this.velY = 0;
      if (this.pointers.size === 1) {
        this.draggingNow = true;
        this.pinchUsed = false;
        this.startLongPress(e.offsetX, e.offsetY);
      } else if (this.pointers.size === 2) {
        this.pinchUsed = true;
        this.moved = 999;
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
        this.draggingNow = false;
        this.clearLongPress();
        if (wasSingle && this.moved <= 8 && !this.pinchUsed) this.handleTap(e.offsetX, e.offsetY);
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

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
      this.handlers.onLongPress?.(this.cam.screenToWorld(x, y));
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
    if (now - this.lastTapAt < 300 && Math.hypot(x - this.lastTap.x, y - this.lastTap.y) < 24) {
      this.lastTapAt = 0;
      this.cam.zoomToPoint(x, y, Math.min(this.cam.maxZoom(), this.cam.zoom * 2));
      return;
    }
    this.lastTapAt = now;
    this.lastTap = { x, y };
    this.handlers.onTap(world);
  }
}
