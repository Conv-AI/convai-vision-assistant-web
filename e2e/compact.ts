import { expect, type Page } from '@playwright/test';

/** The capsule's floating window at the capsule's size: 360 × 64 with 8 on every side. */
export const compactViewport = { width: 376, height: 80 } as const;

/**
 * Playwright holds a popup's requests while any route is set: the floating window's
 * font loads only once the /api routes are gone. Call it once the session is live, which no longer
 * needs them.
 */
export async function letFloatingWindowLoad(page: Page): Promise<void> {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
}

/**
 * The floating window that `press` opens, at the capsule's size, once its capsule shows. The
 * press must be the one that asks for it: the browser opens one only in a press.
 */
export async function floatingWindowFrom(page: Page, press: () => Promise<void>): Promise<Page> {
  const popup = page.waitForEvent('popup');
  await press();
  const pip = await popup;
  await pip.setViewportSize(compactViewport);
  await expect(pip.locator('.convai-capsule')).toBeVisible();
  return pip;
}

/** Compact, pressed in the title bar: the floating window, at the capsule's size. */
export async function enterCompact(page: Page): Promise<Page> {
  return floatingWindowFrom(page, () =>
    page.getByRole('button', { name: 'Compact', exact: true }).click(),
  );
}

/**
 * Closes the floating window from inside, as its own close button does. Playwright's own close of
 * it ends the tab's page too in Firefox, whose floating window is a Document Picture-in-Picture too.
 */
export async function closeFloatingWindow(pip: Page): Promise<void> {
  const closed = pip.waitForEvent('close');
  await pip.evaluate(() => {
    setTimeout(() => {
      window.close();
    });
  });
  await closed;
}

/**
 * Closes every floating window a test left open, from inside: Playwright's Firefox fails to end a
 * context with one still open ("removeBrowserContext").
 */
export async function closeFloatingWindows(page: Page): Promise<void> {
  for (const other of page.context().pages()) {
    if (other !== page && !other.isClosed()) await closeFloatingWindow(other);
  }
}
