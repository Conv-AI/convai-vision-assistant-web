import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { emit, fakeRecord, openApp } from './fakeConvai';
import {
  answerPickers,
  fakePicker,
  pickerCalls,
  stopFromBrowser,
  type PickerAnswer,
} from './fakeDisplay';
import { launchOptions } from './launch';
import { limits, skipIn } from './engines';

test.use({ launchOptions: launchOptions({ tabTitle: 'Vision Assistant e2e share fixture' }) });

const capsule = (page: Page) => page.locator('.convai-capsule');
const chip = (page: Page) => page.locator('.va-chip');
const menu = (page: Page) => page.getByRole('menu', { name: 'What Kira sees' });
const card = (page: Page) =>
  page.getByRole('alertdialog', { name: 'Share a tab, window or screen' });
const row = (page: Page, name: string) => menu(page).getByRole('menuitemradio', { name });
const island = (page: Page) => page.locator('.va-stage__island');

async function live(
  page: Page,
  answers: PickerAnswer[] = ['browser'],
  cardShown = 0,
  options: Parameters<typeof openApp>[1] = {},
) {
  await fakePicker(page, answers);
  // The card's count is the device's: a test can start as if it was shown before.
  if (cardShown > 0) {
    await page.addInitScript((shown) => {
      window.localStorage.setItem('va.share-card-shown', String(shown));
    }, cardShown);
  }
  await openApp(page, options);
  await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
}

async function pick(page: Page, name: string) {
  await chip(page).click();
  await row(page, name).click();
}

async function shareTab(page: Page) {
  await pick(page, 'Browser tab…');
  await expect(chip(page).locator('.va-chip__slot')).toHaveAttribute('data-mark', 'live');
}

test.describe('the web rows', () => {
  test('come after the cameras in the component’s order, before Image… and Nothing', async ({
    page,
  }) => {
    await live(page);
    await chip(page).click();
    const screen = menu(page).getByRole('group', { name: 'Screen' });
    await expect(screen.getByRole('menuitemradio')).toHaveText([
      'Entire screen…',
      'Browser tab…',
      'Window…',
      'Region…',
    ]);
    // Image… stands outside the Screen group, after it .
    await expect(screen.getByText(/Image/)).toHaveCount(0);
    const rows = menu(page).getByRole('menuitemradio');
    await expect(rows.nth(-2)).toHaveText('Image…or drop a file');
    await expect(rows.last()).toHaveText('Nothing · voice only');
    expect(await pickerCalls(page)).toEqual([]);
  });

  test('are absent where the browser has no picker', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: undefined });
    });
    await openApp(page);
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
    await chip(page).click();
    await expect(menu(page).getByRole('group', { name: 'Screen' })).toHaveCount(0);
  });
});

