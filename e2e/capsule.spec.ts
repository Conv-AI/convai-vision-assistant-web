import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/gallery.html');
  await page.getByRole('heading', { name: 'Capsule' }).scrollIntoViewIfNeeded();
});

const capsule = (page: import('@playwright/test').Page, id: string) =>
  page.locator(`[data-capsule="${id}"] .convai-capsule`);

test('the capsule is 420 × 64 on surface.island with its edge, and grows with text size', async ({
  page,
}) => {
  const ready = capsule(page, 'K1a');
  const box = await ready.boundingBox();
  expect(box && [Math.round(box.width), Math.round(box.height)]).toEqual([420, 64]);
  await expect(ready).toHaveCSS('background-color', 'rgb(5, 5, 6)');
  await expect(ready).toHaveCSS('border-top-color', 'rgb(38, 38, 43)');
  await page.getByLabel('Text size').selectOption('1.3');
  const grown = await ready.boundingBox();
  expect(grown && Math.round(grown.height)).toBe(83);
});

test('its Lens is a button named by what a click does', async ({ page }) => {
  const ready = capsule(page, 'K1b');
  await expect(ready.getByRole('button', { name: 'Mute' })).toHaveAttribute(
    'aria-keyshortcuts',
    'M',
  );
  await expect(capsule(page, 'K1f').getByRole('button', { name: 'Stop' })).toBeVisible();
});

test('a problem replaces the tools with its action: Reconnect offline', async ({ page }) => {
  const offline = capsule(page, 'K1i');
  await expect(offline.getByRole('button', { name: 'Reconnect' })).toBeVisible();
  await expect(offline.getByRole('button', { name: 'Type' })).toHaveCount(0);
});

test('a long label ends with an ellipsis and keeps the tools', async ({ page }) => {
  const unavailable = capsule(page, 'K1j');
  await page.setViewportSize({ width: 560, height: 900 });
  await page.getByLabel('Text size').selectOption('1.3');
  const label = unavailable.locator('.convai-capsule__label');
  expect(await label.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
  await expect(label).toHaveCSS('text-overflow', 'ellipsis');
  const [box, action] = await Promise.all([
    unavailable.boundingBox(),
    unavailable.getByRole('button', { name: 'Try again' }).boundingBox(),
  ]);
  if (!box || !action) throw new Error('no box');
  expect(action.x + action.width).toBeLessThanOrEqual(box.x + box.width);
});

test('the capsules have no accessibility violations', async ({ page }) => {
  const results = await new AxeBuilder({ page }).include('[data-capture="capsule"]').analyze();
  expect(results.violations).toEqual([]);
});
