import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/gallery.html');
  await page.getByRole('heading', { name: 'Lens' }).scrollIntoViewIfNeeded();
});

/** How many pixels of a Lens's canvas are drawn. */
async function drawn(page: Page, name: string) {
  return page
    .getByRole('img', { name })
    .first()
    .evaluate((lens) => {
      const canvas = lens.querySelector('canvas');
      const data = canvas?.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      if (data) for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 0) count++;
      return count;
    });
}

test('every state is read as the character and drawn', async ({ page }) => {
  for (const name of [
    'Kira, ready',
    'Kira, listening',
    'Kira, listening while you hold',
    'Kira, thinking',
    'Kira, speaking',
    'Kira, muted. You can still type.',
    'Connecting to Kira',
    'Kira, offline',
  ]) {
    await expect(page.getByRole('img', { name }).first()).toBeVisible();
    await expect.poll(() => drawn(page, name)).toBeGreaterThan(1000);
  }
});

test('offline is the muted Lens at 35 % in gray', async ({ page }) => {
  const offline = page
    .locator('[data-capture="lens"]')
    .getByRole('img', { name: 'Kira, offline' })
    .locator('canvas');
  await expect(offline).toHaveCSS('opacity', '0.35');
  await expect(offline).toHaveCSS('filter', 'grayscale(1)');
});

test('high contrast rings the glass with edge.strong', async ({ page }) => {
  await page.getByLabel('Increase contrast').selectOption('on');
  await expect(page.getByRole('img', { name: 'Kira, ready' }).first()).toHaveCSS(
    'box-shadow',
    /^rgba\(255, 255, 255, 0\.5\) 0px 0px 0px 1px, /,
  );
  // The ring stays whole on an offline Lens: only its drawing fades.
  await expect(
    page.locator('[data-capture="lens"]').getByRole('img', { name: 'Kira, offline' }),
  ).toHaveCSS('opacity', '1');
});