test.describe('the share card (D5)', () => {
  test('says why and what the browser asks next, with Continue focused', async ({ page }) => {
    await live(page);
    await pick(page, 'Browser tab…');

    await expect(card(page)).toBeVisible();
    await expect(menu(page)).toBeHidden();
    await expect(card(page)).toContainText('Kira sees only what you share.');
    await expect(card(page)).toContainText('A tab gives Kira the sharpest view.');
    await expect(card(page).getByRole('listitem')).toHaveText([
      '1Choose what to share',
      '2Confirm in your browser',
    ]);
    await expect(card(page).getByRole('button', { name: 'Continue' })).toBeFocused();
    // The browser is asked only once the person continues.
    expect(await pickerCalls(page)).toEqual([]);
    const results = await new AxeBuilder({ page }).include('.convai-dialog').analyze();
    expect(results.violations).toEqual([]);
  });

  test('says the row’s own line for a window and for the entire screen', async ({ page }) => {
    await live(page);
    await pick(page, 'Window…');
    await expect(card(page)).toContainText('Choose Window.');
    await page.keyboard.press('Escape');
    await pick(page, 'Entire screen…');
    await expect(card(page)).toContainText('Choose Entire screen.');
  });

  test('Continue opens the browser’s picker in the same press, with the row’s kind first', async ({
    page,
  }) => {
    await live(page);
    await pick(page, 'Browser tab…');
    await card(page).getByRole('button', { name: 'Continue' }).click();

    await expect(chip(page)).toHaveAccessibleName('Browser tab, live');
    const [call] = await pickerCalls(page);
    expect(call).toMatchObject({
      activated: true,
      options: {
        audio: false,
        selfBrowserSurface: 'exclude',
        monitorTypeSurfaces: 'exclude',
        video: { displaySurface: 'browser', frameRate: { ideal: 15, max: 30 } },
      },
    });
    await expect(chip(page)).toBeFocused();
  });

  test('Cancel, Esc and a press outside ask nothing and give the focus back to the chip', async ({
    page,
  }) => {
    await live(page, ['browser'], 0);
    await pick(page, 'Browser tab…');
    await card(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(card(page)).toBeHidden();
    await expect(chip(page)).toBeFocused();

    await pick(page, 'Window…');
    await page.keyboard.press('Escape');
    await expect(card(page)).toBeHidden();
    await expect(chip(page)).toBeFocused();
    expect(await pickerCalls(page)).toEqual([]);
    expect((await fakeRecord(page)).visions).toEqual([]);
  });

  test('holds the focus inside, even after a press on its words', async ({ page }) => {
    await live(page);
    await pick(page, 'Browser tab…');
    await card(page).getByText('Kira sees only what you share.').click();
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      // Never the page behind: the dialog's actions, or the browser's own toolbar past the last one.
      const behind = await page.evaluate(() => {
        const at = document.activeElement;
        return at !== null && at !== document.body && at.closest('[role="alertdialog"]') === null;
      });
      expect(behind).toBe(false);
    }
    await expect(card(page).getByRole('button', { name: 'Cancel' })).toBeVisible();
  });

  test('closes on a press on the scrim', async ({ page }) => {
    await live(page);
    await pick(page, 'Browser tab…');
    await page.mouse.click(8, 400);
    await expect(card(page)).toBeHidden();
    expect(await pickerCalls(page)).toEqual([]);
  });

  test('comes the first two times only, then the row asks the browser directly', async ({
    page,
  }) => {
    await live(page);
    for (let i = 0; i < 2; i++) {
      await pick(page, 'Browser tab…');
      await expect(card(page)).toBeVisible();
      await page.keyboard.press('Escape');
    }
    await pick(page, 'Browser tab…');
    await expect(card(page)).toBeHidden();
    await expect(chip(page)).toHaveAccessibleName('Browser tab, live');
    expect(await pickerCalls(page)).toHaveLength(1);
    expect((await pickerCalls(page))[0]?.activated).toBe(true);
  });

  test('keeps the count across visits', async ({ page }) => {
    await live(page, ['browser'], 2);
    await pick(page, 'Window…');
    await expect(card(page)).toBeHidden();
    expect(await pickerCalls(page)).toHaveLength(1);
  });
});

