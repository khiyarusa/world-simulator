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

test('recovers a damaged generation from the previous one and repairs the database', async ({ page }) => {
  await bootToCreation(page);
  await generateWorld(page, 'CAFEBABE-00000003');
  const before = await page.evaluate(() => window.__ws?.state());
  expect(before?.settlements ?? 0).toBeGreaterThan(0);

  // two saves => generation 1 (backup) and generation 2 (current)
  await page.evaluate(() => window.__ws?.save());
  await expect(page.locator('#toast')).toHaveText(/saved/i, { timeout: 30_000 });
  await page.evaluate(() => window.__ws?.save());
  await expect(page.locator('#toast')).toHaveText(/saved/i, { timeout: 30_000 });

  const corrupted = await page.evaluate(async () => {
    const open = (): Promise<IDBDatabase> =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('world-simulator');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const db = await open();
    const doc = await new Promise<{ currentGen: number }>((resolve, reject) => {
      const request = db.transaction('worlds').objectStore('worlds').get('world-1');
      request.onsuccess = () => resolve(request.result as { currentGen: number });
      request.onerror = () => reject(request.error);
    });
    const gen = doc.currentGen;
    if (gen < 2) return { ok: false, gen, reason: 'no backup generation' };

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('shards', 'readwrite');
      const store = tx.objectStore('shards');
      const range = IDBKeyRange.bound(['world-1', gen, ''], ['world-1', gen, '\uffff']);
      const all = store.getAll(range);
      all.onsuccess = () => {
        const rows = all.result as Array<{ name: string; payload: ArrayBuffer }>;
        const terrain = rows.find((r) => r.name === 'terrain');
        if (!terrain) {
          reject(new Error('terrain shard missing'));
          return;
        }
        const bytes = new Uint8Array(terrain.payload.slice(0));
        bytes[Math.floor(bytes.length / 2)] = (bytes[Math.floor(bytes.length / 2)] ?? 0) ^ 0xff;
        terrain.payload = bytes.buffer as ArrayBuffer;
        store.put({ ...terrain, worldId: 'world-1', gen, crc32: 0 });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    return { ok: true, gen };
  });
  expect(corrupted.ok).toBe(true);

  await page.reload();
  await page.waitForFunction(() => window.__ws?.state().world === true, undefined, { timeout: 90_000 });
  await page.waitForFunction(() => /recover/i.test(document.getElementById('toast')?.textContent ?? ''), undefined, {
    timeout: 30_000,
  });

  const after = await page.evaluate(() => window.__ws?.state());
  expect(after?.settlements).toBe(before?.settlements);

  // the damaged generation must be gone, and the world must point at the recovered one
  const repaired = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('world-simulator');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const doc = await new Promise<{ currentGen: number; prevGen: number }>((resolve, reject) => {
      const request = db.transaction('worlds').objectStore('worlds').get('world-1');
      request.onsuccess = () => resolve(request.result as { currentGen: number; prevGen: number });
      request.onerror = () => reject(request.error);
    });
    const gens = await new Promise<number[]>((resolve, reject) => {
      const request = db.transaction('shards').objectStore('shards').getAll();
      request.onsuccess = () => resolve((request.result as Array<{ gen: number }>).map((r) => r.gen));
      request.onerror = () => reject(request.error);
    });
    db.close();
    return { doc, gens: [...new Set(gens)] };
  });
  expect(repaired.doc.prevGen).toBe(0);
  expect(repaired.gens).toEqual([repaired.doc.currentGen]);
});
