import { expect, test, type Page } from '@playwright/test';
import { openApp } from './fakeConvai';

// The first load of the built app: which font files a page fetches, and when the SDK is asked for.
// The budget for its bytes is `pnpm check:size`; these check what the browser really does.

const capsule = (page: Page) => page.locator('.convai-capsule');

/** The font files the page fetched, by their name before the build's hash (which may hold "-"). */
const fetchedFonts = (page: Page) =>
  page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map(
        (entry) => /\/(Inter-Variable(?:-[a-z]+(?:-ext)?)?)-[\w-]{8}\.woff2$/.exec(entry.name)?.[1],
      )
      .filter((name) => name !== undefined),
  );

test('an English window fetches the Latin Inter file and no other', async ({ page }) => {
  await openApp(page);
  await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('600 13px Inter'))).toBe(true);
  expect(await fetchedFonts(page)).toEqual(['Inter-Variable-latin']);
});

test('a character who speaks Russian has its Cyrillic file fetched once it is live', async ({
  page,
}) => {
  await openApp(page, {}, [{ id: 'kira-1', name: 'Kira', languages: ['ru-RU'] }]);
  await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
  // Nothing on the page is in Cyrillic: the file comes for the answers still to come.
  expect(await page.evaluate(() => /[\u0400-\u04ff]/.test(document.body.innerText))).toBe(false);
  await expect
    .poll(async () => (await fetchedFonts(page)).sort(), { timeout: 10_000 })
    .toEqual(['Inter-Variable-cyrillic', 'Inter-Variable-latin']);
});

test('a name measured before its letters’ font arrived is measured again once it has', async ({
  page,
}) => {
  // The chip cuts a long name by measuring it. Its Cyrillic file is held back, so the first cut is
  // made with the fallback font's widths; once Inter's file arrives, the cut must be Inter's. At
  // 1250 wide the two differ by a whole part of the name (Inter is about 14 % wider here). Another
  // layout change can mend a stale cut by chance, so a part that never measures again fails here
  // only some of the time (3 of 5 runs); src/app/fontArrival.test.tsx fails it every time.
  await page.setViewportSize({ width: 1250, height: 720 });
  await page.route('**/Inter-Variable-cyrillic-*.woff2', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    await route.continue();
  });
  await openApp(page);
  await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
  const png = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/png');
    });
    return blob ? [...new Uint8Array(await blob.arrayBuffer())] : [];
  });
  await page.locator('.va-chip').click();
  const chooser = page.waitForEvent('filechooser');
  await page
    .getByRole('menu', { name: 'What Kira sees' })
    .getByRole('menuitemradio', { name: /^Image…/ })
    .click();
  const name = 'Мама мыла раму, мама мыла раму, мама мыла раму, мама мыла раму, мама мыла раму.png';
  await (await chooser).setFiles({ name, mimeType: 'image/png', buffer: Buffer.from(png) });
  const shown = page.locator('.va-chip__name');
  await expect(shown).toBeVisible();
  await page.waitForFunction(() => [...document.fonts].every((face) => face.status !== 'loading'));
  await expect
    .poll(() => page.evaluate(() => document.fonts.check('600 13px Inter', 'Фото')))
    .toBe(true);
  await page.waitForTimeout(300);
  const afterFont = await shown.textContent();
  // Laid out anew at the same width: what the chip shows when measured with Inter alone.
  await page.setViewportSize({ width: 1251, height: 720 });
  await page.setViewportSize({ width: 1250, height: 720 });
  await page.waitForTimeout(300);
  const fresh = await shown.textContent();
  expect(afterFont).toBe(fresh);
});

test('letters of another script still draw in Inter, from their own file', async ({ page }) => {
  await openApp(page);
  await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
  const words = 'Привет · Γειά · Tiếng Việt · Ğüşıöç';
  await page.evaluate((text) => {
    const line = document.createElement('p');
    line.textContent = text;
    line.style.fontFamily = 'Inter';
    document.body.append(line);
  }, words);
  await page.evaluate((text) => document.fonts.load('400 16px Inter', text), words);
  expect(await page.evaluate((text) => document.fonts.check('400 16px Inter', text), words)).toBe(
    true,
  );
  expect((await fetchedFonts(page)).sort()).toEqual([
    'Inter-Variable-cyrillic',
    'Inter-Variable-greek',
    'Inter-Variable-latin',
    'Inter-Variable-latin-ext',
    'Inter-Variable-vietnamese',
  ]);
});

test('the SDK is asked for while the token is still on its way', async ({ page, baseURL }) => {
  // The real transport, not the fake: nothing may reach Convai or LiveKit, so every host but this
  // one is refused, and the token is held until the SDK's chunk is asked for (or 10 s have gone).
  await page.addInitScript(() => {
    window.localStorage.setItem('va.first-run-done', '1');
  });
  const own = new URL(baseURL ?? '').origin;
  await page.route(
    (url) => url.origin !== own,
    (route) => route.abort(),
  );
  let sdkAsked: () => void = () => undefined;
  const sdk = new Promise<void>((resolve) => {
    sdkAsked = resolve;
  });
  page.on('request', (request) => {
    if (/\/convaiTransport-[\w-]+\.js$/.test(request.url())) sdkAsked();
  });
  let heldUntilSdk = false;
  await page.route('**/api/token', async (route) => {
    heldUntilSdk = await Promise.race([
      sdk.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(resolve, 10_000, false)),
    ]);
    await route.fulfill({ json: { token: 'test-token', endUserId: 'e2e-user' } });
  });
  await page.route('**/api/characters', (route) =>
    route.fulfill({ json: { characters: [{ id: 'kira-1', name: 'Kira' }] } }),
  );
  const tokenAnswered = page.waitForResponse('**/api/token', { timeout: 20_000 });
  await page.goto('/');
  await tokenAnswered;
  expect(heldUntilSdk).toBe(true);
});
