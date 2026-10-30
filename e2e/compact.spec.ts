import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  closeFloatingWindow,
  closeFloatingWindows,
  enterCompact,
  letFloatingWindowLoad,
} from './compact';
import { answer, fakeRecord, openApp } from './fakeConvai';
import { engineOf, limits, skipIn } from './engines';

test.afterEach(async ({ page }) => {
  await closeFloatingWindows(page);
});

const capsule = (page: Page) => page.locator('.convai-capsule');
const compactButton = (page: Page) => page.getByRole('button', { name: 'Compact', exact: true });
const fullButton = (page: Page) => page.getByRole('button', { name: 'Full window' });

/** The sizes the app asked the browser for, recorded before the app loads. */
async function recordRequests(page: Page) {
  await page.addInitScript(() => {
    const api = (window as unknown as { documentPictureInPicture?: { requestWindow: unknown } })
      .documentPictureInPicture as { requestWindow: (o?: unknown) => Promise<Window> } | undefined;
    if (!api) return;
    const asked: unknown[] = [];
    (window as unknown as { pipAsked: unknown[] }).pipAsked = asked;
    const request = api.requestWindow.bind(api);
    api.requestWindow = (options?: unknown) => {
      asked.push(options);
      return request(options);
    };
  });
}

async function live(page: Page) {
  await recordRequests(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);
  await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
  await letFloatingWindowLoad(page);
}

/** A paste in the floating window carrying a small PNG. */
async function pasteImage(pip: Page): Promise<boolean> {
  skipIn(pip, ['firefox'], limits.paste);
  return pip.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 8;
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/png');
    });
    if (!blob) throw new Error('No blob.');
    const data = new DataTransfer();
    data.items.add(new File([blob], 'image.png', { type: 'image/png' }));
    const event = new ClipboardEvent('paste', {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(event);
    return event.defaultPrevented;
  });
}

/** The Lens's drawn pixels, summed, in the floating window. */
const lensPixels = (pip: Page) =>
  pip.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.convai-capsule canvas');
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return -1;
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    for (const value of data) sum += value;
    return sum;
  });

