import { expect, test, type Locator, type Page } from '@playwright/test';
import { emit, openApp } from './fakeConvai';
import { launchOptions } from './launch';
import { engineOf } from './engines';

// Scrollers draw the kit's thumb (src/kit/scroll.css), never the platform's scrollbar with its
// arrows. Playwright hides scrollbars unless told otherwise, which is how the platform's bar with
// arrows went unseen in every capture until 24 October 2026.

test.use({ launchOptions: launchOptions({ scrollbars: true }) });

const capsule = (page: Page) => page.locator('.convai-capsule');

/** The scroller's gutter: what its scrollbar takes from its width. */
function gutter(scroller: Locator): Promise<{ gutter: number; scrolls: boolean }> {
  return scroller.evaluate((element: HTMLElement) => {
    const style = getComputedStyle(element);
    const borders = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    return {
      gutter: element.offsetWidth - element.clientWidth - borders,
      scrolls: element.scrollHeight > element.clientHeight,
    };
  });
}

/**
 * The kit's scrollbar, by the path src/kit/scroll.css takes: where the engine has
 * `::-webkit-scrollbar` (Chromium, WebKit), its own 10 gutter (the platform's bar with arrows takes
 * 15 or more); elsewhere the standard properties, a thin scrollbar in the kit's thumb colour.
 */
async function expectKitScrollbar(page: Page, scroller: Locator) {
  const pseudo = await page.evaluate(() => CSS.supports('selector(::-webkit-scrollbar)'));
  if (pseudo) {
    expect(await gutter(scroller)).toEqual({ gutter: 10, scrolls: true });
    return;
  }
  expect((await gutter(scroller)).scrolls).toBe(true);
  const style = await scroller.evaluate((element) => {
    const computed = getComputedStyle(element);
    // The token as a computed colour, as the scrollbar's reads.
    const probe = document.createElement('span');
    probe.style.color = 'var(--convai-scroll-thumb)';
    element.append(probe);
    const thumb = getComputedStyle(probe).color;
    probe.remove();
    return { width: computed.scrollbarWidth, color: computed.scrollbarColor, thumb };
  });
  // Playwright's own Firefox hides every scrollbar (it reads `none` there, a stock Firefox the kit's
  // `thin`): the width is read everywhere else.
  if (engineOf(page) !== 'firefox') expect(style.width).toBe('thin');
  // The thumb in scroll.thumb on no track.
  expect(style.color).toBe(`${style.thumb} rgba(0, 0, 0, 0)`);
}

async function live(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);
  await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
}

test('Settings scrolls with the kit thumb, not the platform bar', async ({ page }) => {
  await live(page);
  // Talking fits the 760 window; 600 high, it runs past it.
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.getByRole('button', { name: 'Settings' }).click();
  const content = page.locator('dialog.va-settings .va-settings__page');
  await expect(content).toBeVisible();
  await expectKitScrollbar(page, content);
});

test('the transcript list scrolls with the kit thumb', async ({ page }) => {
  await live(page);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('/');
    await page.keyboard.type('What is this?');
    await page.keyboard.press('Enter');
    await emit(page, { type: 'activity', activity: 'thinking' });
    await emit(page, {
      type: 'reply',
      id: `r${String(i)}`,
      text: 'A ceramic mug. Matte glaze outside, glossy inside. It looks hand-thrown.',
      streaming: false,
    });
    await emit(page, { type: 'activity', activity: 'idle' });
  }
  await expectKitScrollbar(page, page.locator('.va-transcript__list'));
});
