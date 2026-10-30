import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { answer, fakeRecord, openApp } from './fakeConvai';
import { fakePicker } from './fakeDisplay';
import { limits, skipIn } from './engines';

const capsule = (page: Page) => page.locator('.convai-capsule');
const chip = (page: Page) => page.locator('.va-chip');
const menu = (page: Page) => page.getByRole('menu', { name: 'What Kira sees' });
const imageRow = (page: Page) => menu(page).getByRole('menuitemradio', { name: /^Image…/ });
const island = (page: Page) => page.locator('.va-stage__island');
const veil = (page: Page) => page.locator('.va-drop');
const previewLine = (page: Page) => page.locator('.va-preview__line');

/** A file as the tests hand it over: its bytes in base64, so it crosses into the page. */
interface TestFile {
  name: string;
  mimeType: string;
  base64: string;
}

interface Drawn {
  width: number;
  height: number;
  /** Fill with this color, or leave transparent with null. */
  color: string | null;
  /** A second color for the right half, to tell which way the picture stands. */
  right?: string;
  type?: 'image/png' | 'image/jpeg';
}

/** Draws a picture in the page and gives back its file's bytes. */
async function drawn(page: Page, name: string, spec: Drawn): Promise<TestFile> {
  const type = spec.type ?? 'image/png';
  const base64 = await page.evaluate(
    async ({ width, height, color, right, type }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('No 2D context.');
      if (color) {
        context.fillStyle = color;
        context.fillRect(0, 0, width, height);
      }
      if (right) {
        context.fillStyle = right;
        context.fillRect(width / 2, 0, width / 2, height);
      }
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, type, 0.95);
      });
      if (!blob) throw new Error('No blob.');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let text = '';
      for (const byte of bytes) text += String.fromCharCode(byte);
      return btoa(text);
    },
    { ...spec, type },
  );
  return { name, mimeType: type, base64 };
}

/** A JPEG with an EXIF segment saying "turn 90° clockwise to stand upright" (orientation 6). */
function withOrientation6(jpeg: TestFile): TestFile {
  const bytes = Buffer.from(jpeg.base64, 'base64');
  const tiff = Buffer.from([
    0x4d,
    0x4d,
    0x00,
    0x2a,
    0x00,
    0x00,
    0x00,
    0x08, // big-endian TIFF, first IFD at 8
    0x00,
    0x01, // one entry
    0x01,
    0x12,
    0x00,
    0x03,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    0x06,
    0x00,
    0x00, // Orientation = 6
    0x00,
    0x00,
    0x00,
    0x00, // no next IFD
  ]);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), length, payload]);
  const out = Buffer.concat([bytes.subarray(0, 2), app1, bytes.subarray(2)]);
  return { ...jpeg, base64: out.toString('base64') };
}

const bytesOf = (file: TestFile) => ({
  name: file.name,
  mimeType: file.mimeType,
  buffer: Buffer.from(file.base64, 'base64'),
});

async function live(page: Page) {
  await openApp(page);
  await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
}

/** Image… in the menu, then the file in the chooser it opened. */
async function chooseFile(page: Page, file: TestFile) {
  await chip(page).click();
  const chooser = page.waitForEvent('filechooser');
  await imageRow(page).click();
  await (await chooser).setFiles(bytesOf(file));
}

/** A paste on `selector` (the focused element by default) carrying these files and text. */
async function paste(
  page: Page,
  files: TestFile[],
  text = '',
  selector: string | null = null,
): Promise<{ prevented: boolean }> {
  if (files.length > 0) skipIn(page, ['firefox'], limits.paste);
  return page.evaluate(
    ({ files, text, selector }) => {
      const data = new DataTransfer();
      for (const f of files) {
        const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
        data.items.add(new File([bytes], f.name, { type: f.mimeType }));
      }
      if (text) data.setData('text/plain', text);
      const target =
        (selector ? document.querySelector(selector) : document.activeElement) ?? document.body;
      const event = new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(event);
      return { prevented: event.defaultPrevented };
    },
    { files, text, selector },
  );
}

