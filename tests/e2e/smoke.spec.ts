import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page): Promise<void> {
  await page.goto('/?lang=en');
  await expect(page.locator('.worlds')).toBeVisible();
}

async function createWorld(page: Page, seed = '1337ABCD-00000001'): Promise<void> {
  await page.getByRole('button', { name: /Create a world/i }).click();
  await expect(page.locator('#create-btn')).toBeVisible();
  await page.locator('#seed-input').fill(seed);
  await page.locator('#create-btn').click();
  await page.waitForFunction(() => window.__ws?.state().world === true, undefined, { timeout: 90_000 });
  await expect(page.locator('.topbar')).toBeVisible();
}

test('boots to world selection and creates a playable world', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await boot(page);
  await createWorld(page);
  const state = await page.evaluate(() => window.__ws?.state());
  expect(state?.settlements ?? 0).toBeGreaterThan(0);
  expect(state?.day ?? 0).toBe(1);
  const probe = await page.evaluate(() => window.__ws?.probe());
  expect(probe?.max ?? 0).toBeGreaterThan(probe?.min ?? 0);
  expect(errors).toEqual([]);
});

test('six layers and all six panels open with real data', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await boot(page);
  await createWorld(page, 'FEEDFACE-00000002');

  // Ecology stays last: choosing it keeps the sheet open for its metric switch, so the next dock
  // tap would otherwise race the closing animation on a slow machine.
  for (const layer of ['political', 'population', 'economy', 'history', 'ecology']) {
    await page.locator('.dock-btn').first().click();
    await expect(page.locator('.sheet.open')).toBeVisible();
    await expect(page.locator('.layer-row')).toHaveCount(6);
    await page.locator('.layer-row', { hasText: new RegExp(layer, 'i') }).click();
    await page.waitForFunction((l) => window.__ws?.state().layer === l, layer);
  }
  await page.evaluate(() => window.__ws?.setLayer('terrain'));
  // The ecology sheet is still open by design; a player closes it before inspecting the map.
  await page.evaluate(() => {
    const close = [...document.querySelectorAll('.sheet.open .sheet-body button')].find((b) =>
      /Close/.test(b.textContent ?? ''),
    );
    (close as HTMLElement | undefined)?.click();
  });

  await page.evaluate(() => window.__ws?.select(0));
  await expect(page.locator('.panel.open')).toBeVisible();
  await expect(page.locator('.panel-body')).not.toHaveText('');

  for (const tab of ['world', 'civ', 'economy', 'history', 'influence', 'settlement'] as const) {
    await page.evaluate((t) => window.__ws?.openPanel(t), tab);
    await expect(page.locator('.tab.active')).toHaveCount(1);
    await expect(page.locator('.panel-body')).not.toHaveText('');
  }
  expect(errors).toEqual([]);
});

test('a player intervention is applied by the worker and appears in history', async ({ page }) => {
  await boot(page);
  await createWorld(page, 'CAFEBABE-00000003');
  const result = await page.evaluate(async () => {
    const id = 0;
    return window.__ws?.command({ op: 'bless', settlement: id, resource: 0, amount: 2 });
  });
  expect(result?.ok).toBe(true);
  const detail = await page.evaluate(async (eventId) => window.__ws?.event(eventId), result?.eventId ?? 0);
  expect(detail?.event.player).toBe(true);
  const history = await page.evaluate(async () => window.__ws?.history({ playerOnly: true }));
  expect(history?.total ?? 0).toBeGreaterThan(0);
});
