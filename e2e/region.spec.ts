import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { fakeRecord, openApp, type FakeOptions } from './fakeConvai';
import { textSizeInSettings } from './textSize';
import {
  answerPickers,
  fakePicker,
  pickerCalls,
  quarterColors,
  stopFromBrowser,
  type FakeSurface,
  type PickerAnswer,
} from './fakeDisplay';
import { launchOptions } from './launch';
import { limits, skipIn } from './engines';

test.use({ launchOptions: launchOptions({ tabTitle: 'Vision Assistant e2e share fixture' }) });

test.skip(({ browserName }) => browserName === 'webkit', limits.noPlayback);

const capsule = (page: Page) => page.locator('.convai-capsule');
const chip = (page: Page) => page.locator('.va-chip');
const menu = (page: Page) => page.getByRole('menu', { name: 'What Kira sees' });
const row = (page: Page, name: string | RegExp) => menu(page).getByRole('menuitemradio', { name });
const card = (page: Page) =>
  page.getByRole('alertdialog', { name: 'Share a tab, window or screen' });
const island = (page: Page) => page.locator('.va-stage__island');
const crop = (page: Page) => page.getByRole('group', { name: 'Choose an area' });
const frame = (page: Page) => page.locator('.va-crop__frame');
const readout = (page: Page) => page.locator('.va-crop__readout');
const shareArea = (page: Page) => crop(page).getByRole('button', { name: 'Share area' });
const cancel = (page: Page) => crop(page).getByRole('button', { name: 'Cancel' });

/** A 1280 × 800 share in four flat quarters, so the published part can be told by its color. */
const quarters: FakeSurface = { width: 1280, height: 800, quarters: true };

async function live(
  page: Page,
  {
    answers = ['browser'],
    cardShown = 2,
    surface = quarters,
    options = {},
  }: {
    answers?: PickerAnswer[];
    cardShown?: number;
    surface?: FakeSurface;
    options?: FakeOptions;
  } = {},
) {
  await fakePicker(page, answers, surface);
  if (cardShown > 0) {
    await page.addInitScript((shown) => {
      window.localStorage.setItem('va.share-card-shown', String(shown));
    }, cardShown);
  }
  await openApp(page, options);
  await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
}

async function openCrop(page: Page) {
  await chip(page).click();
  await row(page, 'Region…').click();
  await expect(crop(page)).toBeVisible();
  // The share's first picture: the readout says its size.
  await expect(readout(page)).toBeVisible();
}

async function shareRegion(page: Page) {
  await shareArea(page).click();
  await expect(chip(page).locator('.va-chip__slot')).toHaveAttribute('data-mark', 'live');
}

/** A drag on the share's picture, between two points given as fractions of it. */
async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await expect(frame(page)).not.toHaveAttribute('data-waiting', 'true');
  // Hover waits for a stable frame after video metadata changes its aspect ratio.
  await frame(page).hover();
  const box = await frame(page).boundingBox();
  if (!box) throw new Error('The crop has no picture.');
  await page.mouse.move(box.x + from.x * box.width, box.y + from.y * box.height);
  await page.mouse.down();
  await page.mouse.move(box.x + to.x * box.width, box.y + to.y * box.height, { steps: 6 });
  await page.mouse.up();
}

/** The picture last handed to the fake Convai: its size, and the color in its middle. */
async function published(page: Page) {
  return page.evaluate(() => {
    const tracks = window.fakeConvai?.tracks ?? [];
    const track = tracks.at(-1);
    const canvas = track && window.fakeConvai?.canvasOf(track);
    if (!canvas) return null;
    const context = canvas.getContext('2d');
    const pixel = context?.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
    return {
      width: canvas.width,
      height: canvas.height,
      middle: pixel ? [pixel[0], pixel[1], pixel[2]] : null,
      live: track.readyState === 'live',
    };
  });
}

/** Whether the browser's share (the fake picker's last track) is still running. */
const shareRunning = (page: Page) =>
  page.evaluate(() => window.fakeDisplay?.tracks.at(-1)?.readyState === 'live');

