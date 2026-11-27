import { expect, test, type Page } from '@playwright/test';

/** The stewardship loop through the real UI: setup, objective, charter, save and reload. */
async function createCampaign(page: Page): Promise<void> {
  await page.goto('/?lang=en');
  await expect(page.locator('.worlds')).toBeVisible();
  await page.getByRole('button', { name: /Create a world/i }).click();
  await page.locator('.mode-card[data-mode="campaign"]').click();
  await expect(page.locator('#create-legacy')).toBeVisible();
  await page.locator('#create-name').fill('Stewardship Test');
  await page.locator('#seed-input').fill('9E3779B8-00000001');
  await page.locator('#create-btn').click();
  await page.waitForFunction(() => window.__ws?.state().world === true, undefined, { timeout: 120_000 });
  await expect(page.locator('.board.open')).toBeVisible({ timeout: 30_000 });
}

test('the stewardship loop sets a people, accepts a real objective and issues a charter', async ({ page }) => {
  test.setTimeout(240_000);
  await createCampaign(page);
  await expect(page.locator('.civ-choice').first()).toBeVisible();
  await page.locator('.civ-choice').first().click();
  await expect(page.locator('.board-hero-stats')).toBeVisible();
  await expect(page.locator('.legacy-strip')).toBeVisible();
  const begun = await page.evaluate(() => window.__ws?.campaign() ?? null);
  expect(begun?.mode).toBe(1);
  expect(begun?.legacy).toBe(1);
  expect(begun?.targetCiv ?? -1).toBeGreaterThanOrEqual(0);

  await page.evaluate(() => window.__ws?.advance(65));
  await page.waitForFunction(() => (window.__ws?.state().day ?? 0) >= 65, undefined, { timeout: 120_000 });
  const offered = await page.evaluate(() => window.__ws?.campaign() ?? null);
  const offer = offered?.objectives.find((o) => o.state === 1);
  if (offer) {
    await page.locator('.objective-card').getByRole('button', { name: 'Accept' }).first().click();
    await expect
      .poll(async () => {
        const view = await page.evaluate(() => window.__ws?.campaign() ?? null);
        return view?.objectives.find((o) => o.id === offer.id)?.state;
      })
      .toBe(2);
  }

  await page.locator('.charter-pick').first().click();
  await page.getByRole('button', { name: 'Issue charter' }).click();
  await expect
    .poll(async () => (await page.evaluate(() => window.__ws?.campaign() ?? null))?.charters.length ?? 0)
    .toBe(1);

  await page.evaluate(() => window.__ws?.save());
  await page.waitForFunction(
    () => {
      const s = window.__ws?.state();
      return s !== undefined && s.savedDay >= s.day && s.savedDay > 0;
    },
    undefined,
    { timeout: 60_000 },
  );
  await page.reload();
  await expect(page.locator('.worlds')).toBeVisible();
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await page.waitForFunction(() => window.__ws?.state().world === true, undefined, { timeout: 120_000 });
  const restored = await page.evaluate(() => window.__ws?.campaign() ?? null);
  expect(restored?.mode).toBe(1);
  expect(restored?.legacy).toBe(1);
  expect(restored?.targetCiv).toBe(begun?.targetCiv);
  expect(restored?.charters.length).toBe(1);
});

test('a sandbox world stays free of campaign chrome and campaign pauses', async ({ page }) => {
  await page.goto('/?lang=en');
  await expect(page.locator('.worlds')).toBeVisible();
  await page.getByRole('button', { name: /Create a world/i }).click();
  await page.locator('#create-name').fill('Sandbox Still Works');
  await page.locator('#seed-input').fill('1337ABCD-00000001');
  await page.locator('#create-btn').click();
  await page.waitForFunction(() => window.__ws?.state().world === true, undefined, { timeout: 120_000 });
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.locator('.legacy-strip')).toBeHidden();
  const view = await page.evaluate(() => window.__ws?.campaign() ?? null);
  expect(view?.mode).toBe(0);
  expect(view?.targetCiv).toBe(255);
});
