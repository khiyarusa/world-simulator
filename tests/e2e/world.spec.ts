import { expect, test, type Page } from '@playwright/test';

/**
 * The Stage 2 acceptance path, end to end (docs/QA_AND_CI_STRATEGY.md §4.3).
 * Waits are event-driven: no fixed sleeps, no arbitrary timeouts.
 */

async function bootToCreation(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#create-btn')).toBeVisible();
}

async function generateWorld(page: Page, seed = '1337ABCD-00000001'): Promise<void> {
  await page.locator('#seed-input').fill(seed);
  await page.locator('#create-btn').click();
  await page.waitForFunction(() => window.__ws?.state().world === true, undefined, { timeout: 90_000 });
  await expect(page.locator('#boot')).toHaveClass(/hidden/);
}

test('creates a world, renders it, and inspects a settlement', async ({ page }) => {
  await bootToCreation(page);
  await generateWorld(page);

  const state = await page.evaluate(() => window.__ws?.state());
  expect(state?.settlements ?? 0).toBeGreaterThan(0);
  expect(state?.day ?? 0).toBe(1);

  // canvas exists, has real dimensions, and the GL framebuffer is not a flat colour
  const canvas = page.locator('#world canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(100);
  expect(box?.height ?? 0).toBeGreaterThan(100);

  const probe = await page.evaluate(() => window.__ws?.probe());
  expect(probe?.max ?? 0).toBeGreaterThan(probe?.min ?? 0);

  // At the fit zoom the world exactly fills the view, so panning is clamped by design.
  // Zoom in first (double tap), then the map can actually move.
  const zoomBefore = await page.evaluate(() => window.__ws?.state().zoom ?? 0);
  await page.mouse.dblclick(195, 420);
  await page.waitForFunction(
    (z) => (window.__ws?.state().zoom ?? 0) > z * 1.2,
    zoomBefore,
    { timeout: 10_000 },
  );

  // pan: drag the map and confirm the camera actually moved via the rendered result
  const before = await page.evaluate(() => window.__ws?.probe());
  await page.mouse.move(200, 400);
  await page.mouse.down();
  await page.mouse.move(120, 330, { steps: 8 });
  await page.mouse.up();
  const after = await page.evaluate(() => window.__ws?.probe());
  expect(after).not.toEqual(before);

  // Select a settlement that is not hidden under the HUD (the dock owns the bottom band and the
  // top bar the top band), using the public projection helper.
  const pos = await page.evaluate(() => {
    const count = window.__ws?.state().settlements ?? 0;
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    for (let id = 0; id < count; id++) {
      const p = window.__ws?.screenOf(id);
      if (!p) continue;
      if (p.y > 140 && p.y < vh - 160 && p.x > 40 && p.x < vw - 40) return p;
    }
    return null;
  });
  expect(pos).not.toBeNull();
  if (!pos) return;
  await page.mouse.click(pos.x, pos.y);
  await expect(page.locator('.chip')).toBeVisible();

  // the chip opens the settlement sheet with real data
  await page.locator('.chip').click();
  await expect(page.locator('.sheet.open')).toBeVisible();
  await expect(page.locator('.sheet.open h2')).not.toHaveText('');
});

test('controls simulation speed and persists the world across a reload', async ({ page }) => {
  await bootToCreation(page);
  await generateWorld(page, 'FEEDFACE-00000002');

  const created = await page.evaluate(() => window.__ws?.state());
  expect(created?.settlements ?? 0).toBeGreaterThan(0);

  // speed dial -> 4x
  await page.locator('.dock-btn.speed').click();
  await page.locator('.sheet.open button', { hasText: '4×' }).click();
  await page.waitForFunction(() => window.__ws?.state().speed === 4);

  // let the clock advance, then save explicitly
  await page.waitForFunction(() => (window.__ws?.state().day ?? 1) > 1, undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__ws?.save());
  await expect(page.locator('#toast')).toHaveText(/saved/i, { timeout: 30_000 });

  const beforeReload = await page.evaluate(() => window.__ws?.state());
  expect(beforeReload?.day ?? 0).toBeGreaterThan(1);

  // reload: the world must come back, with the same settlement count and at least the same day
  await page.reload();
  await page.waitForFunction(() => window.__ws?.state().world === true, undefined, { timeout: 90_000 });
  const afterReload = await page.evaluate(() => window.__ws?.state());
  expect(afterReload?.settlements).toBe(beforeReload?.settlements);
  expect(afterReload?.day ?? 0).toBeGreaterThanOrEqual(beforeReload?.day ?? 0);
});

test('generates different worlds from different seeds', async ({ page }) => {
  await bootToCreation(page);
  await generateWorld(page, 'AAAA0000-00000001');
  const first = await page.evaluate(() => window.__ws?.checksum());

  // create a second world from a different seed
  await page.locator('.dock-btn', { hasText: 'New' }).click();
  await expect(page.locator('#create-btn')).toBeVisible();
  await page.locator('#seed-input').fill('BBBB0000-00000002');
  await page.locator('#create-btn').click();
  await page.waitForFunction(() => window.__ws?.state().world === true, undefined, { timeout: 90_000 });
  const second = await page.evaluate(() => window.__ws?.checksum());

  expect(first).toBeGreaterThan(0);
  expect(second).not.toBe(first);
});
