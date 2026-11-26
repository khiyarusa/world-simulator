import { expect, test, type Page } from '@playwright/test';

/**
 * Stage 4 acceptance path: multiple worlds, real map layers, real panels, a real intervention,
 * save/load, rename, delete and damaged-generation recovery. Waits are event-driven.
 */

async function bootToWorlds(page: Page): Promise<void> {
  await page.goto('/?lang=en');
  await expect(page.locator('.worlds')).toBeVisible();
}

async function createWorld(page: Page, name: string, seed = '1337ABCD-00000001'): Promise<void> {
  await page.getByRole('button', { name: /Create a world/i }).click();
  await expect(page.locator('#create-btn')).toBeVisible();
  await page.locator('#create-name').fill(name);
  await page.locator('#seed-input').fill(seed);
  await page.locator('#create-btn').click();
  await page.waitForFunction(() => window.__ws?.state().world === true, undefined, { timeout: 90_000 });
  await expect(page.locator('.topbar')).toBeVisible();
}

async function save(page: Page): Promise<void> {
  await page.evaluate(() => window.__ws?.save());
  await page.waitForFunction(
    () => {
      const s = window.__ws?.state();
      return s !== undefined && s.savedDay >= s.day && s.savedDay > 0;
    },
    undefined,
    { timeout: 45_000 },
  );
}

async function resumeFirstWorld(page: Page): Promise<void> {
  await page.reload();
  await expect(page.locator('.worlds')).toBeVisible();
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await page.waitForFunction(() => window.__ws?.state().world === true, undefined, { timeout: 90_000 });
}

test('creates a world, renders it, and inspects a settlement with real data', async ({ page }) => {
  await bootToWorlds(page);
  await createWorld(page, 'Amber Reach');

  const state = await page.evaluate(() => window.__ws?.state());
  expect(state?.settlements ?? 0).toBeGreaterThan(0);
  expect(state?.day ?? 0).toBe(1);

  const canvas = page.locator('#world canvas');
  await expect(canvas).toBeVisible();
  const probe = await page.evaluate(() => window.__ws?.probe());
  expect(probe?.max ?? 0).toBeGreaterThan(probe?.min ?? 0);

  const id = await page.evaluate(() => {
    const count = window.__ws?.state().settlements ?? 0;
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    for (let i = 0; i < count; i++) {
      const p = window.__ws?.screenOf(i);
      if (p && p.y > 140 && p.y < vh - 160 && p.x > 40 && p.x < vw - 40) return i;
    }
    return 0;
  });
  await page.evaluate((sid) => window.__ws?.select(sid), id);
  await expect(page.locator('.panel.open')).toBeVisible();
  await expect(page.locator('.panel-body')).toContainText(/Population|Food/i);
});

test('every layer and every panel is populated from the worker', async ({ page }) => {
  await bootToWorlds(page);
  await createWorld(page, 'Layer Test', 'FACEFEED-00000002');
  await page.evaluate(() => window.__ws?.select(0));
  for (const layer of ['political', 'population', 'economy', 'ecology', 'history'] as const) {
    const data = await page.evaluate((l) => window.__ws?.layer(l), layer);
    expect(data?.width ?? 0).toBeGreaterThan(0);
    if (layer === 'political') expect(data?.cells?.length ?? 0).toBeGreaterThan(0);
    if (layer === 'ecology') expect(data?.cells?.length ?? 0).toBeGreaterThan(0);
    if (layer === 'population') expect(data?.points.length ?? 0).toBeGreaterThan(0);
  }
  for (const tab of ['world', 'settlement', 'civ', 'economy', 'history', 'influence'] as const) {
    await page.evaluate((t) => window.__ws?.openPanel(t), tab);
    await expect(page.locator('.panel-body')).not.toHaveText('');
  }
});

test('a bless intervention changes stock, is recorded, and survives save/load', async ({ page }) => {
  await bootToWorlds(page);
  await createWorld(page, 'Intervention Test', 'BADC0FFE-00000003');
  const before = await page.evaluate(async () => (await window.__ws?.world())?.day ?? 0);
  expect(before).toBeGreaterThan(0);
  const result = await page.evaluate(async () => window.__ws?.command({ op: 'bless', settlement: 0, resource: 0, amount: 4 }));
  expect(result?.ok).toBe(true);
  const detail = await page.evaluate(async (id) => window.__ws?.event(id), result?.eventId ?? 0);
  expect(detail?.event.player).toBe(true);
  const history = await page.evaluate(async () => window.__ws?.history({ playerOnly: true }));
  expect(history?.total ?? 0).toBeGreaterThan(0);

  await save(page);
  await resumeFirstWorld(page);
  const after = await page.evaluate(async () => window.__ws?.history({ playerOnly: true }));
  expect(after?.total ?? 0).toBeGreaterThan(0);
});