/**
 * Drags these files over the element at `selector` and, with `release`, lets go there. Held, the drag
 * goes on telling the page every 50 ms, as Chromium does while the pointer stays still, until the next
 * drag or `stopTelling`: the app lets the target go once a drag stops being told (`dragHeldMs`).
 */
async function drag(
  page: Page,
  selector: string,
  files: TestFile[],
  release: boolean,
): Promise<{ effect: string; prevented: boolean }> {
  await stopTelling(page);
  return page.evaluate(
    ({ selector, files, release }) => {
      const target = document.querySelector(selector);
      if (!target) throw new Error(`Nothing at ${selector}.`);
      const data = new DataTransfer();
      for (const f of files) {
        const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
        data.items.add(new File([bytes], f.name, { type: f.mimeType }));
      }
      // A DataTransfer made by a script keeps no drop effect: the one the app sets is caught here.
      let effect = 'unset';
      Object.defineProperty(data, 'dropEffect', {
        get: () => effect,
        set: (value: string) => {
          effect = value;
        },
      });
      const fire = (type: string) => {
        const event = new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true });
        // Asked again each time: a node the app has drawn anew since would tell nobody.
        (document.querySelector(selector) ?? target).dispatchEvent(event);
        return event;
      };
      fire('dragenter');
      const over = fire('dragover');
      let prevented = over.defaultPrevented;
      if (release) prevented = fire('drop').defaultPrevented;
      else
        (window as DragHeld).dragTelling = window.setInterval(() => {
          fire('dragover');
        }, 50);
      return { effect, prevented };
    },
    { selector, files, release },
  );
}

type DragHeld = Window & { dragTelling?: number };

/** A held drag stops telling the page, as one taken to another window does. */
async function stopTelling(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.clearInterval((window as DragHeld).dragTelling);
  });
}

/** The picture last handed to the fake Convai: its size, live or not, and colors at three heights. */
async function published(page: Page) {
  return page.evaluate(() => {
    const track = window.fakeConvai?.tracks.at(-1);
    const canvas = track && window.fakeConvai?.canvasOf(track);
    if (!canvas) return null;
    const context = canvas.getContext('2d');
    const at = (y: number) => {
      const pixel = context?.getImageData(Math.floor(canvas.width / 2), y, 1, 1).data;
      return pixel ? [pixel[0], pixel[1], pixel[2]] : null;
    };
    return {
      width: canvas.width,
      height: canvas.height,
      top: at(2),
      middle: at(Math.floor(canvas.height / 2)),
      bottom: at(canvas.height - 3),
      live: track.readyState === 'live',
    };
  });
}

const near = (got: readonly (number | undefined)[] | null | undefined, want: readonly number[]) =>
  got?.every((v, i) => Math.abs((v ?? -99) - (want[i] ?? 0)) < 24) === true;

const red = [255, 0, 0];
const blue = [0, 0, 255];
const white = [255, 255, 255];

async function expectImageShared(page: Page, name: string) {
  await expect(chip(page)).toHaveAccessibleName(`Image · ${name}`);
  await expect.poll(async () => (await fakeRecord(page)).visions.at(-1)?.kind).toBe('screen_share');
}

