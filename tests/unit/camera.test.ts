import { describe, expect, it } from 'vitest';
import { Camera } from '../../src/render/camera.ts';

function camera(worldW = 6144, worldH = 6144): Camera {
  const cam = new Camera();
  cam.setViewport(390, 844);
  cam.setWorld(worldW, worldH);
  cam.fit();
  cam.snap();
  return cam;
}

describe('camera', () => {
  it('fits the whole world and shows no empty space when fitted', () => {
    const cam = camera();
    expect(cam.zoom).toBeCloseTo(cam.fitZoom(), 6);
    expect(cam.x).toBeLessThanOrEqual(0.001);
    expect(cam.x + cam.vw / cam.zoom).toBeGreaterThanOrEqual(6144 - 0.001);
  });

  it('keeps the world point under the pinch focal point', () => {
    const cam = camera();
    cam.zoomToPoint(195, 422, 1.5);
    cam.snap();
    const fx = 210;
    const fy = 300;
    const before = cam.screenToWorld(fx, fy);
    cam.zoomAtScreen(fx, fy, 1.7);
    cam.snap();
    const after = cam.screenToWorld(fx, fy);
    // the contract is 2 screen pixels of error, measured in screen space
    const errX = Math.abs((before.x - after.x) * cam.zoom);
    const errY = Math.abs((before.y - after.y) * cam.zoom);
    expect(errX).toBeLessThanOrEqual(2);
    expect(errY).toBeLessThanOrEqual(2);
  });

  it('never pans outside the world', () => {
    const cam = camera();
    cam.zoomToPoint(195, 422, 2);
    cam.snap();
    cam.panByScreen(50_000, 50_000);
    cam.snap();
    expect(cam.x).toBeGreaterThanOrEqual(-0.001);
    expect(cam.y).toBeGreaterThanOrEqual(-0.001);
    expect(cam.x + cam.vw / cam.zoom).toBeLessThanOrEqual(6144 + 0.001);
    expect(cam.y + cam.vh / cam.zoom).toBeLessThanOrEqual(6144 + 0.001);
  });

  it('centres a world smaller than the viewport', () => {
    const cam = new Camera();
    cam.setViewport(800, 800);
    cam.setWorld(100, 100);
    cam.fit();
    cam.snap();
    expect(cam.x).toBeCloseTo((100 - 800 / cam.zoom) / 2, 5);
    expect(cam.y).toBeCloseTo((100 - 800 / cam.zoom) / 2, 5);
  });

  it('clamps zoom to the allowed range but always allows a full-world view', () => {
    const cam = camera();
    expect(cam.minZoom()).toBeLessThanOrEqual(0.25);
    cam.zoomAtScreen(195, 422, 0.0001);
    expect(cam.tzoom).toBeCloseTo(cam.minZoom(), 6);
    for (let i = 0; i < 40; i++) cam.zoomAtScreen(195, 422, 2);
    expect(cam.tzoom).toBeLessThanOrEqual(cam.maxZoom());
  });

  it('smooths at the same rate regardless of frame rate', () => {
    const a = camera();
    const b = camera();
    a.centerOn(3000, 3000, 0.5);
    b.centerOn(3000, 3000, 0.5);
    a.snap();
    b.snap();
    a.centerOn(4000, 4000, 0.5);
    b.centerOn(4000, 4000, 0.5);
    for (let i = 0; i < 10; i++) a.update(1 / 30);
    for (let i = 0; i < 48; i++) b.update(1 / 144);
    // same elapsed time (1/3 s) must land within 2% of each other
    expect(Math.abs(a.x - b.x) / Math.max(1, a.x)).toBeLessThan(0.02);
    expect(Math.abs(a.zoom - b.zoom)).toBeLessThan(0.02);
  });

  it('settles after enough time', () => {
    const cam = camera();
    cam.centerOn(3000, 3000, 0.4);
    for (let i = 0; i < 200; i++) cam.update(1 / 60);
    expect(cam.isSettled()).toBe(true);
  });
});