test.describe('Compact in a floating window (D9)', () => {
  test.skip(({ browserName }) => browserName === 'webkit', limits.noPip);
  test('moves the capsule into the floating window at its size, and the tab says where it went', async ({
    page,
  }) => {
    await live(page);
    await expect(fullButton(page)).toHaveAttribute('aria-pressed', 'true');
    const pip = await enterCompact(page);

    expect(
      await page.evaluate(() => (window as unknown as { pipAsked: unknown[] }).pipAsked),
    ).toEqual([{ width: 376, height: 80 }]);
    await expect(compactButton(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(fullButton(page)).toHaveAttribute('aria-pressed', 'false');

    await expect(pip.locator('.convai-capsule')).toHaveClass(/convai-capsule--floating/);
    await expect(pip.locator('.convai-capsule')).toHaveCSS('height', '64px');
    await expect(pip.getByText('Ask Kira')).toBeVisible();
    await expect(pip.locator('.convai-capsule__hint')).toHaveText('Hold T to talk · / to type');
    await expect(pip.getByRole('button', { name: 'Mute microphone' })).toBeVisible();
    // One capsule: the tab shows where it went and the way back.
    await expect(page.locator('.va-stage .convai-capsule')).toHaveCount(0);
    await expect(page.getByText('Kira is in the floating window')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bring Kira back' })).toBeVisible();
    // Drawn with the page's styles from its first frame, and its Inter loaded there (`fonts.check`
    // alone is true where no face is declared at all).
    await expect(pip.locator('.convai-capsule')).toHaveCSS('height', '64px');
    await expect
      .poll(() =>
        pip.evaluate(async () => {
          await document.fonts.load('600 13px Inter');
          return [...document.fonts].some(
            (f) => f.family.includes('Inter') && f.status === 'loaded',
          );
        }),
      )
      .toBe(true);
  });

  test('draws no ring on a tool pressed with the pointer when M follows, and one after Shift Tab', async ({
    page,
  }) => {
    await live(page);
    const pip = await enterCompact(page);
    // A key first, so only the floating window's own press can count as the pointer's.
    await pip.keyboard.press('Tab');
    const mute = pip.getByRole('button', { name: 'Mute microphone' });
    await mute.click();
    await pip.mouse.move(0, 0);
    const ring = () =>
      pip.evaluate(() => {
        const focused = document.activeElement;
        return focused?.matches(':focus-visible')
          ? Number.parseFloat(getComputedStyle(focused).outlineWidth)
          : 0;
      });
    await pip.keyboard.down('m');
    await pip.keyboard.up('m');
    expect(await ring()).toBe(0);
    await pip.keyboard.press('Shift+Tab');
    expect(await ring()).toBeGreaterThan(0);
  });

  test('draws the Lens on the floating window’s own frames', async ({ page }) => {
    await live(page);
    const pip = await enterCompact(page);
    await expect.poll(() => lensPixels(pip)).toBeGreaterThan(0);
    const seen = new Set<number>();
    for (let i = 0; i < 6; i++) {
      seen.add(await lensPixels(pip));
      await pip.waitForTimeout(150);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  test('talks, mutes and pauses with the keys in the floating window; Type waits for the tab', async ({
    page,
  }) => {
    await live(page);
    const pip = await enterCompact(page);
    const floating = pip.locator('.convai-capsule');

    await pip.keyboard.down('t');
    await expect(floating).toHaveAttribute('data-state', 'held');
    await pip.keyboard.up('t');
    await expect(floating).toHaveAttribute('data-state', 'ready');
    await expect.poll(async () => (await fakeRecord(page)).microphone).toEqual([true, false]);

    await pip.keyboard.press('m');
    await expect(floating).toHaveAttribute('data-state', 'muted');
    await pip.keyboard.press('m');
    await expect(floating).toHaveAttribute('data-state', 'ready');

    // "/" opens nothing in the floating window or the tab.
    await pip.keyboard.press('/');
    await expect(page.getByRole('textbox', { name: 'Message Kira' })).toHaveCount(0);
  });

  test('lets go of a held talk key when the floating window loses the keyboard', async ({
    page,
  }) => {
    await live(page);
    const pip = await enterCompact(page);
    await pip.keyboard.down('t');
    await expect(pip.locator('.convai-capsule')).toHaveAttribute('data-state', 'held');
    await pip.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(pip.locator('.convai-capsule')).toHaveAttribute('data-state', 'ready');
    await pip.keyboard.up('t');
  });

  test('stops a reply with Esc in the floating window', async ({ page }) => {
    await live(page);
    const pip = await enterCompact(page);
    const reply = answer(page, 'A ceramic mug on a desk, with a long answer to stop.');
    await expect(pip.locator('.convai-capsule')).toHaveAttribute('data-state', /thinking|speaking/);
    await pip.keyboard.press('Escape');
    await expect.poll(async () => (await fakeRecord(page)).interrupts).toBe(1);
    await reply;
  });

  test('shows no tooltip where the window has no room for one, and none in the tab', async ({
    page,
  }) => {
    await live(page);
    const pip = await enterCompact(page);
    await pip.hover('.convai-capsule__lens');
    await pip.waitForTimeout(900);
    await expect(pip.locator('.convai-tooltip')).toHaveCount(0);
    await expect(page.locator('.convai-tooltip')).toHaveCount(0);
    // Given room, the same tooltip shows in the floating window itself, never in the tab.
    await pip.setViewportSize({ width: 376, height: 160 });
    await pip.mouse.move(0, 0);
    await pip.hover('.convai-capsule__lens');
    await expect(pip.locator('.convai-tooltip')).toBeVisible();
    await expect(page.locator('.convai-tooltip')).toHaveCount(0);
  });

  test('goes back to the full window when the floating window closes, the focus on the Lens', async ({
    page,
  }) => {
    await live(page);
    const pip = await enterCompact(page);
    await closeFloatingWindow(pip);
    await expect(page.locator('.va-stage .convai-capsule')).toBeVisible();
    await expect(fullButton(page)).toHaveAttribute('aria-pressed', 'true');
    // The page's focus is on the Lens; whether its window has the system's focus back is the
    // browser's. Playwright's own Firefox gives the tab none back (a stock Firefox 158 run passed
    // this), so the Lens cannot take it there.
    if (engineOf(page) !== 'firefox') {
      await expect
        .poll(() =>
          page.evaluate(() => document.activeElement?.classList.contains('convai-capsule__lens')),
        )
        .toBe(true);
    }
    await expect(page.getByText('Kira is in the floating window')).toHaveCount(0);
  });

  test('goes back with Bring Kira back and with Full window, closing the floating window', async ({
    page,
  }) => {
    await live(page);
    let pip = await enterCompact(page);
    let closed = pip.waitForEvent('close');
    await page.getByRole('button', { name: 'Bring Kira back' }).click();
    await closed;
    await expect(page.locator('.va-stage .convai-capsule')).toBeVisible();

    pip = await enterCompact(page);
    closed = pip.waitForEvent('close');
    await fullButton(page).click();
    await closed;
    await expect(fullButton(page)).toHaveAttribute('aria-pressed', 'true');
  });

  test('answers a pasted image with the toast and Open, never twice within 10 s', async ({
    page,
  }) => {
    await live(page);
    const pip = await enterCompact(page);
    expect(await pasteImage(pip)).toBe(true);
    const notice = pip.locator('.va-compact__notice');
    await expect(notice).toContainText('Images are shared in the full window');
    await expect(pip.locator('.convai-capsule')).toHaveCount(0);

    expect((await fakeRecord(page)).visions).toEqual([]);
    // Esc closes it; another paste within 10 s says nothing.
    await pip.keyboard.press('Escape');
    await expect(notice).toHaveCount(0);
    expect(await pasteImage(pip)).toBe(true);
    await expect(notice).toHaveCount(0);
  });

  test('gives the capsule back the moment its state changes, so the talk state is never hidden', async ({
    page,
  }) => {
    await live(page);
    const pip = await enterCompact(page);
    await pasteImage(pip);
    await expect(pip.locator('.va-compact__notice')).toBeVisible();
    await pip.keyboard.down('t');
    await expect(pip.locator('.va-compact__notice')).toHaveCount(0);
    await expect(pip.locator('.convai-capsule')).toHaveAttribute('data-state', 'held');
    await pip.keyboard.up('t');
  });

  test('Open goes back to the full window', async ({ page }) => {
    await live(page);
    const pip = await enterCompact(page);
    await pasteImage(pip);
    const closed = pip.waitForEvent('close');
    await pip.getByRole('button', { name: 'Open' }).click();
    await closed;
    await expect(page.locator('.va-stage .convai-capsule')).toBeVisible();
    expect((await fakeRecord(page)).visions).toEqual([]);
  });

  test('refuses a held image without a drop cursor, with the same toast', async ({ page }) => {
    await live(page);
    const pip = await enterCompact(page);
    const result = await pip.evaluate(() => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(8)], 'mug.png', { type: 'image/png' }));
      let effect = 'unset';
      Object.defineProperty(data, 'dropEffect', {
        get: () => effect,
        set: (value: string) => {
          effect = value;
        },
      });
      const fire = (type: string) => {
        const event = new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true });
        document.body.dispatchEvent(event);
        return event.defaultPrevented;
      };
      fire('dragenter');
      const prevented = fire('dragover');
      return { effect, prevented };
    });
    // Kept from the browser, which would open the file, and shown as no drop.
    expect(result).toEqual({ effect: 'none', prevented: true });
    await expect(pip.locator('.va-compact__notice')).toBeVisible();
  });

  test('passes axe in the floating window and in the tab meanwhile', async ({ page }) => {
    await live(page);
    const pip = await enterCompact(page);
    expect((await new AxeBuilder({ page: pip }).analyze()).violations).toEqual([]);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await pasteImage(pip);
    await expect(pip.locator('.va-compact__notice')).toBeVisible();
    expect((await new AxeBuilder({ page: pip }).analyze()).violations).toEqual([]);
  });
});