test.describe('sharing a tab, a window or a screen', () => {
  test('publishes the picture as screen_share and shows it inset with its line', async ({
    page,
  }) => {
    skipIn(page, ['webkit'], limits.noPlayback);

    await page.setViewportSize({ width: 1440, height: 900 });
    await live(page, ['browser'], 2);
    // "Now sharing" is a 2 s toast: what the Island said is kept as it comes, so the checks before
    // it cannot outlast it.
    await page.evaluate(() => {
      const texts: string[] = [];
      (window as unknown as { islandTexts: string[] }).islandTexts = texts;
      new MutationObserver(() => {
        const text = document.querySelector('.va-stage__island')?.textContent.trim() ?? '';
        if (text && texts.at(-1) !== text) texts.push(text);
      }).observe(document, { subtree: true, childList: true, characterData: true });
    });
    await shareTab(page);

    const visions = (await fakeRecord(page)).visions;
    expect(visions).toHaveLength(1);
    expect(visions[0]).toMatchObject({ kind: 'screen_share', canvas: true });
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { islandTexts: string[] }).islandTexts))
      .toContainEqual(expect.stringContaining('Now sharing · Browser tab'));
    await expect(page.locator('.va-preview__line')).toHaveText(
      'Live preview · Kira sees this while you share',
    );
    // The picture is the share's, as it is: fitted whole, never mirrored, 28 in, 64 down.
    const preview = await page.evaluate(() => {
      const stage = document.querySelector('.va-stage')?.getBoundingClientRect();
      const frame = document.querySelector('.va-preview__frame')?.getBoundingClientRect();
      const video = document.querySelector<HTMLVideoElement>('.va-preview__video');
      return {
        left: (frame?.left ?? 0) - (stage?.left ?? 0),
        top: (frame?.top ?? 0) - (stage?.top ?? 0),
        ratio: (frame?.width ?? 0) / (frame?.height ?? 1),
        transform: video ? getComputedStyle(video).transform : '',
        playing: (video?.videoWidth ?? 0) > 0,
      };
    });
    expect(preview.playing).toBe(true);
    expect(preview.transform).toBe('none');
    expect(preview.ratio).toBeCloseTo(16 / 9, 2);
    // A 16:9 share is as wide as the place allows: at its left and top, 28 in and 64 down.
    expect(preview.top).toBe(64);
    expect(preview.left).toBe(28);
    // No camera mirror, no viewfinder: this is not the camera stage.
    await expect(page.locator('.va-camera')).toHaveCount(0);
  });

  test('says the short line while a banner stands in its row, and the whole one after (V19)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await live(page, ['browser'], 2, { microphone: 'blocked' });
    await shareTab(page);
    const line = page.locator('.va-preview__line');
    await expect(line).toHaveText('Live preview · Kira sees this while you share');
    await page.keyboard.down('t');
    await page.waitForTimeout(250);
    await page.keyboard.up('t');
    await expect(island(page)).toContainText('The microphone is blocked');
    await expect(line).toHaveText('Live preview');
    await island(page).getByRole('button', { name: 'Type instead' }).click();
    await expect(line).toHaveText('Live preview · Kira sees this while you share');
  });

  test('says the short line where the widest toast could reach the whole one (V13)', async ({
    page,
  }) => {
    // At 1280 docked the stage is too narrow for the whole line beside a 408 toast.
    await page.setViewportSize({ width: 1280, height: 800 });
    await live(page, ['browser'], 2);
    await shareTab(page);
    await expect(page.locator('.va-preview__line')).toHaveText('Live preview');
  });

  for (const [surface, rowName, kind] of [
    ['window', 'Window…', 'Window'],
    ['monitor', 'Entire screen…', 'Screen'],
    // A tab row whose picker gave a window: the browser's answer decides.
    ['window', 'Browser tab…', 'Window'],
  ] as const) {
    test(`names a ${surface} chosen from ${rowName} as ${kind}`, async ({ page }) => {
      await live(page, [surface], 2);
      await pick(page, rowName);
      await expect(chip(page)).toHaveAccessibleName(`${kind}, live`);
      await expect(island(page)).toContainText(`Now sharing · ${kind}`);
      const [call] = await pickerCalls(page);
      // Only Entire screen… offers whole screens in the picker.
      expect(call?.options.monitorTypeSurfaces).toBe(
        rowName === 'Entire screen…' ? 'include' : 'exclude',
      );
      await chip(page).click();
      await expect(row(page, kind === 'Screen' ? 'Entire screen…' : 'Window…')).toHaveAttribute(
        'aria-checked',
        'true',
      );
    });
  }

  test('stops the camera only once the browser gave a choice: one at a time', async ({ page }) => {
    await live(page, ['browser'], 2);
    await chip(page).click();
    await menu(page)
      .getByRole('group', { name: 'Camera' })
      .getByRole('menuitemradio')
      .first()
      .click();
    await expect(chip(page)).toHaveAccessibleName(/^Camera.*, live$/);

    await shareTab(page);
    const record = await fakeRecord(page);
    expect(record.visions.map((v) => v?.kind ?? null)).toEqual(['camera', null, 'screen_share']);
    const cameraLight = await page.evaluate(() => window.fakeConvai?.tracks[0]?.readyState);
    expect(cameraLight).toBe('ended');
  });

  test('marks a question asked while a tab is shared as asked with the tab', async ({ page }) => {
    await live(page, ['browser'], 2);
    await shareTab(page);
    await page.keyboard.press('/');
    await page.keyboard.type('What is this?');
    await page.keyboard.press('Enter');
    await expect(page.locator('.va-moment__meta').first()).toHaveText(/^Browser tab · /);
  });

  test('opens the picker while Kira answers, and switches once the reply ends', async ({
    page,
  }) => {
    await live(page, ['browser'], 2);
    await emit(page, { type: 'activity', activity: 'speaking' });
    await pick(page, 'Browser tab…');
    expect(await pickerCalls(page)).toHaveLength(1);
    await expect(chip(page)).toHaveAccessibleName('Nothing shared');
    expect((await fakeRecord(page)).visions).toEqual([]);

    await emit(page, { type: 'activity', activity: 'idle' });
    await expect(chip(page)).toHaveAccessibleName('Browser tab, live');
  });

  test('has no accessibility violations while a tab is shared', async ({ page }) => {
    await live(page, ['browser'], 2);
    await shareTab(page);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe('a picker that gives nothing', () => {
  test('closed with nothing shared: the Island says "Nothing shared"', async ({ page }) => {
    await live(page, ['cancel'], 2);
    await pick(page, 'Browser tab…');
    await expect(island(page)).toContainText('Nothing shared');
    await expect(chip(page)).toHaveAccessibleName('Nothing shared');
  });

  test('closed while the camera is shared: the camera stays, and nothing is said', async ({
    page,
  }) => {
    await live(page, ['abort'], 2);
    await chip(page).click();
    await menu(page)
      .getByRole('group', { name: 'Camera' })
      .getByRole('menuitemradio')
      .first()
      .click();
    await expect(chip(page)).toHaveAccessibleName(/^Camera.*, live$/);

    await pick(page, 'Window…');
    await expect.poll(async () => (await pickerCalls(page)).length).toBe(1);
    await page.waitForTimeout(300);
    await expect(chip(page)).toHaveAccessibleName(/^Camera.*, live$/);
    await expect(island(page)).not.toContainText('Nothing shared');
    expect((await fakeRecord(page)).visions.map((v) => v?.kind ?? null)).toEqual(['camera']);
  });

  test('a share the browser cannot start offers Try again, which asks again', async ({ page }) => {
    await live(page, ['fail', 'browser'], 2);
    await pick(page, 'Browser tab…');
    await expect(island(page)).toContainText('Sharing couldn’t start');
    await island(page).getByRole('button', { name: 'Try again' }).click();
    await expect(chip(page)).toHaveAccessibleName('Browser tab, live');
    expect(await pickerCalls(page)).toHaveLength(2);
  });
});

test.describe('a share stopped from the browser’s own bar', () => {
  test('shares nothing, says so once in a status toast, and the stage says "Sharing stopped" (H11e)', async ({
    page,
  }) => {
    await live(page, ['browser'], 2);
    await shareTab(page);
    await stopFromBrowser(page);

    await expect(chip(page)).toHaveAccessibleName('Nothing shared');

    await expect(island(page)).toContainText('Sharing stopped from the browser');
    await expect(page.locator('.convai-island__banner')).toHaveCount(0);
    await expect(island(page).getByRole('button', { name: /Share again/ })).toHaveCount(0);
    await expect(page.getByText('Sharing stopped', { exact: true })).toBeVisible();
    await expect(page.getByText('Show Kira something')).toHaveCount(0);
    expect((await fakeRecord(page)).visions.at(-1)).toBeNull();
    await expect(island(page)).not.toContainText('Sharing stopped from the browser', {
      timeout: 6000,
    });

    // The stage's own action is the way back.
    await answerPickers(page, ['browser']);
    await page.getByRole('button', { name: 'Choose what Kira sees' }).click();
    await menu(page)
      .getByRole('menuitemradio', { name: /^Browser tab…/ })
      .click();
    await expect(chip(page)).toHaveAccessibleName('Browser tab, live');
    await expect(page.getByText('Sharing stopped', { exact: true })).toHaveCount(0);
  });
});
