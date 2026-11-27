import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * Stage 5 visual QA. Every image is the real production application, captured at 390×844 CSS px and
 * DPR 2 unless a layout variant says otherwise. The mature scenario is created by the real worker
 * pipeline through the QA-only `advance` command (no fake state, no injected values).
 */
const OUT = 'docs/qa/stage5';
const SEED = '9E3779B8-00000001'; // the Stage 3 balance seed: reaches 200 settlements by year 200

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 76, animations: 'disabled' });
}

async function waitDay(page: Page, day: number): Promise<void> {
  await page.waitForFunction((d) => (window.__ws?.state().day ?? 0) >= d, day, { timeout: 240_000 });
}

async function closePanel(page: Page): Promise<void> {
  const close = page.locator('.panel.open .panel-head .icon-btn');
  if (await close.count()) await close.click();
}

async function closeSheet(page: Page): Promise<void> {
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.sheet.open .sheet-body button')];
    const close = buttons.find((b) => /بستن|Close/.test(b.textContent ?? ''));
    (close as HTMLElement | undefined)?.click();
  });
}

test('captures the living atlas across fresh, mature, conflict and stress scenarios', async ({ page }) => {
  await page.goto('/?lang=fa');
  await expect(page.locator('.worlds')).toBeVisible();
  await shot(page, '01-worlds-empty');

  await page.getByRole('button', { name: /ساختن جهان/ }).click();
  await expect(page.locator('#create-btn')).toBeVisible();
  await page.locator('#create-name').fill('اطلس زنده');
  await page.locator('#seed-input').fill(SEED);
  await page.getByRole('button', { name: /پیش‌نمایش/ }).click();
  await expect(page.locator('#preview-canvas')).toBeVisible();
  await shot(page, '02-world-creation');

  await page.locator('#create-btn').click();
  await page.waitForFunction(() => window.__ws?.state().world === true, undefined, { timeout: 120_000 });
  await page.waitForFunction(() => (window.__ws?.state().savedDay ?? 0) > 0, undefined, { timeout: 45_000 });
  await page.waitForTimeout(1_800);
  await shot(page, '03-onboarding');
  await page.getByRole('button', { name: /رد کردن/ }).click();
  await page.waitForTimeout(350);
  await shot(page, '04-fresh-map');

  // Mature world: 200 simulated years through the real tick pipeline.
  await page.evaluate(() => window.__ws?.advance(200 * 360));
  await waitDay(page, 200 * 360);
  await page.waitForTimeout(900);
  await shot(page, '05-mature-map');
  const world = await page.evaluate(() => window.__ws?.world());
  expect(world?.livingSettlements ?? 0).toBeGreaterThan(100);

  const layers: Array<[string, string, string?]> = [
    ['political', '06-mature-political'],
    ['population', '07-mature-population'],
    ['economy', '08-mature-economy'],
    ['ecology', '09-mature-ecology-fertility', 'fertility'],
    ['ecology', '10-mature-ecology-vegetation', 'vegetation'],
    ['ecology', '11-mature-ecology-moisture', 'moisture'],
    ['history', '12-mature-history'],
  ];
  for (const [layer, file, metric] of layers) {
    if (metric) await page.evaluate((m) => window.__ws?.setLayerMetric(m as never), metric);
    await page.evaluate((l) => window.__ws?.setLayer(l as never), layer);
    await page.waitForFunction((l) => window.__ws?.state().layer === l, layer);
    await page.waitForTimeout(550);
    await shot(page, file);
  }
  await page.evaluate(() => window.__ws?.setLayer('terrain'));

  const population = await page.evaluate(() => window.__ws?.layer('population'));
  const target = population?.points.find((p) => p.kind < 9)?.id ?? 0;
  await page.evaluate((id) => window.__ws?.select(id), target);
  await expect(page.locator('.panel.open')).toBeVisible();
  await page.waitForTimeout(450);
  await shot(page, '13-panel-settlement');

  for (const [tab, file] of [
    ['civ', '14-panel-civilization'],
    ['economy', '15-panel-economy'],
    ['influence', '16-panel-influence'],
    ['world', '17-panel-world'],
  ] as const) {
    await page.evaluate((t) => window.__ws?.openPanel(t), tab);
    await page.waitForTimeout(500);
    await shot(page, file);
  }

  // Why? / causal detail from a real player intervention.
  const bless = await page.evaluate(async (id) => window.__ws?.command({ op: 'bless', settlement: id, resource: 0, amount: 4 }), target);
  expect(bless?.ok).toBe(true);
  await page.evaluate((id) => window.__ws?.showEvent(id), bless?.eventId ?? 0);
  await page.waitForTimeout(500);
  await shot(page, '18-event-causality');

  await page.evaluate(() => window.__ws?.openPanel('history'));
  await page.getByRole('button', { name: /سال‌نامه/ }).click();
  await page.waitForTimeout(500);
  await shot(page, '19-chronicle');
  await closePanel(page);
  await page.mouse.click(24, 420);
  await page.waitForTimeout(250);

  // Political conflict: advance until the simulation has actually declared a war.
  let conflict = await page.evaluate(() => window.__ws?.world());
  let guard = 0;
  while ((conflict?.counters.warsDeclared ?? 0) === 0 && guard < 5) {
    const before = conflict?.day ?? 0;
    await page.evaluate(() => window.__ws?.advance(50 * 360));
    await waitDay(page, before + 50 * 360);
    conflict = await page.evaluate(() => window.__ws?.world());
    guard++;
  }
  // Ensure the political capture contains a real active-war edge, not just a historical count.
  await page.evaluate(() => window.__ws?.setLayer('political'));
  let political = await page.evaluate(() => window.__ws?.layer('political'));
  let warGuard = 0;
  while (!(political?.lines ?? []).some((line) => line.kind === 1) && warGuard < 6) {
    const before = conflict?.day ?? 0;
    await page.evaluate(() => window.__ws?.advance(10 * 360));
    await waitDay(page, before + 10 * 360);
    political = await page.evaluate(() => window.__ws?.layer('political'));
    warGuard++;
  }
  await page.evaluate(() => window.__ws?.setLayer('political'));
  await page.waitForTimeout(700);
  await shot(page, '20-political-conflict');

  // Ecological stress: a real Blight command + a season of real consequences.
  const stress = await page.evaluate(async (id) => window.__ws?.command({ op: 'blight', settlement: id, intensity: 2, durationDays: 180 }), target);
  if (stress?.ok) {
    await page.evaluate(() => window.__ws?.advance(45));
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__ws?.setLayerMetric('fertility'));
    await page.evaluate(() => window.__ws?.setLayer('ecology'));
    await page.waitForTimeout(600);
    await shot(page, '21-ecological-stress');
    await page.evaluate(() => window.__ws?.setLayer('economy'));
    await page.waitForTimeout(600);
    await shot(page, '22-economic-stress');
  }

  // Settings + large text.
  await page.evaluate(() => window.__ws?.setLayer('terrain'));
  await page.locator('#settings-btn').click();
  await expect(page.locator('.sheet.open')).toBeVisible();
  await page.waitForTimeout(350);
  await shot(page, '23-settings');
  const scale = page.locator('.settings .seg').nth(1).getByRole('button').last();
  await scale.click();
  await page.waitForTimeout(500);
  await closeSheet(page);
  await page.evaluate(() => window.__ws?.openPanel('settlement'));
  await page.waitForTimeout(500);
  await shot(page, '24-large-text-200');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.locator('#settings-btn').click();
  await page.locator('.settings .seg').nth(1).getByRole('button').first().click();
  await closeSheet(page);
  await closePanel(page);

  // Narrow and landscape layouts.
  await page.setViewportSize({ width: 320, height: 720 });
  await page.waitForTimeout(500);
  await shot(page, '25-narrow-320');
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(400);
  await shot(page, '26-landscape');
  await page.evaluate(() => window.__ws?.openPanel('world'));
  await page.waitForTimeout(500);
  await shot(page, '26b-landscape-panel');
  await closePanel(page);
  await page.setViewportSize({ width: 390, height: 844 });

  // English LTR.
  await page.locator('#settings-btn').click();
  await page.locator('.settings .seg').first().getByRole('button').nth(1).click();
  await closeSheet(page);
  await page.evaluate(() => window.__ws?.openPanel('world'));
  await page.waitForTimeout(550);
  await shot(page, '27-world-panel-english');
  await closePanel(page);
  await shot(page, '28-map-english');

  // Persist and show the saved-world list in both languages.
  await page.evaluate(() => window.__ws?.save());
  await page.waitForTimeout(1_200);
  await page.evaluate(() => window.__ws?.manageWorlds());
  await expect(page.locator('.worlds')).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, '29-worlds-english');
  await page.locator('.worlds .seg').first().getByRole('button').first().click();
  await page.waitForTimeout(500);
  await shot(page, '30-worlds-persian');
});
