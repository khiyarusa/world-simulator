import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * Grand Stewardship visual QA: the campaign loop plus the premium atlas at local zoom.
 * Real production bundle; the mature world is advanced through the worker's real tick pipeline.
 */
const OUT = 'docs/qa/stewardship';
const SEED = '9E3779B8-00000001';

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 82, animations: 'disabled' });
}

async function closePanel(page: Page): Promise<void> {
  const close = page.locator('.panel.open .panel-head .icon-btn');
  if (await close.count()) await close.click();
}

async function closeBoard(page: Page): Promise<void> {
  const close = page.locator('.board.open .board-close');
  if (await close.count()) await close.click();
}

test('captures the stewardship campaign and the close-detail atlas', async ({ page }) => {
  test.setTimeout(900_000);
  await page.goto(`/?lang=en`);
  await expect(page.locator('.worlds')).toBeVisible();
  await page.getByRole('button', { name: /Create a world/i }).click();
  await page.locator('.mode-card[data-mode="campaign"]').click();
  await expect(page.locator('#create-legacy')).toBeVisible();
  await shot(page, '01-campaign-create');
  await page.locator('#create-name').fill('The Long Stewardship');
  await page.locator('#seed-input').fill(SEED);
  await page.locator('#create-btn').click();
  await page.waitForFunction(() => window.__ws?.state().world === true, undefined, { timeout: 180_000 });
  await expect(page.locator('.board.open')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(500);
  await shot(page, '02-choose-people');
  await page.locator('.civ-choice').first().click();
  await expect(page.locator('.board-hero-stats')).toBeVisible();
  await page.evaluate(() => {
    const skip = [...document.querySelectorAll('.coach button')].find((b) => /Skip/.test(b.textContent ?? ''));
    (skip as HTMLElement | undefined)?.click();
  });
  await page.waitForTimeout(400);
  await shot(page, '03-foundations-board');

  await page.evaluate(() => window.__ws?.advance(65));
  await page.waitForFunction(() => (window.__ws?.state().day ?? 0) >= 65, undefined, { timeout: 180_000 });
  await page.waitForTimeout(600);
  await page.locator('.board-body').evaluate((el) => {
    el.scrollTop = Math.max(0, el.scrollHeight * 0.45);
  });
  await shot(page, '04-objective-offer');
  await page.locator('.charter-pick').first().click();
  await page.locator('.board-body').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await shot(page, '05-charter-choice');

  // Close the board during the long advance: the map can update without a queued campaign query
  // every tick interval. 80 years is enough for cities, infrastructure and a mature steward.
  await closeBoard(page);
  await page.evaluate(() => window.__ws?.advance(80 * 360));
  await page.waitForFunction(() => (window.__ws?.state().day ?? 0) >= 80 * 360, undefined, { timeout: 300_000 });
  await page.waitForTimeout(900);
  await page.evaluate(() => window.__ws?.openCampaign());
  await page.waitForTimeout(500);
  await page.locator('.board-body').evaluate((el) => {
    el.scrollTop = 0;
  });
  await shot(page, '06-mature-board');
  await closeBoard(page);
  await page.waitForTimeout(500);
  await shot(page, '07-mature-steward-map');

  await page.evaluate(() => window.__ws?.focus(0, 2.8));
  await page.waitForTimeout(600);
  await closePanel(page);
  await page.waitForTimeout(900);
  await shot(page, '08-steward-capital-detail');

  await page.evaluate(() => window.__ws?.camera(44, 52, 1.0));
  await page.waitForTimeout(1200);
  await shot(page, '09-high-detail-coast');

  await page.evaluate(() => window.__ws?.openCampaign());
  await page.waitForTimeout(500);
  await page.locator('.board-body').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await shot(page, '10-charter-and-metrics');

  // 200% text at 320 dp through the real settings form
  await closeBoard(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await page.locator('#settings-btn').click();
  await page.locator('.settings .seg').nth(1).getByRole('button').last().click();
  await page.evaluate(() => {
    const close = [...document.querySelectorAll('.sheet.open .sheet-body button')].find((b) => /Close/.test(b.textContent ?? ''));
    (close as HTMLElement | undefined)?.click();
  });
  await page.evaluate(() => window.__ws?.openCampaign());
  await page.waitForTimeout(600);
  await shot(page, '11-large-text-board-320');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  // The Persian pass is a separate test so a language/settings transition cannot burn the
  // campaign test's timeout.
});

test('captures the Persian RTL campaign surface', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/?lang=fa');
  await expect(page.locator('.worlds')).toBeVisible();
  await page.getByRole('button', { name: /ساختن جهان/ }).click();
  await page.locator('.mode-card[data-mode="campaign"]').click();
  await page.locator('#create-name').fill('سرپرستی پارسی');
  await page.locator('#seed-input').fill(SEED);
  await page.locator('#create-btn').click();
  await page.waitForFunction(() => window.__ws?.state().world === true, undefined, { timeout: 180_000 });
  await expect(page.locator('.board.open')).toBeVisible({ timeout: 30_000 });
  await page.locator('.civ-choice').first().click();
  await page.waitForTimeout(700);
  await shot(page, '12-persian-board');
  await page.locator('.board-close').click();
  await page.waitForTimeout(700);
  await shot(page, '13-persian-map');
});