test.describe('Compact where the browser has no floating windows (V11, V12)', () => {
  async function withoutFloating(page: Page) {
    await page.addInitScript(() => {
      delete (window as unknown as { documentPictureInPicture?: unknown }).documentPictureInPicture;
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await openApp(page);
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
  }

  const card = (page: Page) =>
    page.getByRole('dialog', { name: 'Compact needs a supported browser' });

  test('opens the card under the switch, focused on Got it, and Got it closes it', async ({
    page,
  }) => {
    await withoutFloating(page);
    await expect(compactButton(page)).toHaveAttribute('aria-expanded', 'false');
    await compactButton(page).click();
    await expect(card(page)).toBeVisible();
    await expect(card(page)).toContainText(
      'Kira stays in this tab because this browser does not support floating windows. Try a desktop browser with Document Picture-in-Picture support.',
    );
    await expect(compactButton(page)).toHaveAttribute('aria-expanded', 'true');
    // It opens the card and turns nothing on: no toggle state.
    await expect(compactButton(page)).not.toHaveAttribute('aria-pressed');
    await expect(card(page).getByRole('button', { name: 'Got it' })).toBeFocused();

    const box = await card(page).boundingBox();
    const control = await page.locator('.va-mode').boundingBox();
    const stage = await page.locator('.va-stage').boundingBox();
    if (!box || !control || !stage) throw new Error('not laid out');
    expect(Math.round(box.x + box.width)).toBe(Math.round(control.x + control.width));
    expect(stage.y + 8).toBeGreaterThan(control.y + control.height + 8);
    expect(Math.round(box.y)).toBe(Math.round(stage.y + 8));
    // Its left edge keeps 8 from the stage frame's side.
    const sides = [stage.x, stage.x + stage.width];
    expect(Math.min(...sides.map((side) => Math.abs(box.x - side)))).toBeGreaterThanOrEqual(8);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await card(page).getByRole('button', { name: 'Got it' }).click();
    await expect(card(page)).toHaveCount(0);
    await expect(compactButton(page)).toBeFocused();
    // The capsule stayed in the tab.
    await expect(page.locator('.va-stage .convai-capsule')).toBeVisible();
  });

  test('closes with Esc, a press outside, or a second press on Compact', async ({ page }) => {
    await withoutFloating(page);
    await compactButton(page).click();
    await page.keyboard.press('Escape');
    await expect(card(page)).toHaveCount(0);
    await expect(compactButton(page)).toBeFocused();

    await compactButton(page).click();
    await expect(card(page)).toBeVisible();
    await page.mouse.click(300, 400);
    await expect(card(page)).toHaveCount(0);

    await compactButton(page).click();
    await expect(card(page)).toBeVisible();
    await compactButton(page).click();
    await expect(card(page)).toHaveCount(0);
  });

  test('names Compact by the card’s title in its tooltip once the card was seen', async ({
    page,
  }) => {
    await withoutFloating(page);
    await compactButton(page).hover();
    await expect(page.locator('.convai-tooltip')).toHaveText('Compact');
    await compactButton(page).click();
    await card(page).getByRole('button', { name: 'Got it' }).click();
    await page.mouse.move(0, 0);
    await compactButton(page).hover();
    await expect(page.locator('.convai-tooltip')).toHaveText('Compact needs a supported browser');
  });
});