const near = (got: readonly (number | undefined)[] | null | undefined, want: readonly number[]) =>
  got?.every((v, i) => Math.abs((v ?? -99) - (want[i] ?? 0)) < 12) === true;

test.describe('the menu', () => {
  test('offers Region… after Window…, and Change area… only while a region is shared', async ({
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
    await expect(menu(page).getByRole('menuitem', { name: 'Change area…' })).toHaveCount(0);
    await row(page, 'Region…').click();
    await expect(crop(page)).toBeVisible();
    await shareRegion(page);

    await chip(page).click();
    // Only the region's row is checked, with its size; the tab under it is not.
    await expect(row(page, /Region…/)).toHaveAttribute('aria-checked', 'true');
    await expect(row(page, /Region…/)).toContainText('640 × 400');
    await expect(row(page, 'Browser tab…')).toHaveAttribute('aria-checked', 'false');
    const rows = screen.locator('[role="menuitemradio"], [role="menuitem"]');
    await expect(rows).toHaveText([
      'Entire screen…',
      'Browser tab…',
      'Window…',
      'Region…640 × 400',
      'Change area…',
    ]);
    expect(await pickerCalls(page)).toHaveLength(1);
  });

  test('goes through the share card with the tab’s line, and asks the picker in the press', async ({
    page,
  }) => {
    await live(page, { cardShown: 0 });
    await chip(page).click();
    await row(page, 'Region…').click();
    await expect(card(page)).toContainText('A tab gives Kira the sharpest view.');
    expect(await pickerCalls(page)).toEqual([]);
    await card(page).getByRole('button', { name: 'Continue' }).click();
    await expect(crop(page)).toBeVisible();
    const [call] = await pickerCalls(page);
    // A tab first, and a whole screen offered: a region can be of anything shared.
    expect(call).toMatchObject({
      activated: true,
      options: {
        audio: false,
        selfBrowserSurface: 'exclude',
        monitorTypeSurfaces: 'include',
        video: { displaySurface: 'browser' },
      },
    });
    expect(await page.evaluate(() => localStorage.getItem('va.share-card-shown'))).toBe('1');
  });
});

test.describe('the crop', () => {
  test('opens in place with the middle half ready, the chip passive and nothing shown to Kira', async ({
    page,
  }) => {
    await live(page);
    await openCrop(page);
    await expect(readout(page)).toHaveText('640 × 400');

    await expect(page.locator('.va-chip--passive')).toHaveText('Choosing an area');
    await expect(page.getByRole('button', { name: /Choosing an area/ })).toHaveCount(0);
    await expect(page.locator('.va-chip__slot, .va-chip__chevron')).toHaveCount(0);
    await expect(crop(page).locator('.va-crop__line')).toHaveText(
      'Drag to change the area · Esc to cancel',
    );
    await expect(shareArea(page)).toBeFocused();
    await expect(shareArea(page)).toHaveClass(/convai-button--primary/);
    // The capsule stays: talking goes on.
    await expect(capsule(page)).toBeVisible();
    expect((await fakeRecord(page)).visions).toEqual([]);
    const results = await new AxeBuilder({ page }).include('.va-crop').analyze();
    expect(results.violations).toEqual([]);
  });

  test('stands the bar 12 under the title bar and the picture 16 under it', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await live(page);
    await openCrop(page);
    const stage = await page.locator('.va-stage').boundingBox();
    const bar = await page.locator('.va-crop__bar').boundingBox();
    const picture = await frame(page).boundingBox();
    if (!stage || !bar || !picture) throw new Error('No layout.');
    expect(bar.y - stage.y).toBeCloseTo(12, 0);
    expect(bar.height).toBe(56);
    expect(picture.y - stage.y).toBeCloseTo(84, 0);
    // The area's edge: mint 2 and the onLight hairline, inside the edge's own box.
    const edge = await page
      .locator('.va-crop__edge')
      .evaluate((element) => getComputedStyle(element).boxShadow);
    expect(edge).toContain('rgba(0, 0, 0, 0.4) 0px 0px 0px 1px inset');
    expect(edge).toContain('rgb(117, 219, 168) 0px 0px 0px 3px inset');

    const line = await page.locator('.va-crop__line').boundingBox();
    const share = await shareArea(page).boundingBox();
    if (!line || !share) throw new Error('No bar parts.');
    expect(line.x - bar.x).toBeCloseTo(20, 0);
    expect(bar.x + bar.width - (share.x + share.width)).toBeCloseTo(8, 0);
    expect(
      await page.locator('.va-crop__bar').evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.borderLeftWidth, style.boxShadow];
      }),
    ).toEqual(['0px', 'rgb(38, 38, 43) 0px 0px 0px 1px inset']);
  });

  test('grows the bar with the text, as its 40 buttons do, and keeps the picture 16 under it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await live(page);
    await textSizeInSettings(page, 1.3);
    await openCrop(page);
    const bar = await page.locator('.va-crop__bar').boundingBox();
    const button = await shareArea(page).boundingBox();
    const picture = await frame(page).boundingBox();
    if (!bar || !button || !picture) throw new Error('No layout.');
    expect(bar.height).toBeCloseTo(68, 0);
    expect(button.height).toBeCloseTo(52, 0);
    expect(button.y - bar.y).toBeCloseTo(8, 0);
    expect(picture.y - (bar.y + bar.height)).toBeCloseTo(16, 0);
  });

  test('tells a screen reader the area once, and after each gesture, as Share area’s description', async ({
    page,
  }) => {
    skipIn(page, ['firefox'], limits.subpixel);
    await live(page);
    await openCrop(page);
    const said = crop(page).locator('.convai-visually-hidden[role="status"]');
    await expect(said).toHaveText('Area 640 by 400 pixels');
    await expect(shareArea(page)).toHaveAccessibleDescription('Area 640 by 400 pixels');
    await expect(readout(page)).toHaveAttribute('aria-hidden', 'true');
    await drag(page, { x: 0.95, y: 0.95 }, { x: 0.55, y: 0.55 });
    await expect(said).toHaveText('Area 512 by 320 pixels');
  });

  test('shares the area as Kira sees it: a canvas of its pixels, named by its size', async ({
    page,
  }) => {
    skipIn(page, ['firefox'], limits.subpixel);
    await live(page);
    await openCrop(page);
    // A new area over the bottom-right quarter, drawn from outside the middle half.
    await drag(page, { x: 0.95, y: 0.95 }, { x: 0.55, y: 0.55 });
    await expect(readout(page)).toHaveText('512 × 320');
    await shareRegion(page);

    await expect(chip(page)).toHaveAccessibleName('Region · 512 × 320, live');
    await expect(island(page)).toContainText('Now sharing · Region');
    const record = await fakeRecord(page);
    expect(record.visions).toHaveLength(1);
    expect(record.visions[0]).toMatchObject({ kind: 'screen_share', canvas: true });
    const shareTrack = await page.evaluate(() => window.fakeDisplay?.tracks.at(-1)?.id);
    expect(record.visions[0]?.trackId).not.toBe(shareTrack);
    const picture = await published(page);
    expect(picture).toMatchObject({ width: 512, height: 320, live: true });
    expect(near(picture?.middle, quarterColors.bottomRight)).toBe(true);
    // The preview shows what Kira sees: the area, not the whole share.
    await expect(page.locator('.va-preview__frame')).toBeVisible();
    expect(await shareRunning(page)).toBe(true);
  });

  test('moves the area by its inside and resizes it by a handle, never under 64 pixels', async ({
    page,
  }) => {
    await live(page);
    await openCrop(page);
    // Moved by a quarter of the width: still 640 × 400, now over the right half.
    await drag(page, { x: 0.5, y: 0.5 }, { x: 0.75, y: 0.5 });
    await expect(readout(page)).toHaveText('640 × 400');
    // The bottom-right handle dragged far past the top-left corner stops 64 from it.
    await drag(page, { x: 0.999, y: 0.75 }, { x: 0.1, y: 0.1 });
    await expect(readout(page)).toHaveText('64 × 64');
    // A click elsewhere is no area: the one before stays.
    await drag(page, { x: 0.1, y: 0.9 }, { x: 0.11, y: 0.91 });
    await expect(readout(page)).toHaveText('64 × 64');
  });

  test('shares on Return', async ({ page }) => {
    skipIn(page, ['firefox'], limits.subpixel);
    await live(page);
    await openCrop(page);
    await drag(page, { x: 0.05, y: 0.05 }, { x: 0.45, y: 0.45 });
    await expect(shareArea(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(chip(page)).toHaveAccessibleName('Region · 512 × 320, live');
    expect(near((await published(page))?.middle, quarterColors.topLeft)).toBe(true);
  });

  test('on Esc of a first crop shares nothing, ends the browser’s share, and says nothing', async ({
    page,
  }) => {
    await live(page);
    await openCrop(page);
    await page.keyboard.press('Escape');
    await expect(crop(page)).toHaveCount(0);
    await expect(chip(page)).toHaveAccessibleName('Nothing shared');
    await expect(chip(page)).toBeFocused();
    expect(await shareRunning(page)).toBe(false);
    expect((await fakeRecord(page)).visions).toEqual([]);
    await expect(island(page).locator('.convai-island__surface')).toBeHidden();
  });

  test('keeps the area’s marks in a Windows contrast theme', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await live(page);
    await openCrop(page);
    for (const part of ['.va-crop__area', '.va-crop__edge', '.va-crop__handle']) {
      const adjust = await page
        .locator(part)
        .first()
        .evaluate((element) => getComputedStyle(element).forcedColorAdjust);
      expect(adjust, part).toBe('none');
    }
    const edge = await page
      .locator('.va-crop__edge')
      .evaluate((element) => getComputedStyle(element).boxShadow);
    expect(edge).toContain('rgb(117, 219, 168)');
  });

  test('lets Esc close what stands over the crop first: the Type field, then the crop', async ({
    page,
  }) => {
    await live(page);
    await openCrop(page);
    await page.keyboard.press('/');
    const field = page.getByRole('textbox', { name: 'Message Kira' });
    await expect(field).toBeFocused();
    await page.keyboard.type('What is this?');
    await page.keyboard.press('Escape');
    await expect(field).toHaveValue('');
    await expect(crop(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(field).toHaveCount(0);
    await expect(crop(page)).toBeVisible();
    expect(await shareRunning(page)).toBe(true);
    // The focus went back to the Type tool, with no tooltip to take the next Esc.
    await expect(page.getByRole('button', { name: 'Type', exact: true })).toBeFocused();
    await expect(page.locator('[role="tooltip"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(crop(page)).toHaveCount(0);
    expect(await shareRunning(page)).toBe(false);
  });

  test('Cancel does the same, and keeps the letters talking meanwhile', async ({ page }) => {
    await live(page);
    await openCrop(page);
    await page.keyboard.down('t');
    await expect(capsule(page)).toHaveAttribute('data-state', 'held');
    await page.keyboard.up('t');
    await cancel(page).click();
    await expect(crop(page)).toHaveCount(0);
    expect(await shareRunning(page)).toBe(false);
  });

  test('waits for the share’s first picture with only the way out', async ({ page }) => {
    await live(page);
    // The share's picture is held back until the test lets it come.
    await page.evaluate(() => {
      (window as unknown as { heldPlay: () => void }).heldPlay = () => undefined;
      const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'srcObject');
      Object.defineProperty(HTMLVideoElement.prototype, 'srcObject', {
        configurable: true,
        get() {
          return descriptor?.get?.call(this) as unknown;
        },
        set(value: unknown) {
          const video = this as HTMLVideoElement;
          if (video.classList.contains('va-crop__video') && value) {
            (window as unknown as { heldPlay: () => void }).heldPlay = () => {
              descriptor?.set?.call(video, value);
            };
            return;
          }
          descriptor?.set?.call(video, value);
        },
      });
    });
    await chip(page).click();
    await row(page, 'Region…').click();
    const waiting = crop(page).locator('.va-crop__waiting');
    await expect(waiting).toHaveText('Waiting for your browser…');
    await expect(crop(page).locator('.va-crop__line')).toHaveText('Esc to cancel');
    await expect(shareArea(page)).toBeDisabled();

    await expect(cancel(page)).toBeFocused();

    await expect(waiting).toContainText('Taking longer than usual', { timeout: 10_000 });
    const before = await frame(page).boundingBox();
    await page.evaluate(() => {
      (window as unknown as { heldPlay: () => void }).heldPlay();
    });
    await expect(readout(page)).toHaveText('640 × 400');
    await expect(shareArea(page)).toBeEnabled();
    await expect(shareArea(page)).toBeFocused();
    await expect(crop(page).locator('.va-crop__line')).toHaveText(
      'Drag to change the area · Esc to cancel',
    );
    // The frame stood where a 16:9 picture does; this one is 16:10, so only its height grew.
    const after = await frame(page).boundingBox();
    expect(after?.y).toBeCloseTo(before?.y ?? 0, 0);
  });
});

test.describe('changing the area', () => {
  test('crops the same share again; the region stays until Share area, and Esc keeps it', async ({
    page,
  }) => {
    await live(page);
    await openCrop(page);
    await shareRegion(page);
    await chip(page).click();
    await menu(page).getByRole('menuitem', { name: 'Change area…' }).click();
    await expect(crop(page)).toBeVisible();
    await expect(readout(page)).toHaveText('640 × 400');
    await expect(page.locator('.va-chip--passive')).toHaveText('Choosing an area');
    // The crop draws the whole share where the preview stood; the preview is not drawn under it.
    await expect(page.locator('.va-preview')).toHaveCount(0);
    expect(await pickerCalls(page)).toHaveLength(1);

    await page.keyboard.press('Escape');
    await expect(crop(page)).toHaveCount(0);
    await expect(chip(page)).toHaveAccessibleName('Region · 640 × 400, live');
    expect((await fakeRecord(page)).visions).toHaveLength(1);

    await chip(page).click();
    await menu(page).getByRole('menuitem', { name: 'Change area…' }).click();
    // The bottom-right handle out to the share's corner.
    await drag(page, { x: 0.75, y: 0.75 }, { x: 1.1, y: 1.1 });
    await expect(readout(page)).toHaveText('960 × 600');
    // Until "Share area" Kira keeps seeing the area before.
    expect((await fakeRecord(page)).visions).toHaveLength(1);
    await shareArea(page).click();
    await expect(chip(page)).toHaveAccessibleName('Region · 960 × 600, live');
    const record = await fakeRecord(page);
    expect(record.visions).toHaveLength(2);
    expect(record.visions.every((v) => v !== null)).toBe(true);
    expect(await shareRunning(page)).toBe(true);
    expect((await published(page))?.width).toBe(960);
  });
});

test.describe('a share stopped from the browser', () => {
  test('while cropped: a status toast, and Region… crops with the area drawn so far', async ({
    page,
  }) => {
    await live(page);
    await openCrop(page);
    await drag(page, { x: 0.95, y: 0.95 }, { x: 0.55, y: 0.55 });
    await stopFromBrowser(page);
    await expect(crop(page)).toHaveCount(0);
    await expect(island(page)).toContainText('Sharing stopped from the browser');
    await expect(page.locator('.convai-island__banner')).toHaveCount(0);
    await expect(page.getByText('Sharing stopped', { exact: true })).toBeVisible();
    await answerPickers(page, ['browser']);
    await openCrop(page);
    await expect(readout(page)).toHaveText('512 × 320');
    const calls = await pickerCalls(page);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.options.monitorTypeSurfaces).toBe('include');
    // One press restores it.
    await shareRegion(page);
    await expect(chip(page)).toHaveAccessibleName('Region · 512 × 320, live');
  });

  test('while shared: nothing is shared, "Sharing stopped", and Region… crops with its area ready', async ({
    page,
  }) => {
    await live(page);
    await openCrop(page);
    await shareRegion(page);
    await stopFromBrowser(page);
    await expect(chip(page)).toHaveAccessibleName('Nothing shared');
    await expect(page.getByText('Sharing stopped', { exact: true })).toBeVisible();
    expect((await fakeRecord(page)).visions.at(-1)).toBeNull();
    expect((await published(page))?.live).toBe(false);
    await answerPickers(page, ['browser']);
    await openCrop(page);
    await expect(readout(page)).toHaveText('640 × 400');
  });
});

test.describe('notices during a crop (15 §A 2, 15b)', () => {
  test('a request stands, the bar goes 12 under it, and Share area gives way to it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await live(page, { options: { microphone: 'blocked' } });
    await openCrop(page);
    await page.keyboard.down('t');
    await page.waitForTimeout(250);
    await page.keyboard.up('t');
    const surface = island(page).locator('.convai-island__surface');
    await expect(surface).toContainText('The microphone is blocked');
    const stage = await page.locator('.va-stage').boundingBox();
    const notice = await surface.boundingBox();
    const bar = await page.locator('.va-crop__bar').boundingBox();
    const picture = await frame(page).boundingBox();
    if (!stage || !notice || !bar || !picture) throw new Error('No layout.');
    expect(notice.y - stage.y).toBeCloseTo(12, 0);
    expect(bar.y).toBeCloseTo(notice.y + notice.height + 12, 0);
    expect(picture.y).toBeCloseTo(bar.y + 56 + 16, 0);
    await expect(shareArea(page)).toHaveClass(/convai-button--secondary/);

    expect(await surface.evaluate((element) => getComputedStyle(element).boxShadow)).toBe('none');
  });

  test('a status waits for the crop to end', async ({ page, context }) => {
    await live(page);
    await openCrop(page);
    await context.setOffline(true);

    await expect(capsule(page)).toHaveAttribute('data-state', 'offline', { timeout: 6000 });
    await context.setOffline(false);
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
    // Unheld, "Back online" would show at once and stay 2 s: watch 3 s.
    for (let i = 0; i < 30; i++) {
      const words = await island(page).textContent();
      expect(words).not.toContain('Back online');
      expect(words).not.toContain('offline');
      await page.waitForTimeout(100);
    }
    await cancel(page).click();
    await expect(island(page)).toContainText('Back online');
    // The offline toast that waited went with the network's return: it never shows late.
    await expect(island(page)).not.toContainText('You’re offline');
  });
});