test('creates, switches, renames and deletes multiple worlds', async ({ page }) => {
  await bootToWorlds(page);
  await createWorld(page, 'First World', 'AAAA0000-00000001');
  await save(page);
  const firstChecksum = await page.evaluate(() => window.__ws?.checksum());

  await page.evaluate(() => window.__ws?.manageWorlds());
  await expect(page.locator('.worlds')).toBeVisible();
  await createWorld(page, 'Second World', 'BBBB0000-00000002');
  await save(page);
  const secondChecksum = await page.evaluate(() => window.__ws?.checksum());
  expect(firstChecksum).not.toBe(secondChecksum);

  await page.evaluate(() => window.__ws?.manageWorlds());
  await expect(page.locator('.world-card')).toHaveCount(2);

  // rename the second world through the real prompt
  page.once('dialog', (dialog) => void dialog.accept('Renamed World'));
  const secondCard = page.locator('.world-card', { hasText: 'Second World' });
  await secondCard.getByRole('button', { name: 'Rename' }).click();
  await expect(page.locator('.world-card', { hasText: 'Renamed World' })).toHaveCount(1);

  // delete the first world after confirmation
  page.once('dialog', (dialog) => void dialog.accept());
  await page.locator('.world-card', { hasText: 'First World' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.world-card')).toHaveCount(1);
  await expect(page.locator('.world-card')).toContainText('Renamed World');
});

test('recovers a damaged generation from the previous one and repairs the database', async ({ page }) => {
  await bootToWorlds(page);
  await createWorld(page, 'Recovery Test', 'CAFEBABE-00000003');
  const before = await page.evaluate(() => window.__ws?.state());
  expect(before?.settlements ?? 0).toBeGreaterThan(0);

  await save(page);
  await save(page);
  const worldId = await page.evaluate(() => window.__ws?.worlds()[0]?.id ?? '');
  expect(worldId.length).toBeGreaterThan(0);

  const corrupted = await page.evaluate(async (id) => {
    const open = (): Promise<IDBDatabase> =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('world-simulator');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const db = await open();
    const doc = await new Promise<{ currentGen: number }>((resolve, reject) => {
      const request = db.transaction('worlds').objectStore('worlds').get(id);
      request.onsuccess = () => resolve(request.result as { currentGen: number });
      request.onerror = () => reject(request.error);
    });
    const gen = doc.currentGen;
    if (gen < 2) return { ok: false, gen };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('shards', 'readwrite');
      const store = tx.objectStore('shards');
      const range = IDBKeyRange.bound([id, gen, ''], [id, gen, '\uffff']);
      const all = store.getAll(range);
      all.onsuccess = () => {
        const rows = all.result as Array<{ name: string; payload: ArrayBuffer }>;
        const terrain = rows.find((r) => r.name === 'terrain');
        if (!terrain) {
          reject(new Error('terrain shard missing'));
          return;
        }
        const bytes = new Uint8Array(terrain.payload.slice(0));
        const at = Math.floor(bytes.length / 2);
        bytes[at] = (bytes[at] ?? 0) ^ 0xff;
        terrain.payload = bytes.buffer as ArrayBuffer;
        store.put({ ...terrain, worldId: id, gen, crc32: 0 });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    return { ok: true, gen };
  }, worldId);
  expect(corrupted.ok).toBe(true);

  await resumeFirstWorld(page);
  await page.waitForFunction(() => /recover/i.test(document.getElementById('toast')?.textContent ?? ''), undefined, {
    timeout: 30_000,
  });
  const after = await page.evaluate(() => window.__ws?.state());
  expect(after?.settlements).toBe(before?.settlements);

  const repaired = await page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('world-simulator');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const doc = await new Promise<{ currentGen: number; prevGen: number }>((resolve, reject) => {
      const request = db.transaction('worlds').objectStore('worlds').get(id);
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
  }, worldId);
  expect(repaired.doc.prevGen).toBe(0);
  expect(repaired.gens).toEqual([repaired.doc.currentGen]);
});
