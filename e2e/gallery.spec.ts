import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/gallery.html');
  await expect(page.getByRole('heading', { level: 1, name: 'Kit gallery' })).toBeVisible();
});

test('the kit draws with Inter from the app itself', async ({ page }) => {
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('600 13px Inter');
  });
  expect(loaded).toBe(true);
  await expect(page.locator('.convai-text--body').first()).toHaveCSS('font-family', /^Inter/);
});

test('swatches resolve to the theme values', async ({ page }) => {
  const sheet = page.locator('[data-token="surface.sheet"] .gallery__swatch');
  await expect(sheet).toHaveCSS('background-color', 'rgb(23, 23, 26)');
  const secondary = page.locator('[data-token="text.secondary"] .gallery__swatch');
  await expect(secondary).toHaveCSS('background-color', 'rgba(246, 248, 250, 0.62)');
});

test('preferences change text size, character color and contrast', async ({ page }) => {
  const body = page.locator('.convai-text--body').first();
  await expect(body).toHaveCSS('font-size', '15px');
  await page.getByLabel('Text size').selectOption('1.3');
  await expect(body).toHaveCSS('font-size', '19.5px');

  // 0.90 never takes text under 11 px.
  await page.getByLabel('Text size').selectOption('0.9');
  await expect(page.locator('.convai-text--micro').first()).toHaveCSS('font-size', '11px');

  const ai = page.locator('[data-token="ai.accent"] .gallery__swatch');
  await page.getByLabel('Character color').selectOption('cyan');
  await expect(ai).toHaveCSS('background-color', 'rgb(92, 200, 240)');

  const secondary = page.locator('[data-token="text.secondary"] .gallery__swatch');
  await page.getByLabel('Increase contrast').selectOption('on');
  await expect(secondary).toHaveCSS('background-color', 'rgba(246, 248, 250, 0.82)');
});

test('"System" follows the browser for contrast and motion', async ({ page }) => {
  await page.emulateMedia({ contrast: 'more', reducedMotion: 'reduce' });
  const root = page.locator('html');
  await expect(root).toHaveClass(/convai-high-contrast/);
  await expect(root).toHaveClass(/convai-reduce-motion/);
  await page.emulateMedia({ contrast: 'no-preference', reducedMotion: 'no-preference' });
  await expect(root).not.toHaveClass(/convai-high-contrast/);
  await expect(root).not.toHaveClass(/convai-reduce-motion/);
});

for (const contrast of ['off', 'on']) {
  test(`the gallery has no accessibility violations with contrast ${contrast}`, async ({
    page,
  }) => {
    await page.getByLabel('Increase contrast').selectOption(contrast);
    // A forced press is a moment, not a resting state: it is left out (see the kit's open questions).
    const results = await new AxeBuilder({ page }).exclude('.convai-state-pressed').analyze();
    expect(results.violations).toEqual([]);
  });
}
