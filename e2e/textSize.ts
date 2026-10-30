import { expect, type Page } from '@playwright/test';

/**
 * The person's text size as Settings keeps it (`va.preferences`), written before the page loads and
 * on every reload after, so the app opens at that size as it would on a later visit.
 */
export async function storedTextSize(page: Page, scale: number): Promise<void> {
  await page.addInitScript((value) => {
    const raw = window.localStorage.getItem('va.preferences');
    const stored = raw === null ? {} : (JSON.parse(raw) as Record<string, unknown>);
    window.localStorage.setItem('va.preferences', JSON.stringify({ ...stored, textScale: value }));
  }, scale);
}

/**
 * Sets the text size while the app runs, as a person does: Settings › Accessibility › Text size,
 * from 90 % up in 5 % steps, then Settings closes and the focus leaves its gear (whose tooltip would
 * otherwise show).
 */
export async function textSizeInSettings(page: Page, scale: number): Promise<void> {
  const settings = page.locator('dialog.va-settings');
  await page.getByRole('button', { name: 'Settings' }).click();

  const tab = settings.getByRole('tab', { name: 'Accessibility' });
  if ((await tab.count()) > 0) await tab.click();
  else {
    await settings.getByRole('button', { name: /^Sections/ }).click();
    await settings.getByRole('option', { name: 'Accessibility' }).click();
  }
  const slider = settings.getByRole('slider', { name: 'Text size' });
  await slider.focus();
  await page.keyboard.press('Home');
  const steps = Math.round((scale - 0.9) / 0.05);
  for (let step = 0; step < steps; step++) await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuetext', `${String(Math.round(scale * 100))}%`);
  await settings.getByRole('button', { name: 'Close' }).click();
  await expect(settings).toBeHidden();
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}
