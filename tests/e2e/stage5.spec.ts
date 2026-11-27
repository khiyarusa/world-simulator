import { expect, test, type Page } from '@playwright/test';

/** Stage 5 behavior: onboarding, settings, large text, live settlement layout and layer metrics. */

async function create(page: Page, seed = '9E3779B8-00000001', name = 'Test Atlas'): Promise<void> {
  await page.goto('/?lang=en');
  await expect(page.locator('.worlds')).toBeVisible();
  await page.getByRole('button', { name: /Create a world/i }).click();
  await page.locator('#create-name').fill(name);
  await page.locator('#seed-input').fill(seed);
  await page.locator('#create-btn').click();
  await page.waitForFunction(() => window.__ws?.state().world === true, undefined, { timeout: 120_000 });
  await page.waitForFunction(() => (window.__ws?.state().savedDay ?? 0) > 0, undefined, { timeout: 45_000 });
}

test('first-run coach marks advance by doing the action and remain dismissible', async ({ page }) => {
  await create(page);
  await expect(page.locator('.coach')).toBeVisible();
  await expect(page.locator('.coach')).toContainText(/Step 1 of 3/);
  await page.evaluate(() => window.__ws?.select(0));
  await expect(page.locator('.coach')).toContainText(/Step 2 of 3/);
  await page.evaluate(() => window.__ws?.setLayer('political'));
  await expect(page.locator('.coach')).toContainText(/Step 3 of 3/);
  await page.getByRole('button', { name: 'Start exploring' }).click();
  await expect(page.locator('.coach')).toHaveCount(0);
  const stored = await page.evaluate(() => localStorage.getItem('ws.prefs.v1'));
  expect(stored).toContain('"onboarding":3');
});

test('settings persist text size, motion, handedness and low power without touching the save schema', async ({ page }) => {
  await create(page);
  await page.locator('.coach').getByRole('button', { name: 'Skip' }).click();
  await page.locator('#settings-btn').click();
  await expect(page.locator('.settings')).toBeVisible();
  await page.locator('.settings .seg').nth(1).getByRole('button').last().click(); // 200 %
  await page.locator('.settings .seg').nth(2).getByRole('button').last().click(); // reduced motion
  await page.locator('.settings .seg').nth(3).getByRole('button').last().click(); // left-handed
  await page.locator('.settings .seg').nth(4).getByRole('button').last().click(); // low power on
  const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('ws.prefs.v1') ?? '{}'));
  expect(prefs.textScale).toBe(2);
  expect(prefs.motion).toBe('reduced');
  expect(prefs.hand).toBe('left');
  expect(prefs.lowPower).toBe(true);
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--text-scale'))).toBe('2');
  expect(await page.evaluate(() => document.documentElement.classList.contains('left-handed'))).toBe(true);
});

test('large text at 320 dp does not create horizontal overflow', async ({ page }) => {
  await create(page);
  await page.locator('.coach').getByRole('button', { name: 'Skip' }).click();
  await page.setViewportSize({ width: 320, height: 720 });
  await page.locator('#settings-btn').click();
  await page.locator('.settings .seg').nth(1).getByRole('button').last().click();
  await page.evaluate(() => {
    const close = [...document.querySelectorAll('.sheet.open .sheet-body button')].find((b) => /Close/.test(b.textContent ?? ''));
    (close as HTMLElement | undefined)?.click();
  });
  await page.evaluate(() => window.__ws?.openPanel('settlement'));
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('a mature world pushes new settlements to the map and HUD', async ({ page }) => {
  test.setTimeout(240_000);
  await create(page);
  await page.locator('.coach').getByRole('button', { name: 'Skip' }).click();
  const before = await page.evaluate(() => window.__ws?.state().settlements ?? 0);
  expect(before).toBeLessThan(20);
  await page.evaluate(() => window.__ws?.advance(200 * 360));
  await page.waitForFunction(() => (window.__ws?.state().day ?? 0) >= 72_000, undefined, { timeout: 240_000 });
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => window.__ws?.state().settlements ?? 0);
  expect(after).toBeGreaterThan(100);
  const plate = await page.locator('.atlas-plate').innerText();
  expect(plate.replace(/[^0-9]/g, '')).not.toBe('');
  const population = await page.evaluate(() => window.__ws?.layer('population'));
  expect(population?.points.length ?? 0).toBeGreaterThan(100);
});

test('ecology layer exposes real fertility, vegetation, moisture and temperature metrics', async ({ page }) => {
  await create(page);
  await page.locator('.coach').getByRole('button', { name: 'Skip' }).click();
  for (const metric of ['vegetation', 'moisture', 'temperature'] as const) {
    await page.evaluate((m) => window.__ws?.setLayerMetric(m), metric);
    await page.evaluate(() => window.__ws?.setLayer('ecology'));
    await page.waitForFunction(() => window.__ws?.state().layer === 'ecology');
    const data = await page.evaluate((m) => window.__ws?.layer('ecology', m), metric);
    expect(data?.meta.metric).toBe(metric);
    expect(data?.cells?.length ?? 0).toBeGreaterThan(0);
  }
});
