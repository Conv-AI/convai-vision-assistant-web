import { expect, test, type Page } from '@playwright/test';
import { openApp } from './fakeConvai';
import { launchOptions } from './launch';

test.use({ launchOptions: launchOptions({ scrollbars: true }) });

const capsule = (page: Page) => page.locator('.convai-capsule');
const settings = (page: Page) => page.locator('dialog.va-settings');
const title = (page: Page) => settings(page).getByRole('heading', { level: 2 });
const section = (page: Page, name: string) => settings(page).getByRole('tab', { name });
const search = (page: Page) => settings(page).getByRole('searchbox', { name: 'Search settings' });

async function live(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await openApp(page);
  await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
}

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(settings(page)).toBeVisible();
}

test.describe('Settings at the reference viewport’ size', () => {
  test('draws the window, header, rows, caps and fades of the frames', async ({ page }) => {
    await live(page, 1440, 900);
    await openSettings(page);
    expect(await settings(page).boundingBox()).toEqual({ x: 260, y: 70, width: 920, height: 760 });
    const header = settings(page).locator('.va-settings__header');
    expect((await header.boundingBox())?.height).toBe(56);
    const line = () => header.evaluate((element) => getComputedStyle(element).borderBottomColor);
    expect(await line()).toBe('rgba(0, 0, 0, 0)');

    await section(page, 'Shortcuts').click();
    await expect(title(page)).toHaveText('Shortcuts');
    const rows = settings(page).locator('.va-settings__rows').first();
    expect(await rows.boundingBox()).toMatchObject({ x: 513, width: 600 });
    const intro = settings(page).locator('.va-settings__intro');
    expect((await intro.boundingBox())?.y).toBe(135);
    // Each hairline between rows takes its own 1 px, as the kit's separator does: Talk 194–241,
    // the hairline at 242, Type a message from 243.
    const tops = await settings(page)
      .locator('.va-settings__rows')
      .first()
      .locator('.va-settings__row')
      .evaluateAll((rows) => rows.slice(0, 3).map((row) => row.getBoundingClientRect().y));
    expect(tops).toEqual([193.5, 242.5, 291.5]);
    const cap = settings(page).locator('[data-row="shortcut-talk"] .va-settings__key');
    expect(await cap.boundingBox()).toMatchObject({ width: 28, height: 28 });
    expect(await cap.evaluate((element) => getComputedStyle(element).boxShadow)).toBe(
      'rgba(255, 255, 255, 0.24) 0px 0px 0px 1px inset',
    );
    const fade = (where: 'top' | 'bottom') =>
      settings(page)
        .locator(`.va-settings__fade--${where}`)
        .evaluate((element) => getComputedStyle(element).opacity);
    // Shortcuts fits the web's rows: neither fade, once the switch has settled (fades ease).
    await expect.poll(() => fade('bottom')).toBe('0');

    // The licenses run past the window.
    await section(page, 'About').click();
    await settings(page).getByRole('button', { name: 'Open-source licenses' }).click();
    await expect(settings(page).getByRole('button', { name: /^react MIT/ })).toBeVisible();
    await expect.poll(() => fade('bottom')).toBe('1');
    expect(await fade('top')).toBe('0');
    expect(await line()).toBe('rgba(0, 0, 0, 0)');

    const scroller = settings(page).locator('.va-settings__page');
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect.poll(line).toBe('rgba(255, 255, 255, 0.08)');
    await expect.poll(() => fade('top')).toBe('1');
    await expect.poll(() => fade('bottom')).toBe('0');

    // A section that fits has neither fade nor line.
    await section(page, 'Window').click();
    await expect(title(page)).toHaveText('Window');
    await expect.poll(line).toBe('rgba(0, 0, 0, 0)');
    await expect.poll(() => fade('bottom')).toBe('0');

    // Key by key: Playwright's fill of a search field sets a value React misses in WebKit.
    await search(page).pressSequentially('lighting');
    const empty = settings(page).getByText('No settings match “lighting”');
    await expect(empty).toBeVisible();
    // The frame's title stands at 322.5: 135 + (420 − its two lines and the 6 between) / 2.
    expect(Math.abs(((await empty.boundingBox())?.y ?? 0) - 322.5)).toBeLessThanOrEqual(1);
  });

  test('waits for a key in a 32 box, and says a refusal 8 under the hint (S4 recording, S4c)', async ({
    page,
  }) => {
    await live(page, 1440, 900);
    await openSettings(page);
    await section(page, 'Shortcuts').click();
    await settings(page).getByRole('button', { name: 'Change Talk, T' }).click();
    const talk = settings(page).locator('[data-row="shortcut-talk"]');
    const waiting = talk.locator('.va-settings__recording');
    await expect(waiting).toHaveText('Press a key…');
    expect((await waiting.boundingBox())?.height).toBe(32);
    const line = talk.locator('.va-settings__row');
    expect((await line.boundingBox())?.height).toBe(52);

    await page.keyboard.press('Control+KeyF');
    const refusal = talk.getByText('belongs to the browser');
    await expect(refusal).toBeVisible();
    const hint = talk.getByText('Press the key you want. Esc cancels.');
    const under = (await refusal.boundingBox())?.y ?? 0;
    const hintBox = await hint.boundingBox();
    expect(Math.round(under - ((hintBox?.y ?? 0) + (hintBox?.height ?? 0)))).toBe(8);
    // The whole row is lit, the refusal with it.
    const lit = await talk.boundingBox();
    const refused = await refusal.boundingBox();
    expect((refused?.y ?? 0) + (refused?.height ?? 0)).toBeLessThan(
      (lit?.y ?? 0) + (lit?.height ?? 0),
    );
    // The refusal is 12/1.45, as the kit's line under a row.
    expect(refused?.height).toBeCloseTo(17.4, 0);
    // Away from the pointer, so no hover fill stands in for the tint.
    await page.mouse.move(4, 4);
    expect(await talk.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
      'rgba(0, 0, 0, 0)',
    );
    // Lit, a row in the middle of a group keeps square corners (only the group's ends round).
    await page.keyboard.press('Escape');
    await settings(page).getByRole('button', { name: 'Change Mute microphone, M' }).click();
    const mute = settings(page).locator('[data-row="shortcut-mute"]');
    await expect(mute).toHaveAttribute('data-recording', 'true');
    expect(await mute.evaluate((element) => getComputedStyle(element).borderRadius)).toBe('0px');
    expect(await talk.evaluate((element) => getComputedStyle(element).borderTopLeftRadius)).toBe(
      '14px',
    );
    // Sections not shown are at the Part's 72 %.
    expect(
      await section(page, 'Audio').evaluate((element) => getComputedStyle(element).color),
    ).toBe('color(srgb 0.964706 0.972549 0.980392 / 0.72)');
    // At 14/1, as the kit's `.cv-set__nav`, so the words stand where the frame's do.
    expect(
      await section(page, 'Audio').evaluate((element) => getComputedStyle(element).lineHeight),
    ).toBe('14px');
  });
});
