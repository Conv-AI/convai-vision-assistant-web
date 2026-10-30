import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { fakeRecord, openApp } from './fakeConvai';
import { fakePicker } from './fakeDisplay';
import { launchOptions } from './launch';
import { limits } from './engines';

test.use({ launchOptions: launchOptions({ tabTitle: 'Vision Assistant e2e pause fixture' }) });

const capsule = (page: Page) => page.locator('.convai-capsule');
const chip = (page: Page) => page.locator('.va-chip');
const slot = (page: Page) => chip(page).locator('.va-chip__slot');
const menu = (page: Page) => page.getByRole('menu', { name: 'What Kira sees' });
const tool = (page: Page) => capsule(page).locator('.convai-capsule__app-tool');
const pill = (page: Page) => page.locator('.va-paused__pill');
const resume = (page: Page) => page.getByRole('button', { name: 'Resume vision' });
const island = (page: Page) => page.locator('.va-stage__island');
const cameraRow = (page: Page) =>
  menu(page).getByRole('group', { name: 'Camera' }).getByRole('menuitemradio').first();

async function live(page: Page) {
  await fakePicker(page, ['browser', 'window']);

  await page.addInitScript(() => {
    window.localStorage.setItem('va.share-card-shown', '2');
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
}

async function shareCamera(page: Page) {
  await chip(page).click();
  await cameraRow(page).click();
  await expect(slot(page)).toHaveAttribute('data-mark', 'live');
}

async function shareTab(page: Page) {
  await chip(page).click();
  await menu(page).getByRole('menuitemradio', { name: 'Browser tab…' }).click();
  await expect(slot(page)).toHaveAttribute('data-mark', 'live');
  await expect(page.locator('.va-preview__frame')).toBeVisible();
}

/** Image…, with a flat picture drawn in the page as the chosen file. */
async function shareImage(page: Page, name: string) {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 900;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No 2D context.');
    context.fillStyle = 'rgb(0, 160, 80)';
    context.fillRect(0, 0, 1600, 900);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/png');
    });
    if (!blob) throw new Error('No blob.');
    let text = '';
    for (const byte of new Uint8Array(await blob.arrayBuffer())) text += String.fromCharCode(byte);
    return btoa(text);
  });
  await chip(page).click();
  const chooser = page.waitForEvent('filechooser');
  await menu(page)
    .getByRole('menuitemradio', { name: /^Image…/ })
    .click();
  await (
    await chooser
  ).setFiles({ name, mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') });
  await expect(chip(page)).toHaveAccessibleName(`Image · ${name}`);
}

const lastVision = async (page: Page) => (await fakeRecord(page)).visions.at(-1);

const trackStates = (page: Page) =>
  page.evaluate(() => (window.fakeConvai?.tracks ?? []).map((t) => t.readyState));

test.describe('the capsule’s tool', () => {
  test('stands between Type and the rest, dimmed with its reason while nothing is shared; Alt V does nothing', async ({
    page,
  }) => {
    await live(page);
    const names = await capsule(page)
      .locator('.convai-capsule__tools button')
      .evaluateAll((buttons) => buttons.map((b) => b.getAttribute('aria-label')));
    expect(names).toEqual(['Type', 'Pause vision', 'Quick controls']);
    await expect(tool(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(tool(page)).toHaveAccessibleDescription('Share something to pause vision');
    await page.keyboard.press('Alt+KeyV');
    // Dimmed, it takes no press.
    await tool(page).click({ force: true });
    await expect(pill(page)).toHaveCount(0);
    expect((await fakeRecord(page)).visions).toEqual([]);
  });
});

test.describe('a paused camera (H12)', () => {
  test('stops sending at once, keeps the camera and its kind and name, and the tool shows pressed', async ({
    page,
  }) => {
    await live(page);
    await shareCamera(page);
    const sent = await lastVision(page);
    await expect(tool(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(tool(page)).toHaveAttribute('aria-keyshortcuts', 'Alt+V');

    await tool(page).click();

    await expect(tool(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(tool(page)).toHaveAccessibleName('Pause vision');
    await page.mouse.move(4, 4);
    await tool(page).hover();
    await expect(page.locator('.convai-tooltip', { hasText: 'Resume vision' })).toBeVisible();
    // A screen reader hears it, the focus having stayed where it was.
    await expect(
      page.getByRole('status').filter({ hasText: 'Vision paused. Kira can’t see this.' }),
    ).toHaveCount(1);
    expect(await lastVision(page)).toBeNull();
    // Nothing is captured anew for Resume: the camera's light stays on.
    expect(await trackStates(page)).toEqual(['live']);

    await expect(slot(page)).toHaveAttribute('data-mark', 'paused');
    await expect(chip(page)).toHaveAccessibleName(/^Camera · .+ · paused$/);
    // The veil covers the stage; the viewfinder, which means a live camera, goes.
    // Both read in one frame: read apart, the layout could move between them on a loaded machine.
    const [stage, veil] = await page.evaluate(() =>
      ['.va-stage', '.va-paused--stage'].map((selector) => {
        const r = document.querySelector(selector)?.getBoundingClientRect();
        return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
      }),
    );
    expect(veil).toEqual(stage);
    await expect(page.locator('.va-camera__corner')).toHaveCount(0);
    // The picture holds its last frame.
    expect(
      await page.locator('.va-camera__video').evaluate((v: HTMLVideoElement) => v.paused),
    ).toBe(true);

    const box = await pill(page).boundingBox();
    if (!stage || !box) throw new Error('No layout.');
    expect(box.height).toBeCloseTo(44, 0);
    expect(box.x + box.width / 2).toBeCloseTo(stage.x + stage.width / 2, 0);
    expect(box.y + box.height / 2).toBeCloseTo(stage.y + stage.height / 2, 0);
    await expect(pill(page)).toContainText('Vision paused');
    await expect(resume(page)).toContainText('Alt V');
    await expect(resume(page)).toHaveAttribute('aria-keyshortcuts', 'Alt+V');

    // Resume on the pill: the same track goes out again, and the focus waits on the tool.
    await resume(page).click();
    await expect(pill(page)).toHaveCount(0);
    expect(await lastVision(page)).toEqual(sent);
    await expect(tool(page)).toBeFocused();
    await expect(tool(page)).toHaveAccessibleName('Pause vision');
    await expect(
      page.getByRole('status').filter({ hasText: 'Vision on. Kira can see this again.' }),
    ).toHaveCount(1);
    await expect(slot(page)).toHaveAttribute('data-mark', 'live');
    await expect(page.locator('.va-camera__corner')).toHaveCount(4);
    await expect
      .poll(() => page.locator('.va-camera__video').evaluate((v: HTMLVideoElement) => v.paused))
      .toBe(false);
  });

  test('shows the camera’s row by its still glyph while paused, not by its picture', async ({
    page,
  }) => {
    await live(page);
    await shareCamera(page);
    await chip(page).click();
    await expect(cameraRow(page).locator('video')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Alt+KeyV');
    await chip(page).click();
    await expect(cameraRow(page)).toHaveAttribute('aria-checked', 'true');
    await expect(cameraRow(page).locator('video')).toHaveCount(0);
  });

  test('names no source on a question asked while paused: the character saw nothing', async ({
    page,
  }) => {
    await live(page);
    await shareCamera(page);
    await page.keyboard.press('Alt+KeyV');
    await page.keyboard.press('/');
    await page.keyboard.type('What is this?');
    await page.keyboard.press('Enter');
    await expect(page.locator('.va-moment__meta').first()).not.toHaveText(/Camera/);
  });
});

test.describe('a paused tab (H12b)', () => {
  test.skip(({ browserName }) => browserName === 'webkit', limits.noPlayback);
  test('veils the frame alone, says so on the line, and Alt V resumes the same track in silence', async ({
    page,
  }) => {
    await live(page);
    await shareTab(page);
    await expect(island(page)).toContainText('Now sharing');
    const sent = await lastVision(page);
    expect(sent?.kind).toBe('screen_share');

    await page.keyboard.press('Alt+KeyV');
    expect(await lastVision(page)).toBeNull();

    await expect(island(page)).not.toContainText('Now sharing', { timeout: 600 });
    const frame = await page.locator('.va-preview__frame').boundingBox();
    const veil = page.locator('.va-paused--frame');
    expect(await veil.boundingBox()).toEqual(frame);
    await expect(veil).toHaveCSS('border-radius', '10px');
    await expect(page.locator('.va-preview__line')).toHaveText('Paused · Kira can’t see this');
    await expect(chip(page)).toHaveAccessibleName('Browser tab · paused');
    const box = await pill(page).boundingBox();
    if (!frame || !box) throw new Error('No layout.');
    expect(box.x + box.width / 2).toBeCloseTo(frame.x + frame.width / 2, 0);
    expect(box.y + box.height / 2).toBeCloseTo(frame.y + frame.height / 2, 0);
    // Resume takes the press: nothing over it does.
    const centre = await resume(page).evaluate((button) => {
      const r = button.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return hit !== null && button.contains(hit);
    });
    expect(centre).toBe(true);
    // The browser's share keeps running, so Resume needs no new picker.
    expect(await trackStates(page)).toEqual(['live']);

    await page.keyboard.press('Alt+KeyV');
    await expect(pill(page)).toHaveCount(0);
    expect(await lastVision(page)).toEqual(sent);
    await expect(page.locator('.va-preview__line')).toHaveText(
      'Live preview · Kira sees this while you share',
    );
    // A pause ending is no news.
    await page.waitForTimeout(300);
    await expect(island(page)).not.toContainText('Now sharing');
  });

  test('pauses with Alt V while the person types, and the field gets no letter', async ({
    page,
  }) => {
    await live(page);
    await shareTab(page);
    await page.keyboard.press('/');
    const field = page.getByRole('textbox');
    await page.keyboard.type('Hello');
    // The press is the window's: kept from the field, so a Mac's ⌥ V types no √ there.
    await page.evaluate(() => {
      window.addEventListener('keydown', (event) => {
        if (event.code === 'KeyV')
          document.body.dataset.pauseKeyKept = String(event.defaultPrevented);
      });
    });
    await page.keyboard.press('Alt+KeyV');
    await expect(pill(page)).toBeVisible();
    await expect(field).toHaveValue('Hello');
    await expect(page.locator('body')).toHaveAttribute('data-pause-key-kept', 'true');
    expect(await lastVision(page)).toBeNull();
  });

  test('ends the pause when another source is chosen: the new one goes out, not paused', async ({
    page,
  }) => {
    await live(page);
    await shareTab(page);
    await page.keyboard.press('Alt+KeyV');
    await chip(page).click();
    await menu(page).getByRole('menuitemradio', { name: 'Window…' }).click();
    await expect(chip(page)).toHaveAccessibleName('Window, live');
    await expect(pill(page)).toHaveCount(0);
    expect((await lastVision(page))?.kind).toBe('screen_share');
    expect(await trackStates(page)).toEqual(['ended', 'live']);
  });

  test('passes axe while paused', async ({ page }) => {
    await live(page);
    await shareTab(page);
    await page.keyboard.press('Alt+KeyV');
    await expect(pill(page)).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe('a paused image (H12b)', () => {
  test.skip(({ browserName }) => browserName === 'webkit', limits.noPlayback);
  test('keeps its name on the line and in the chip, which has no dot slot', async ({ page }) => {
    await live(page);
    await shareImage(page, 'mug.png');
    await page.keyboard.press('Alt+KeyV');
    await expect(page.locator('.va-preview__line')).toHaveText('Paused · Image · mug.png');
    await expect(chip(page)).toHaveAccessibleName('Image · mug.png · paused');
    await expect(slot(page)).toHaveCount(0);
    await expect(page.locator('.va-preview__frame > .va-paused--frame')).toBeVisible();
    expect(await lastVision(page)).toBeNull();
  });
});

test.describe('pausing and the keyboard', () => {
  test('Alt V on the pill’s Resume resumes and gives the focus to the tool, not to the page', async ({
    page,
  }) => {
    await live(page);
    await shareCamera(page);
    await page.keyboard.press('Alt+KeyV');
    await resume(page).focus();
    await page.keyboard.press('Alt+KeyV');
    await expect(pill(page)).toHaveCount(0);
    await expect(tool(page)).toBeFocused();
  });
});

test.describe('pausing and a region', () => {
  test.skip(({ browserName }) => browserName === 'webkit', limits.noPlayback);
  const crop = (page: Page) => page.getByRole('group', { name: 'Choose an area' });

  test('says to finish the first area before pausing, and pauses while an area is changed', async ({
    page,
  }) => {
    await live(page);
    await chip(page).click();
    await menu(page).getByRole('menuitemradio', { name: 'Region…' }).click();
    await expect(crop(page)).toBeVisible();
    // Nothing is seen yet: the reason says what comes first.
    await expect(tool(page)).toHaveAccessibleDescription('Finish choosing the area first');
    await crop(page).getByRole('button', { name: 'Share area' }).click();
    await expect(slot(page)).toHaveAttribute('data-mark', 'live');
    const sent = await lastVision(page);

    await chip(page).click();
    await menu(page).getByRole('menuitem', { name: 'Change area…' }).click();
    await expect(crop(page)).toBeVisible();
    // Kira still sees the region while its area is changed: Alt V must stop that.
    await page.keyboard.press('Alt+KeyV');
    await expect(crop(page)).toHaveCount(0);
    await expect(pill(page)).toBeVisible();
    expect(await lastVision(page)).toBeNull();
    await expect(chip(page)).toHaveAccessibleName(/^Region · .+ · paused$/);
    await page.keyboard.press('Alt+KeyV');
    expect(await lastVision(page)).toEqual(sent);
  });
});