test.describe('Image…', () => {
  test('sits after the screen rows with "or drop a file", and shares the chosen file', async ({
    page,
  }) => {
    skipIn(page, ['webkit'], limits.noPlayback);
    await live(page);
    await chip(page).click();
    const rows = menu(page).getByRole('menuitemradio');
    await expect(rows.last()).toHaveText('Nothing · voice only');
    await expect(rows.nth(-2)).toHaveText('Image…or drop a file');
    await expect(imageRow(page)).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Escape');

    await chooseFile(
      page,
      await drawn(page, 'mug.jpg', { width: 64, height: 48, color: 'red', type: 'image/jpeg' }),
    );
    await expectImageShared(page, 'mug.jpg');
    const record = await fakeRecord(page);
    expect(record.visions).toHaveLength(1);
    expect(record.visions[0]).toMatchObject({ kind: 'screen_share', canvas: true });
    // The picture's own pixels, not the file: what the character gets is drawn anew.
    const picture = await published(page);
    expect(picture).toMatchObject({ width: 64, height: 48, live: true });
    expect(near(picture?.middle, red)).toBe(true);

    // Shown as an inset preview with the image's line, no dot in the chip, and no toast.
    await expect(previewLine(page)).toHaveText('Image · mug.jpg');
    await expect(page.locator('.va-preview__frame')).toBeVisible();
    await expect(chip(page).locator('.va-chip__slot')).toHaveCount(0);
    await page.waitForTimeout(300);
    await expect(island(page).locator('.convai-island__surface')).toHaveAttribute(
      'data-form',
      'none',
    );

    // The row is checked while the image is shared.
    await chip(page).click();
    await expect(imageRow(page)).toHaveAttribute('aria-checked', 'true');
  });

  test('flattens transparency onto white, in the preview and in what is sent', async ({ page }) => {
    await live(page);
    await chooseFile(page, await drawn(page, 'clear.png', { width: 80, height: 60, color: null }));
    await expectImageShared(page, 'clear.png');
    expect(near((await published(page))?.middle, white)).toBe(true);
  });

  test('stands an EXIF-turned photo upright, and sends only its pixels', async ({ page }) => {
    await live(page);
    // 40 × 20: red on the left, blue on the right; orientation 6 turns it to 20 × 40, red on top.
    const jpeg = await drawn(page, 'turned.jpg', {
      width: 40,
      height: 20,
      color: 'red',
      right: 'blue',
      type: 'image/jpeg',
    });
    await chooseFile(page, withOrientation6(jpeg));
    await expectImageShared(page, 'turned.jpg');
    const picture = await published(page);
    expect(picture).toMatchObject({ width: 20, height: 40 });
    expect(near(picture?.top, red)).toBe(true);
    expect(near(picture?.bottom, blue)).toBe(true);
  });

  test('sends a large image at a short edge of 1080, even on both sides', async ({ page }) => {
    await live(page);
    await chooseFile(
      page,
      await drawn(page, 'wide.png', { width: 2401, height: 1601, color: 'blue' }),
    );
    await expectImageShared(page, 'wide.png');
    const picture = await published(page);
    expect(picture?.height).toBe(1080);
    expect(picture?.width).toBe(1620);
  });

  test('keeps giving frames while the image stands, as the character reads frames', async ({
    page,
  }) => {
    skipIn(page, ['webkit'], limits.noPlayback);
    await live(page);
    await chooseFile(page, await drawn(page, 'mug.png', { width: 32, height: 32, color: 'red' }));
    await expectImageShared(page, 'mug.png');
    // A canvas that is never painted again gives one frame: count what a player of the track gets.
    const frames = await page.evaluate(async () => {
      const track = window.fakeConvai?.tracks.at(-1);
      if (!track) return -1;
      const video = document.createElement('video');
      video.muted = true;
      video.srcObject = new MediaStream([track]);
      await video.play();
      let count = 0;
      const tick = () => {
        count++;
        video.requestVideoFrameCallback(tick);
      };
      video.requestVideoFrameCallback(tick);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return count;
    });
    expect(frames).toBeGreaterThanOrEqual(8);
  });

  test('marks a question asked while it is shared as asked with the image', async ({ page }) => {
    await live(page);
    await chooseFile(page, await drawn(page, 'mug.png', { width: 32, height: 32, color: 'red' }));
    await expectImageShared(page, 'mug.png');
    await page.keyboard.press('/');
    await page.keyboard.type('What is this?');
    await page.keyboard.press('Enter');
    await expect(page.locator('.va-moment__meta').first()).toHaveText(/^Image · /);
  });

  test('passes the accessibility checks with the menu open and an image shared', async ({
    page,
  }) => {
    await live(page);
    await chooseFile(page, await drawn(page, 'mug.png', { width: 32, height: 32, color: 'red' }));
    await expectImageShared(page, 'mug.png');
    await chip(page).click();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe('refusals (K5b)', () => {
  test('refuses another kind by its name, in words, and keeps the image shared', async ({
    page,
  }) => {
    await live(page);
    await chooseFile(page, await drawn(page, 'first.png', { width: 32, height: 32, color: 'red' }));
    await expectImageShared(page, 'first.png');

    const gif = { name: 'cat.gif', mimeType: 'image/gif', base64: btoa('GIF89a') };
    await drag(page, '.va-stage', [gif], true);
    await expect(island(page)).toContainText('PNG and JPG only');
    await expect(chip(page)).toHaveAccessibleName('Image · first.png');
    expect((await fakeRecord(page)).visions).toHaveLength(1);
  });

  test('refuses an image over 20 MB without reading it', async ({ page }) => {
    await live(page);
    const big = {
      name: 'huge.png',
      mimeType: 'image/png',
      base64: Buffer.alloc(20 * 1024 * 1024 + 1).toString('base64'),
    };
    await chooseFile(page, big);
    await expect(island(page)).toContainText('That image is over 20 MB');
    await expect(chip(page)).toHaveAccessibleName('Nothing shared');
    expect((await fakeRecord(page)).visions).toEqual([]);
  });

  test('refuses a .png whose bytes are no image, and a JPEG cut short', async ({ page }) => {
    await live(page);
    await chooseFile(page, await drawn(page, 'first.png', { width: 32, height: 32, color: 'red' }));
    await expectImageShared(page, 'first.png');

    const text = { name: 'notes.png', mimeType: 'image/png', base64: btoa('just some words') };
    await chooseFile(page, text);
    await expect(island(page)).toContainText('PNG and JPG only');

    const jpeg = await drawn(page, 'cut.jpg', {
      width: 64,
      height: 64,
      color: 'blue',
      type: 'image/jpeg',
    });
    const cut = {
      ...jpeg,
      base64: Buffer.from(jpeg.base64, 'base64').subarray(0, 40).toString('base64'),
    };
    await chooseFile(page, cut);
    await expect(island(page)).toContainText('That file couldn’t be opened');

    await expect(chip(page)).toHaveAccessibleName('Image · first.png');
    expect((await fakeRecord(page)).visions).toHaveLength(1);
    expect(near((await published(page))?.middle, red)).toBe(true);
  });
});

test.describe('paste (answers 2026-10-14 Q2, 2026-10-14b Q15)', () => {
  test('makes a pasted picture the source, named "Pasted image"', async ({ page }) => {
    await live(page);
    const picture = await drawn(page, 'image.png', { width: 160, height: 60, color: 'blue' });
    const { prevented } = await paste(page, [picture]);
    expect(prevented).toBe(true);
    await expectImageShared(page, 'Pasted image');
    await expect(previewLine(page)).toHaveText('Image · Pasted image');
    expect(near((await published(page))?.middle, blue)).toBe(true);
  });

  test('keeps a copied file’s own name', async ({ page }) => {
    await live(page);
    await paste(page, [await drawn(page, 'receipt.png', { width: 32, height: 32, color: 'red' })]);
    await expectImageShared(page, 'receipt.png');
  });

  test('takes an image pasted in the Type field, but leaves the field the text of a paste with both', async ({
    page,
  }) => {
    await live(page);
    await page.keyboard.press('/');
    const field = page.getByRole('textbox');
    await expect(field).toBeFocused();
    const picture = await drawn(page, 'image.png', { width: 32, height: 32, color: 'red' });

    const both = await paste(page, [picture], 'a caption');
    expect(both.prevented).toBe(false);
    expect((await fakeRecord(page)).visions).toEqual([]);

    const alone = await paste(page, [picture]);
    expect(alone.prevented).toBe(true);
    await expectImageShared(page, 'Pasted image');
    // The field stays open and focused: the paste only changed the source.
    await expect(field).toBeFocused();
  });

  test('leaves a paste of text alone', async ({ page }) => {
    await live(page);
    const { prevented } = await paste(page, [], 'just words');
    expect(prevented).toBe(false);
    expect((await fakeRecord(page)).visions).toEqual([]);
  });

  test('refuses a pasted picture of another kind in words', async ({ page }) => {
    await live(page);
    const webp = { name: 'image.webp', mimeType: 'image/webp', base64: btoa('RIFF') };
    await paste(page, [webp]);
    await expect(island(page)).toContainText('PNG and JPG only');
    await expect(chip(page)).toHaveAccessibleName('Nothing shared');
  });
});

test.describe('drop (K5; answers 2026-10-14 Q16, 2026-10-14b Q12)', () => {
  test('shows the target over the stage while a file is held, and shares the file let go', async ({
    page,
  }) => {
    await live(page);
    const picture = await drawn(page, 'mug.png', { width: 40, height: 30, color: 'red' });
    const held = await drag(page, '.va-stage', [picture], false);
    expect(held).toEqual({ effect: 'copy', prevented: true });
    await expect(veil(page)).toBeVisible();
    await expect(veil(page)).toContainText('Drop to show Kira');
    await expect(veil(page)).toContainText('PNG or JPG · up to 20 MB · becomes what Kira sees');
    // The invitation does not show through the veil.
    await expect(page.getByText('Show Kira something')).toHaveCount(0);

    await drag(page, '.va-stage', [picture], true);
    await expect(veil(page)).toHaveCount(0);
    await expectImageShared(page, 'mug.png');

    // With something shared, a drop replaces it.
    await drag(page, '.va-stage', [picture], false);
    await expect(veil(page)).toContainText('PNG or JPG · up to 20 MB · replaces what Kira sees');
  });

  test('lets the target go a moment after the drag stops being told', async ({ page }) => {
    await live(page);
    const picture = await drawn(page, 'mug.png', { width: 40, height: 30, color: 'red' });
    await drag(page, '.va-stage', [picture], false);
    await expect(veil(page)).toBeVisible();
    // Held past the moment the target waits for, the drag keeps it while it is told, without a
    // flicker: every time it went is counted.
    await page.evaluate(() => {
      const held = window as Window & { veilGone?: number };
      held.veilGone = 0;
      new MutationObserver(() => {
        if (!document.querySelector('.va-drop')) held.veilGone = (held.veilGone ?? 0) + 1;
      }).observe(document.body, { subtree: true, childList: true });
    });
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => (window as Window & { veilGone?: number }).veilGone)).toBe(0);
    await expect(veil(page)).toBeVisible();
    await stopTelling(page);
    await expect(veil(page)).toHaveCount(0, { timeout: 2000 });
  });

  test('takes a file dropped on the transcript column, which is the window’s body', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await live(page);
    await expect(page.locator('.va-transcript')).toBeVisible();
    await drag(
      page,
      '.va-transcript',
      [await drawn(page, 'mug.png', { width: 32, height: 32, color: 'red' })],
      true,
    );
    await expectImageShared(page, 'mug.png');
  });

  test('refuses a drop on the title bar, and keeps the browser from opening the file', async ({
    page,
  }) => {
    await live(page);
    const url = page.url();
    const picture = await drawn(page, 'mug.png', { width: 32, height: 32, color: 'red' });
    const result = await drag(page, '.va-bar', [picture], true);
    expect(result).toEqual({ effect: 'none', prevented: true });
    await expect(veil(page)).toHaveCount(0);
    await page.waitForTimeout(300);
    expect((await fakeRecord(page)).visions).toEqual([]);
    expect(page.url()).toBe(url);
  });

  test('shares the first image of several files dropped together', async ({ page }) => {
    await live(page);
    const pdf = { name: 'notes.pdf', mimeType: 'application/pdf', base64: btoa('%PDF') };
    const picture = await drawn(page, 'second.png', { width: 32, height: 32, color: 'red' });
    await drag(page, '.va-stage', [pdf, picture], true);
    await expectImageShared(page, 'second.png');
  });

  test('leaves a drag of text alone, so the Type field can take it', async ({ page }) => {
    await live(page);
    const prevented = await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData('text/plain', 'words');
      const event = new DragEvent('dragover', {
        dataTransfer: data,
        bubbles: true,
        cancelable: true,
      });
      document.querySelector('.va-stage')?.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(prevented).toBe(false);
    await expect(veil(page)).toHaveCount(0);
  });
});

test.describe('beside the rest of the window', () => {
  test('tells a screen reader what Kira now sees, as no toast does', async ({ page }) => {
    await live(page);
    await chooseFile(page, await drawn(page, 'mug.png', { width: 64, height: 48, color: 'red' }));
    await expectImageShared(page, 'mug.png');
    await expect(page.getByRole('status').filter({ hasText: 'Kira now sees mug.png' })).toHaveCount(
      1,
    );
  });

  test('keeps the drop target clear of a floating transcript', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 720 });
    await live(page);
    await page.keyboard.press('r');
    const panel = page.getByRole('region', { name: 'Transcript' });
    await expect(panel).toHaveClass(/va-transcript--float/);
    await drag(
      page,
      '.va-stage',
      [await drawn(page, 'mug.png', { width: 32, height: 32, color: 'red' })],
      false,
    );
    await expect(veil(page)).toBeVisible();
    const target = await veil(page).boundingBox();
    const beside = await panel.boundingBox();
    expect((target?.x ?? 0) + (target?.width ?? 0)).toBeLessThanOrEqual(beside?.x ?? 0);
  });

  test('takes no file while an area is chosen: the crop is its own step', async ({ page }) => {
    await fakePicker(page, ['browser'], { width: 1280, height: 800 });
    await page.addInitScript(() => {
      window.localStorage.setItem('va.share-card-shown', '2');
    });
    await live(page);
    await chip(page).click();
    await menu(page).getByRole('menuitemradio', { name: 'Region…' }).click();
    const crop = page.getByRole('group', { name: 'Choose an area' });
    await expect(crop).toBeVisible();
    const picture = await drawn(page, 'mug.png', { width: 32, height: 32, color: 'red' });
    const held = await drag(page, '.va-stage', [picture], true);
    expect(held).toEqual({ effect: 'none', prevented: true });
    expect((await paste(page, [picture], '', '.va-stage')).prevented).toBe(false);
    await expect(veil(page)).toHaveCount(0);
    await page.waitForTimeout(300);
    await expect(crop).toBeVisible();
    expect((await fakeRecord(page)).visions).toEqual([]);
  });
});

test.describe('while the character answers (D3)', () => {
  test('shares a file dropped during a reply once the reply ends', async ({ page }) => {
    await live(page);
    await page.keyboard.press('/');
    await page.keyboard.type('Hello');
    await page.keyboard.press('Enter');
    const reply = answer(page, 'Hello there, how can I help today?');
    await expect(capsule(page)).toHaveAttribute('data-state', /thinking|speaking/);
    await drag(
      page,
      '.va-stage',
      [await drawn(page, 'mug.png', { width: 32, height: 32, color: 'red' })],
      true,
    );
    await page.waitForTimeout(100);
    expect((await fakeRecord(page)).visions).toEqual([]);
    await reply;
    await expectImageShared(page, 'mug.png');
  });
});
