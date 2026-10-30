import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { closeFloatingWindows, floatingWindowFrom, letFloatingWindowLoad } from './compact';
import { emit, fakeRecord, openApp } from './fakeConvai';
import { storedTextSize } from './textSize';
import { panelHeight, type Step } from '../src/quick/layout';
import { limits, skipIn } from './engines';

test.afterEach(async ({ page }) => {
  await closeFloatingWindows(page);
});

const capsule = (page: Page) => page.locator('.convai-capsule');
const more = (page: Page) => page.getByRole('button', { name: 'Quick controls' });
const panel = (page: Page) => page.getByRole('dialog', { name: 'Quick controls' });
const tile = (page: Page, name: string | RegExp) =>
  panel(page).getByRole('button', { name, exact: typeof name === 'string' ? false : undefined });
const settingsDialog = (page: Page) => page.locator('dialog.va-settings');

async function live(page: Page, size = { width: 1280, height: 900 }) {
  await page.setViewportSize(size);
  await openApp(page);
  await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
}

/** The panel's step, and its height as drawn against the model the steps were decided by. */
async function measured(page: Page) {
  return page.evaluate(async () => {
    const element = document.querySelector<HTMLElement>('.va-quick');
    if (!element) throw new Error('No panel.');
    // Read where it comes to rest, once it has grown out of the capsule.
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
    const box = element.getBoundingClientRect();
    const stage = document.querySelector('.va-stage')?.getBoundingClientRect();
    const capsuleBox = document.querySelector('.convai-capsule')?.getBoundingClientRect();
    const rows = [...element.querySelectorAll('.va-quick__tiles')].map(
      (grid) => grid.querySelectorAll('[data-tile]').length,
    );
    return {
      step: Number(element.dataset.step),
      height: box.height,
      top: box.top - (stage?.top ?? 0),
      gapToCapsule: (capsuleBox?.top ?? 0) - box.bottom,
      columns: Number(getComputedStyle(element).getPropertyValue('--va-quick-columns')),
      // The last grid is the app's whenever its label stands.
      packageTiles:
        rows.length > 1 || !element.querySelector('.va-quick__app-label') ? (rows[0] ?? 0) : 0,
      appTiles: element.querySelector('.va-quick__app-label') ? (rows.at(-1) ?? 0) : 0,
      character: element.querySelector('.va-quick__character') !== null,
    };
  });
}