test.describe('a narrow window (D6x-b)', () => {
  test('says the short line at 560, gives it up at 1.30 where it does not fit, and never cuts a button', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 560, height: 800 });
    await live(page);
    await openCrop(page);
    const line = crop(page).locator('.va-crop__line');
    await expect(line).toHaveText('Drag to change the area');
    const bar = await page.locator('.va-crop__bar').boundingBox();
    const stage = await page.locator('.va-stage').boundingBox();
    if (!bar || !stage) throw new Error('No layout.');
    expect(bar.x).toBeGreaterThanOrEqual(stage.x + 28 - 0.5);
    expect(bar.x + bar.width).toBeLessThanOrEqual(stage.x + stage.width - 28 + 0.5);

    await textSizeInSettings(page, 1.3);
    await expect(line).toHaveCount(0);
    await expect(shareArea(page)).toBeVisible();
    const wider = await page.locator('.va-crop__bar').boundingBox();
    expect((wider?.x ?? 0) + (wider?.width ?? 0)).toBeLessThanOrEqual(
      stage.x + stage.width - 28 + 0.5,
    );
    for (const button of [cancel(page), shareArea(page)]) {
      expect(await button.evaluate((b) => b.scrollWidth <= b.clientWidth)).toBe(true);
    }
  });
});
