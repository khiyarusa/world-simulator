import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * Visual QA (Stage 4 WP10.4). Every image is a capture of the real running application.
 * Run with `npm run test:visual`; CI uploads the folder as an artifact.
 */
const OUT = 'docs/qa/stage4';

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 74, animations: 'disabled' });
}

async function pickVisibleSettlement(page: Page): Promise<number> {
  return page.evaluate(() => {
    const count = window.__ws?.state().settlements ?? 0;
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    for (let id = 0; id < count; id++) {
      const p = window.__ws?.screenOf(id);
      if (!p) continue;
      if (p.y > 120 && p.y < vh - 150 && p.x > 30 && p.x < vw - 30) return id;
    }
    return 0;
  });
}

test('captures the complete Stage 4 experience', async ({ page }) => {
  await page.goto('/?lang=fa');
  await expect(page.locator('.worlds')).toBeVisible();
  await shot(page, '01-worlds-empty');

  await page.getByRole('button', { name: /ساختن جهان/ }).click();
  await expect(page.locator('#create-btn')).toBeVisible();
  await page.locator('#seed-input').fill('A11CE000-00000004');
  await page.getByRole('button', { name: /پیش‌نمایش/ }).click();
  await expect(page.locator('#preview-canvas')).toBeVisible();
  await shot(page, '02-world-creation');

  await page.locator('#create-btn').click();
  await page.waitForFunction(() => window.__ws?.state().world === true, undefined, { timeout: 90_000 });
  await expect(page.locator('.topbar')).toBeVisible();
  // run a little history so the map, the feed and the chronicle have real events to show
  await page.locator('.dock-btn.speed').click();
  await page.getByRole('button', { name: /۸×/ }).click();
  await page.waitForFunction(() => (window.__ws?.state().day ?? 0) > 1080, undefined, { timeout: 120_000 });
  await page.locator('.dock-btn.speed').click();
  await page.getByRole('button', { name: /توقف/ }).click();
  await page.waitForTimeout(700);
  await shot(page, '03-main-map-terrain');

  for (const [layer, file] of [
    ['political', '04-layer-political'],
    ['population', '05-layer-population'],
    ['economy', '06-layer-economy'],
    ['ecology', '07-layer-ecology'],
    ['history', '08-layer-history'],
  ] as const) {
    await page.locator('.dock-btn').first().click();
    await page.locator('.layer-row', { hasText: layerName(layer) }).click();
    await page.waitForFunction((l) => window.__ws?.state().layer === l, layer);
    await page.waitForTimeout(350);
    await shot(page, file);
  }
  await page.evaluate(() => window.__ws?.setLayer('terrain'));

  const id = await pickVisibleSettlement(page);
  await page.evaluate((sid) => window.__ws?.select(sid), id);
  await expect(page.locator('.panel.open')).toBeVisible();
  await page.waitForTimeout(300);
  await shot(page, '09-panel-settlement');

  for (const [tab, file] of [
    ['civ', '10-panel-civilization'],
    ['economy', '11-panel-economy'],
    ['history', '12-panel-history'],
    ['influence', '13-panel-influence'],
    ['world', '14-panel-world'],
  ] as const) {
    await page.locator('.tab', { hasText: tabName(tab) }).click();
    await page.waitForTimeout(350);
    await shot(page, file);
  }

  // a real player command, then the causal detail of the event it produced
  const result = await page.evaluate(async (sid) => window.__ws?.command({ op: 'bless', settlement: sid, resource: 0, amount: 3 }), id);
  expect(result?.ok).toBe(true);
  await page.evaluate((eventId) => window.__ws?.showEvent(eventId), result?.eventId ?? 0);
  await page.waitForTimeout(350);
  await shot(page, '15-event-causality');

  await page.locator('.tab', { hasText: tabName('history') }).click();
  await page.getByRole('button', { name: /سال‌نامه/ }).click();
  await page.waitForTimeout(400);
  await shot(page, '16-chronicle');

  // English is a real second language, not a mock: switch from the world panel and re-capture
  await page.locator('.tab', { hasText: tabName('world') }).click();
  await page.getByRole('button', { name: 'English' }).click();
  await page.waitForTimeout(400);
  await shot(page, '17-world-panel-english');
  await page.locator('.panel-head .icon-btn').click();
  await shot(page, '18-main-map-english');

  // persist and capture the world list with the real thumbnail
  await page.evaluate(() => window.__ws?.save());
  await page.waitForTimeout(1200);
  const worlds = await page.evaluate(() => window.__ws?.worlds().map((w) => w.name) ?? []);
  expect(worlds.length).toBeGreaterThan(0);
  await page.evaluate(() => window.__ws?.manageWorlds());
  await expect(page.locator('.worlds')).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, '19-worlds-saved');
});

function layerName(layer: string): RegExp {
  const map: Record<string, RegExp> = {
    political: /سیاسی/,
    population: /جمعیت/,
    economy: /اقتصاد/,
    ecology: /بوم‌شناسی/,
    history: /تاریخ/,
  };
  return map[layer] ?? new RegExp(layer);
}

function tabName(tab: string): RegExp {
  const map: Record<string, RegExp> = {
    world: /^جهان$/,
    civ: /^تمدن$/,
    economy: /^اقتصاد$/,
    history: /^تاریخ$/,
    influence: /^نفوذ$/,
  };
  return map[tab] ?? new RegExp(tab);
}