test.describe('Quick controls (D13)', () => {
  test('opens from More, Q and a right-click on the Lens, focused on the first tile, and Esc or Q gives the focus back to More', async ({
    page,
  }) => {
    await live(page);
    await expect(more(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(more(page)).toHaveAttribute('aria-haspopup', 'dialog');

    await more(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(more(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(tile(page, /^Hands free/)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeHidden();
    await expect(more(page)).toBeFocused();

    await page.keyboard.press('q');
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press('q');
    await expect(panel(page)).toBeHidden();
    await expect(more(page)).toBeFocused();

    // A right-click opens it and never talks: the microphone stays shut.
    await page.locator('.convai-capsule__lens').click({ button: 'right' });
    await expect(panel(page)).toBeVisible();
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
    expect((await fakeRecord(page)).microphone.filter(Boolean)).toEqual([]);
    // Checked once it has grown in: mid fade its words read faint (1.79:1 in WebKit on CI).
    await measured(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test('stands as the layout requires: 8 inside, tiles 129, the character’s line, All settings 44', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page, {}, [{ id: 'kira-1', name: 'Kira', languages: ['en-GB'] }]);
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
    await page.keyboard.press('q');
    await measured(page);
    const parts = await panel(page).evaluate((element) => {
      const origin = element.getBoundingClientRect();
      const box = (selector: string) => {
        const part = element.querySelector(selector);
        if (!part) return null;
        const r = part.getBoundingClientRect();
        return { x: r.x - origin.x, y: r.y - origin.y, w: r.width, h: r.height };
      };
      return {
        panel: { w: origin.width, h: origin.height },
        edge: [getComputedStyle(element).borderTopWidth, getComputedStyle(element).boxShadow],
        character: box('.va-quick__character'),
        line: element.querySelector('.va-quick__line')?.textContent,
        tile: box('[data-tile]'),
        label: box('.va-quick__app-label'),

        labelLine: (() => {
          const label = element.querySelector('.va-quick__app-label');
          if (!label?.firstChild) return null;
          const range = document.createRange();
          range.selectNodeContents(label);
          return range.getBoundingClientRect().y - label.getBoundingClientRect().y;
        })(),
        rule: box('.va-quick__rule'),
        settings: box('.va-quick__settings'),
        keys: element.querySelector('.va-quick__settings-keys')?.textContent,
        caps: element.querySelectorAll('.va-quick__settings kbd').length,
      };
    });
    expect(parts.panel).toEqual({ w: 420, h: 429 });
    expect(parts.edge[0]).toBe('0px');
    expect(parts.edge[1]).toContain('rgba(255, 255, 255, 0.08) 0px 0px 0px 1px inset');
    expect(parts.character).toEqual({ x: 8, y: 8, w: 404, h: 56 });
    expect(parts.line).toBe('English');
    expect(parts.tile?.x).toBe(8);
    expect(parts.tile?.y).toBe(72);
    expect(parts.tile?.w).toBeCloseTo(129.33, 1);
    // The label 8 under the tiles, the app's tiles 8 under its line.
    expect(parts.label).toMatchObject({ y: 72 + 84 + 8 + 84, h: 37 });
    expect(parts.labelLine).toBe(14);
    expect(parts.settings).toEqual({ x: 8, y: 377, w: 404, h: 44 });
    // The rule in the middle of the 8 over All settings, 4 in from its ends.
    expect(parts.rule).toEqual({ x: 12, y: 372, w: 396, h: 1 });
    expect(parts.keys).toBe('Ctrl ,');
    expect(parts.caps).toBe(0);
  });

  test('rings its tiles for the arrows after Q pressed with nothing focused by the pointer', async ({
    page,
  }) => {
    await live(page);
    // A press on the page's ground leaves the focus on the page itself.
    await page.mouse.click(4, 450);
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
    await page.keyboard.press('q');
    await expect(tile(page, /^Hands free/)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    expect(
      await page.evaluate(() => {
        const focused = document.activeElement;
        return focused?.matches(':focus-visible')
          ? Number.parseFloat(getComputedStyle(focused).outlineWidth)
          : 0;
      }),
    ).toBeGreaterThan(0);
  });

  test('holds the six tiles, then the app’s row, as the layout specifies', async ({ page }) => {
    skipIn(page, ['webkit'], limits.noPip);
    await live(page, { width: 900, height: 900 });
    await page.keyboard.press('q');
    const names = await panel(page)
      .locator('[data-tile]')
      .evaluateAll((tiles) => tiles.map((each) => (each as HTMLElement).dataset.tile));
    expect(names).toEqual([
      'hands-free',
      'captions',
      'transcript',
      'type',
      'mute',
      'text-size',
      'pause-vision',
      'source',
      'window',
    ]);
    await expect(panel(page).getByText('From Vision Assistant')).toBeVisible();
    await expect(tile(page, /^Captions/)).toHaveAttribute('aria-pressed', 'true');
    await expect(tile(page, /^Hands free/)).toHaveAttribute('aria-pressed', 'false');
    await expect(tile(page, /^Type/)).toHaveAttribute('aria-keyshortcuts', '/');
    await expect(tile(page, /^Text size/)).toContainText('100%');
    await expect(tile(page, /^Source/)).toContainText('Nothing');
    await expect(tile(page, /^Window/)).toContainText('Full');
    await expect(tile(page, /^Pause vision/)).toHaveAttribute('aria-disabled', 'true');
    await expect(panel(page).getByText('Kira', { exact: true })).toBeVisible();
  });

  test('never interrupts: the character keeps speaking while it opens and closes', async ({
    page,
  }) => {
    await live(page);
    await emit(page, { type: 'reply', id: 'r1', text: 'Once upon a time', streaming: true });
    await emit(page, { type: 'activity', activity: 'speaking' });
    await expect(capsule(page)).toHaveAttribute('data-state', 'speaking');
    await page.keyboard.press('q');
    await expect(panel(page)).toBeVisible();
    await expect(capsule(page)).toHaveAttribute('data-state', 'speaking');
    await tile(page, /^Captions/).click();
    await page.keyboard.press('q');
    await expect(panel(page)).toBeHidden();
    await expect(capsule(page)).toHaveAttribute('data-state', 'speaking');
    expect((await fakeRecord(page)).interrupts).toBe(0);
    // Esc with the panel closed stops the reply, as before: More, given the focus back, shows no
    // tooltip that would take it first.
    await expect(more(page)).toBeFocused();
    await expect(page.locator('.convai-tooltip')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await fakeRecord(page)).interrupts).toBe(1);
  });

  test('a toggle keeps the panel open and changes what its Settings row changes, both ways', async ({
    page,
  }) => {
    await live(page);
    await more(page).click();
    await tile(page, /^Captions/).click();
    await expect(tile(page, /^Captions/)).toHaveAttribute('aria-pressed', 'false');
    await tile(page, /^Mute/).click();
    await expect(tile(page, /^Mute/)).toHaveAttribute('aria-pressed', 'true');
    await expect(capsule(page)).toHaveAttribute('data-state', 'muted');
    await tile(page, /^Hands free/).click();
    await expect(tile(page, /^Hands free/)).toHaveAttribute('aria-pressed', 'true');
    await expect(panel(page)).toBeVisible();

    await panel(page).getByRole('button', { name: 'All settings' }).click();
    await expect(panel(page)).toBeHidden();
    await expect(settingsDialog(page)).toBeVisible();
    await expect(settingsDialog(page).getByRole('switch', { name: 'Captions' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await expect(settingsDialog(page).getByRole('radio', { name: 'Hands free' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await settingsDialog(page).getByRole('switch', { name: 'Captions' }).click();
    await settingsDialog(page).getByRole('button', { name: 'Close' }).click();

    await page.keyboard.press('q');
    await expect(tile(page, /^Captions/)).toHaveAttribute('aria-pressed', 'true');
  });

  test('what leads elsewhere closes it first: Type, Source, Change', async ({ page }) => {
    await live(page);
    await page.keyboard.press('q');
    await tile(page, /^Type/).click();
    await expect(panel(page)).toBeHidden();
    await expect(page.getByRole('textbox', { name: /Message/ })).toBeFocused();
    await page.keyboard.press('Escape');

    await more(page).click();
    await tile(page, /^Source/).click();
    await expect(panel(page)).toBeHidden();
    await expect(page.getByRole('menu', { name: /What Kira sees/ })).toBeVisible();
    await page.keyboard.press('Escape');

    await more(page).click();
    await panel(page).getByRole('button', { name: 'Change' }).click();
    await expect(panel(page)).toBeHidden();
    await expect(page.locator('dialog.va-picker')).toBeVisible();
  });

  test('a press outside closes it and still reaches what it was on; a press on the capsule leaves it', async ({
    page,
  }) => {
    await live(page, { width: 900, height: 900 });
    await more(page).click();
    await page.locator('.convai-capsule__words-anchor').click();
    await expect(panel(page)).toBeVisible();
    await page.getByRole('button', { name: 'Transcript' }).first().click();
    await expect(panel(page)).toBeHidden();
    await expect(page.getByRole('region', { name: 'Transcript' })).toBeVisible();
  });

  test('Text size opens its options in place; Esc goes back to the tiles, then closes', async ({
    page,
  }) => {
    await live(page);
    await page.keyboard.press('q');
    await tile(page, /^Text size/).click();
    const slider = panel(page).getByRole('slider', { name: 'Text size' });
    await expect(slider).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(slider).toHaveAttribute('aria-valuetext', '105%');
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--convai-text-scale'),
        ),
      )
      .toContain('1.05');
    await page.keyboard.press('Escape');
    await expect(tile(page, /^Text size/)).toBeFocused();
    await expect(tile(page, /^Text size/)).toContainText('105%');
    await page.keyboard.press('ArrowRight');
    await expect(slider).toBeFocused();
    // ← from Back (Shift Tab from the slider) returns too; Tab past the slider would leave and close.
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('.va-quick__options-header button')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(tile(page, /^Text size/)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeHidden();
  });

  test('the Transcript tile shows and hides the transcript, and the panel stays open', async ({
    page,
  }) => {
    await live(page, { width: 900, height: 900 });
    await page.keyboard.press('q');
    await tile(page, /^Transcript/).click();
    await expect(page.getByRole('region', { name: 'Transcript' })).toBeVisible();
    await expect(tile(page, /^Transcript/)).toHaveAttribute('aria-pressed', 'true');
    await tile(page, /^Transcript/).click();
    await expect(page.getByRole('region', { name: 'Transcript' })).toBeHidden();
    await expect(panel(page)).toBeVisible();
  });

  test('arrows move in the grid, across into the app’s row', async ({ page }) => {
    await live(page, { width: 900, height: 900 });
    await page.keyboard.press('q');
    await expect(tile(page, /^Hands free/)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(tile(page, /^Captions/)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(tile(page, /^Mute/)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(tile(page, /^Source/)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(tile(page, /^Pause vision/)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(tile(page, /^Type/)).toBeFocused();
  });

  test('follows More: dimmed while connecting, where Q does nothing; stays beside a problem’s action', async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openApp(page, { later: 'hold' }, [
      { id: 'kira-1', name: 'Kira' },
      { id: 'marcus-3', name: 'Marcus' },
    ]);
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
    await page.keyboard.press('q');
    await expect(panel(page)).toBeVisible();
    await context.setOffline(true);
    await expect(capsule(page)).toHaveAttribute('data-state', 'offline', { timeout: 6000 });

    await expect(panel(page)).toBeVisible();
    await expect(more(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeHidden();
    await more(page).click();
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await context.setOffline(false);
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready', { timeout: 6000 });

    // A dropped link reconnects past 2 s: the capsule connects, More is dimmed, and Q does nothing.
    await emit(page, { type: 'reconnecting' });
    await expect(capsule(page)).toHaveAttribute('data-state', 'connecting', { timeout: 4000 });
    await expect(more(page)).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('q');
    await expect(panel(page)).toBeHidden();
    // The Lens does nothing while connecting (aria-disabled): pressed anyway.
    await page.locator('.convai-capsule__lens').click({ button: 'right', force: true });
    await expect(panel(page)).toBeHidden();
    await emit(page, { type: 'reconnected' });

    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
    await page.keyboard.press('q');
    await panel(page).getByRole('button', { name: 'Change' }).click();
    const picker = page.locator('dialog.va-picker');
    await picker.locator('.va-card', { has: page.getByText('Marcus', { exact: true }) }).click();
    await picker.getByRole('button', { name: 'Talk to Marcus' }).click();
    await expect(page.locator('.va-launch--switching')).toBeVisible();
    await expect(more(page)).toHaveCount(0);
    await page.keyboard.press('q');
    await expect(panel(page)).toBeHidden();
  });

  test('its key is Settings › Shortcuts’ to change', async ({ page }) => {
    await live(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await settingsDialog(page).getByRole('tab', { name: 'Shortcuts' }).click();
    await settingsDialog(page)
      .getByRole('button', { name: /^Change Quick controls, Q/ })
      .click();
    await page.keyboard.press('k');
    await settingsDialog(page).getByRole('button', { name: 'Close' }).click();
    await page.keyboard.press('q');
    await expect(panel(page)).toBeHidden();
    await page.keyboard.press('k');
    await expect(panel(page)).toBeVisible();
    await expect(more(page)).toHaveAttribute('aria-keyshortcuts', /K/);
  });
});

test.describe('Quick controls on a low stage (K37)', () => {
  for (const [scale, expected] of [
    // 340 free at 1.00 fits the panel without its second row (337); 312.8 at 1.30 does not fit it
    // without its character too (344), so All settings stands alone.
    [1, 1],
    [1.3, 3],
  ] as const) {
    test(`gives way by whole rows at text ${String(scale)}, drawn at the height the steps were decided by`, async ({
      page,
    }) => {
      await storedTextSize(page, scale);
      await live(page, { width: 1280, height: 560 });
      await page.keyboard.press('q');
      const shown = await measured(page);
      expect(shown.step).toBe(expected);
      expect(shown.character).toBe(expected < 2);
      if (expected === 3) await expect(panel(page).locator('[data-tile]')).toHaveCount(0);
      if (expected === 3)
        await expect(panel(page).getByRole('button', { name: 'All settings' })).toBeFocused();
      expect(shown.height).toBeCloseTo(
        panelHeight(
          {
            textScale: scale,
            packageTiles: shown.packageTiles,
            appTiles: shown.appTiles,
            columns: shown.columns,
          },
          shown.step as Step,
        ),
        1,
      );
      // 8 above the capsule, and 8 under the Island's band at the least.
      expect(shown.gapToCapsule).toBeCloseTo(8, 1);
      expect(shown.top).toBeGreaterThanOrEqual(16 + (scale >= 1.3 ? 48 : 40) + 8 - 0.5);
    });
  }

  test('stands whole on a tall stage, the model and the drawing agreeing at 1.30', async ({
    page,
  }) => {
    await storedTextSize(page, 1.3);
    await live(page, { width: 1280, height: 1100 });
    await page.keyboard.press('q');
    const shown = await measured(page);
    expect(shown.step).toBe(0);
    expect(shown.character).toBe(true);
    expect(shown.height).toBeCloseTo(
      panelHeight(
        {
          textScale: 1.3,
          packageTiles: shown.packageTiles,
          appTiles: shown.appTiles,
          columns: shown.columns,
        },
        0,
      ),
      1,
    );
  });

  test('counts the capsule at the text size: at 1.30 a 580 high window leaves All settings alone', async ({
    page,
  }) => {
    // Free = 520 − (24 + 83.2) − 8 − (16 + 48 + 8) = 332.8, under the 344 the panel needs without its
    // second row and character: a capsule counted at 64 would leave 352 and stand that step.
    await storedTextSize(page, 1.3);
    await live(page, { width: 1280, height: 580 });
    await page.keyboard.press('q');
    const shown = await measured(page);
    expect(shown.step).toBe(3);
    expect(shown.top).toBeGreaterThanOrEqual(16 + 48 + 8 - 0.5);
  });

  test('comes back whole when the stage grows', async ({ page }) => {
    await live(page, { width: 1280, height: 560 });
    await page.keyboard.press('q');
    expect((await measured(page)).step).toBe(1);
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect.poll(async () => (await measured(page)).step).toBe(0);
    await expect(tile(page, /^Hands free/)).toBeVisible();
  });
});

test.describe('The mode switch under 640 (V11)', () => {
  test('gives way to More’s Window tile, and the chips keep their words whole', async ({
    page,
  }) => {
    await live(page, { width: 600, height: 800 });
    await expect(page.getByRole('group', { name: 'Window mode' })).toHaveCount(0);
    const cut = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.va-bar__character, .va-chip')].flatMap((chip) =>
        [chip, ...chip.querySelectorAll<HTMLElement>('*')]
          .filter(
            (part) =>
              !part.classList.contains('convai-visually-hidden') &&
              part.scrollWidth > part.clientWidth + 0.5,
          )
          .map(
            (part) => `${part.className} ${String(part.scrollWidth)}/${String(part.clientWidth)}`,
          ),
      ),
    );
    expect(cut).toEqual([]);
    await page.setViewportSize({ width: 640, height: 800 });
    await expect(page.getByRole('group', { name: 'Window mode' })).toBeVisible();
  });

  test('Compact from the Window tile’s menu opens the floating window in the press', async ({
    page,
  }) => {
    skipIn(page, ['webkit'], limits.noPip);
    await live(page, { width: 600, height: 800 });
    await letFloatingWindowLoad(page);
    await page.keyboard.press('q');
    await tile(page, /^Window/).click();
    const menu = panel(page).getByRole('menu', { name: 'Window' });
    await expect(menu.getByRole('menuitemradio', { name: 'Full' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(menu.getByRole('menuitemradio', { name: 'Full' })).toBeFocused();

    const menuBox = await menu.boundingBox();
    const tileBox = await tile(page, /^Window/).boundingBox();
    expect(menuBox && tileBox).toBeTruthy();
    if (menuBox && tileBox) {
      expect(Math.round(menuBox.x + menuBox.width)).toBe(Math.round(tileBox.x + tileBox.width));
      expect(Math.round(tileBox.y - (menuBox.y + menuBox.height))).toBe(8);
      expect(menuBox.width).toBeGreaterThanOrEqual(180);
    }
    const full = menu.getByRole('menuitemradio', { name: 'Full' });
    expect((await full.boundingBox())?.height).toBe(32);
    // Its rows inside its 1 px edge and 4 (the kit Menu, as the source menu).
    expect(Math.round(((await full.boundingBox())?.y ?? 0) - (menuBox?.y ?? 0))).toBe(5);
    const order = await full.evaluate((row) => [...row.children].map((child) => child.className));
    expect(order).toEqual(['va-quick__menu-check', 'va-quick__menu-words']);
    const pip = await floatingWindowFrom(page, () =>
      menu.getByRole('menuitemradio', { name: 'Compact' }).click(),
    );
    await expect(pip.locator('.convai-capsule')).toBeVisible();
    await expect(panel(page)).toBeHidden();
  });

  test('without a floating window, Compact… opens the card at the stage’s corner and Got it returns to More', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      delete (window as unknown as { documentPictureInPicture?: unknown }).documentPictureInPicture;
    });
    await live(page, { width: 1280, height: 800 });
    await page.keyboard.press('q');
    // The switch explains, so the tile stands only where the switch gave way.
    await expect(tile(page, /^Window/)).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.setViewportSize({ width: 600, height: 800 });
    await page.keyboard.press('q');
    await tile(page, /^Window/).click();
    await panel(page).getByRole('menuitem', { name: 'Compact…' }).click();
    const card = page.getByRole('dialog', { name: 'Compact needs a supported browser' });
    await expect(card).toBeVisible();
    const placed = await page.evaluate(() => {
      const stage = document.querySelector('.va-stage')?.getBoundingClientRect();
      const box = document.querySelector('.va-compact-card')?.getBoundingClientRect();
      return stage && box ? { top: box.top - stage.top, right: stage.right - box.right } : null;
    });
    expect(placed).toEqual({ top: 8, right: 8 });
    await card.getByRole('button', { name: 'Got it' }).click();
    await expect(card).toBeHidden();
    await expect(more(page)).toBeFocused();
  });

  test('the Window menu: Esc closes it alone, and arrows move in it', async ({ page }) => {
    skipIn(page, ['webkit'], limits.noPip);
    await live(page, { width: 600, height: 800 });
    await page.keyboard.press('q');
    await tile(page, /^Window/).click();
    const menu = panel(page).getByRole('menu', { name: 'Window' });
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitemradio', { name: 'Compact' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(panel(page)).toBeVisible();
    await expect(tile(page, /^Window/)).toBeFocused();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
});
