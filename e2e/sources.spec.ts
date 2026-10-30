import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { emit, fakeRecord, openApp } from './fakeConvai';
import { limits, skipIn } from './engines';

const capsule = (page: Page) => page.locator('.convai-capsule');
const chip = (page: Page) => page.locator('.va-chip');
const menu = (page: Page) => page.getByRole('menu', { name: 'What Kira sees' });
/** The first camera row; the menu lists the cameras as the browser reports them, which can come late. */
const cameraRow = (page: Page) =>
  menu(page).getByRole('group', { name: 'Camera' }).getByRole('menuitemradio').first();

/** The width of the focus ring a control draws now (0 when it draws none). */
const ringWidth = (control: Locator) =>
  control.evaluate((element) =>
    element.matches(':focus-visible')
      ? Number.parseFloat(getComputedStyle(element).outlineWidth)
      : 0,
  );

async function live(page: Page) {
  await openApp(page);
  await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
}

async function shareCamera(page: Page) {
  await chip(page).click();
  await cameraRow(page).click();
  await expect(chip(page).locator('.va-chip__slot')).toHaveAttribute('data-mark', 'live');
}

/** Makes the browser's camera fail the way `name` says, before the app loads. */
async function refuseCamera(page: Page, name: string, permission: PermissionState = 'granted') {
  await page.addInitScript(
    ({ name, permission }) => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('refused', name));
      const query = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (descriptor) =>
        descriptor.name === ('camera' as PermissionName)
          ? Promise.resolve({ state: permission } as PermissionStatus)
          : query(descriptor);
    },
    { name, permission },
  );
}

test.describe('the source chip and menu', () => {
  test('lists the cameras and Nothing, with Nothing checked, and never opens a camera', async ({
    page,
  }) => {
    await live(page);
    await expect(chip(page)).toHaveAccessibleName(/Nothing shared/);
    await chip(page).click();

    await expect(menu(page)).toBeVisible();
    await expect(menu(page).getByRole('group', { name: 'Camera' })).toBeVisible();
    const nothing = menu(page).getByRole('menuitemradio', { name: 'Nothing · voice only' });
    await expect(nothing).toHaveAttribute('aria-checked', 'true');
    await expect(nothing).toBeFocused();
    // Rows a build cannot do are absent, never drawn dead: a camera, the web's four, Image…, Nothing.
    await expect(menu(page).getByRole('menuitemradio')).toHaveCount(7);
    expect((await fakeRecord(page)).visions).toEqual([]);
  });

  test('moves with the arrows, picks with Return, and gives the focus back to the chip', async ({
    page,
  }) => {
    await live(page);
    await chip(page).click();
    await expect(cameraRow(page)).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(cameraRow(page)).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(menu(page)).toBeHidden();
    await expect(chip(page)).toBeFocused();
    await expect(chip(page).locator('.va-chip__slot')).toHaveAttribute('data-mark', 'live');
  });

  // Chromium rings the focused control at any key; the window's own letters move no focus, so a
  // pick made with the pointer keeps the chip without its ring (found by family U).
  for (const [name, keys] of [
    // Held: its repeats are no other key.
    [
      'T held',
      async (page: Page) => {
        await page.keyboard.down('t');
        await page.keyboard.down('t');
        await page.keyboard.up('t');
      },
    ],
    ['M', (page: Page) => page.keyboard.press('m')],
    // Shift alone waits for its key: Shift T turns Hands free on.
    ['Shift T', (page: Page) => page.keyboard.press('Shift+T')],
  ] as const) {
    test(`draws no ring on the chip when a pointer pick is followed by ${name}`, async ({
      page,
    }) => {
      await live(page);
      await chip(page).click();
      await cameraRow(page).click();
      await expect(menu(page)).toBeHidden();
      await expect(chip(page)).toBeFocused();
      await page.mouse.move(0, 0);

      await keys(page);
      await expect(chip(page)).toBeFocused();
      expect(await ringWidth(chip(page))).toBe(0);
    });
  }

  test('rings the chip after a key pick followed by T', async ({ page }) => {
    await live(page);
    await chip(page).click();
    await expect(cameraRow(page)).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(chip(page)).toBeFocused();

    await page.keyboard.down('t');
    await page.keyboard.up('t');
    expect(await ringWidth(chip(page))).toBeGreaterThan(0);
  });

  test('rings again once a key moves the focus after a pointer pick and T', async ({ page }) => {
    await live(page);
    await chip(page).click();
    await cameraRow(page).click();
    await expect(chip(page)).toBeFocused();
    await page.keyboard.down('t');
    await page.keyboard.up('t');
    expect(await ringWidth(chip(page))).toBe(0);

    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(chip(page)).toBeFocused();
    expect(await ringWidth(chip(page))).toBeGreaterThan(0);
  });

  test('rings after a key pick even when the chip had kept no ring before', async ({ page }) => {
    await live(page);
    await chip(page).click();
    await cameraRow(page).click();
    await page.keyboard.down('t');
    await page.keyboard.up('t');
    expect(await ringWidth(chip(page))).toBe(0);

    // The chip gives its focus to the menu without a key; the pick by keys brings it back ringed.
    await chip(page).click();
    await expect(cameraRow(page)).toBeFocused();
    // Up from the first row is Nothing, the last.
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await expect(chip(page)).toBeFocused();
    expect(await ringWidth(chip(page))).toBeGreaterThan(0);
  });

  test('closes on Esc before Esc stops a reply', async ({ page }) => {
    await live(page);
    await emit(page, { type: 'activity', activity: 'speaking' });
    await chip(page).click();
    await page.keyboard.press('Escape');

    await expect(menu(page)).toBeHidden();
    await expect(chip(page)).toBeFocused();
    expect((await fakeRecord(page)).interrupts).toBe(0);
  });

  test('says when there is no camera, rather than offer Nothing alone', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.enumerateDevices = () => Promise.resolve([]);
    });
    await live(page);
    await page.getByRole('button', { name: 'Choose what Kira sees' }).click();
    await expect(menu(page).getByText('No camera found')).toBeVisible();
    await expect(menu(page).getByRole('group', { name: 'Camera' })).toHaveCount(0);
  });

  test('closes when the chip is pressed again', async ({ page }) => {
    await live(page);
    await chip(page).click();
    await expect(menu(page)).toBeVisible();
    await chip(page).click();
    await expect(menu(page)).toBeHidden();
    await expect(chip(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test('opens from the stage’s one action', async ({ page }) => {
    await live(page);
    await page.getByRole('button', { name: 'Choose what Kira sees' }).click();
    await expect(menu(page)).toBeVisible();
  });

  test('has no accessibility violations while open', async ({ page }) => {
    await live(page);
    await chip(page).click();
    await expect(menu(page)).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('spaces its groups, rules and rows as the layout requires', async ({ page }) => {
    await live(page);
    await chip(page).click();
    await expect(cameraRow(page)).toBeVisible();
    const boxes = await menu(page).evaluate((element) => {
      const origin = element.getBoundingClientRect();
      const box = (part: Element) => {
        const r = part.getBoundingClientRect();
        return { x: r.x - origin.x, y: r.y - origin.y, w: r.width, h: r.height };
      };
      return [...element.querySelectorAll('[role="menuitemradio"], [role="separator"], p')].map(
        (part) => ({ kind: part.getAttribute('role') ?? 'heading', ...box(part) }),
      );
    });
    const [camera, firstRule, screen, ...rest] = boxes.slice(1);
    // Inside its 1 px edge, 4 of padding: the rows 342 wide from 5 (the kit Menu).
    expect(boxes[0]).toEqual({ kind: 'heading', x: 5, y: 5, w: 342, h: 24 });
    expect(camera).toMatchObject({ kind: 'menuitemradio', x: 5, y: 29, w: 342 });
    if (!camera || !firstRule || !screen) throw new Error('No groups.');
    // Rules 8 in from the rows, 4 under the row above, 8 over a group's name, 4 over a row.
    expect(firstRule).toMatchObject({ x: 13, y: camera.y + camera.h + 4, w: 326, h: 1 });
    expect(screen).toMatchObject({ kind: 'heading', y: firstRule.y + 1 + 8, h: 24 });
    const lastRule = rest.findIndex((part) => part.kind === 'separator');
    const [aboveRule, rule, belowRule] = rest.slice(lastRule - 1, lastRule + 2);
    if (!aboveRule || !rule || !belowRule) throw new Error('No rule before Image….');
    expect(rule.y).toBe(aboveRule.y + aboveRule.h + 4);
    expect(belowRule.y).toBe(rule.y + 1 + 4);
    // The camera's picture slot: fill.emphasis with the kit's 1 px edge inside.
    const slot = await cameraRow(page)
      .locator('.va-source-menu__picture')
      .evaluate((element) => ({
        fill: getComputedStyle(element).backgroundColor,
        edge: getComputedStyle(element, '::after').boxShadow,
        glyph: getComputedStyle(element).color,
      }));
    expect(slot).toEqual({
      fill: 'rgba(255, 255, 255, 0.08)',
      edge: 'rgba(255, 255, 255, 0.08) 0px 0px 0px 1px inset',
      glyph: 'rgb(246, 248, 250)',
    });

    expect(
      await menu(page)
        .locator('.va-source-menu__glyph')
        .first()
        .evaluate((element) => getComputedStyle(element).opacity),
    ).toBe('1');
  });

  for (const [label, stored, note] of [
    ['', null, 'rgba(246, 248, 250, 0.7)'],
    [' with Increase contrast on', { highContrast: 'on' }, 'rgba(246, 248, 250, 0.9)'],
  ] as const) {
    test(`keeps a note at 4.5 : 1 on a pressed row${label}`, async ({ page }) => {
      if (stored)
        await page.addInitScript((value) => {
          window.localStorage.setItem('va.preferences', JSON.stringify(value));
        }, stored);
      await live(page);
      await chip(page).click();
      const image = menu(page).getByRole('menuitemradio', { name: /^Image…/ });
      await image.hover();
      await page.mouse.down();
      expect(
        await image
          .locator('.va-source-menu__aside')
          .evaluate((element) => getComputedStyle(element).color),
      ).toBe(note);
      // Let go off the row: nothing is picked.
      await page.mouse.move(0, 0);
      await page.mouse.up();
    });
  }

  test('highlights the checked row it opens on, then the row under the pointer (D6w-c)', async ({
    page,
  }) => {
    await live(page);
    await chip(page).click();
    const nothing = menu(page).getByRole('menuitemradio', { name: 'Nothing · voice only' });
    await expect(nothing).toBeFocused();
    const fill = (row: Locator) =>
      row.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(await fill(nothing)).toBe('rgba(255, 255, 255, 0.08)');
    expect(await ringWidth(nothing)).toBe(0);

    const window = menu(page).getByRole('menuitemradio', { name: 'Window…' });
    await window.hover();
    expect(await fill(window)).toBe('rgba(255, 255, 255, 0.08)');
    expect(await fill(nothing)).toBe('rgba(0, 0, 0, 0)');
  });
});

test.describe('the camera', () => {
  test('sends the camera’s own track, unmirrored, and mirrors only the preview', async ({
    page,
  }) => {
    await live(page);
    await shareCamera(page);

    const record = await fakeRecord(page);
    expect(record.visions).toHaveLength(1);
    const sent = record.visions[0];
    expect(sent).toMatchObject({ kind: 'camera', canvas: false });
    // The track sent is the very one the camera gave the preview.
    const previewTrack = await page
      .locator('.va-camera__video')
      .evaluate(
        (video: HTMLVideoElement) =>
          (video.srcObject as MediaStream | null)?.getVideoTracks()[0]?.id,
      );
    expect(previewTrack).toBe(sent?.trackId);
    await expect(page.locator('.va-camera__video')).toHaveCSS(
      'transform',
      'matrix(-1, 0, 0, 1, 0, 0)',
    );

    await expect(capsule(page)).toHaveClass(/convai-capsule--over-picture/);
    await expect(chip(page)).toHaveAccessibleName(/^Camera · .+, live$/);
  });

  test('turns off on Nothing: Convai sees nothing and the camera’s light goes off', async ({
    page,
  }) => {
    await live(page);
    await shareCamera(page);
    await chip(page).click();
    await menu(page).getByRole('menuitemradio', { name: 'Nothing · voice only' }).click();

    await expect(chip(page)).toHaveAccessibleName(/Nothing shared/);
    await expect(page.getByText('Show Kira something')).toBeVisible();
    expect((await fakeRecord(page)).visions.at(-1)).toBeNull();
    const states = await page.evaluate(() =>
      (window.fakeConvai?.tracks ?? []).map((t) => t.readyState),
    );
    expect(states).toEqual(['ended']);
  });

  test('waits for the reply to end before it starts sharing', async ({ page }) => {
    await live(page);
    await page.keyboard.press('/');
    await page.keyboard.type('What is this?');
    await page.keyboard.press('Enter');
    await emit(page, { type: 'activity', activity: 'speaking' });

    await chip(page).click();
    await cameraRow(page).click();
    await page.waitForTimeout(500);
    expect((await fakeRecord(page)).visions).toEqual([]);

    await emit(page, { type: 'reply', id: 'r1', text: 'A mug.', streaming: false });
    await emit(page, { type: 'activity', activity: 'idle' });
    await expect(chip(page).locator('.va-chip__slot')).toHaveAttribute('data-mark', 'live');
    expect((await fakeRecord(page)).visions).toHaveLength(1);
  });

  test('marks a question asked while it is shared as asked with the camera', async ({ page }) => {
    await live(page);
    await shareCamera(page);
    await page.keyboard.press('/');
    await page.keyboard.type('What is this?');
    await page.keyboard.press('Enter');
    await expect(page.locator('.va-moment__meta').first()).toHaveText(/^Camera · /);
  });

  test('says the camera was disconnected, and the stage that sharing stopped', async ({ page }) => {
    skipIn(page, ['firefox'], limits.ended);
    await live(page);
    await shareCamera(page);
    await page.evaluate(() => window.fakeConvai?.tracks[0]?.dispatchEvent(new Event('ended')));

    await expect(page.getByText('The camera was disconnected', { exact: true })).toBeVisible();
    await expect(page.getByText('Sharing stopped')).toBeVisible();
    await expect(chip(page)).toHaveAccessibleName('Camera · Disconnected, failed');
    expect((await fakeRecord(page)).visions.at(-1)).toBeNull();
  });
});

test.describe('a camera that does not start', () => {
  test('in use: the banner asks to close the other app, the chip names the cause', async ({
    page,
  }) => {
    await refuseCamera(page, 'NotReadableError');
    await live(page);
    await chip(page).click();
    await cameraRow(page).click();

    await expect(page.getByText('The camera is in use', { exact: true })).toBeVisible();
    await expect(chip(page)).toHaveAccessibleName('Camera · Camera in use, failed');
    await expect(chip(page).locator('.va-chip__slot')).toHaveAttribute('data-mark', 'failed');

    const title = page.getByText('Sharing stopped', { exact: true });
    await expect(title).toBeVisible();
    await expect(page.locator('.va-nothing')).toHaveCSS('padding-top', '172px');
    await expect(page.locator('.va-nothing')).toHaveCSS('padding-bottom', '104px');
    const [banner, words] = await Promise.all([
      page.locator('.convai-island__banner').boundingBox(),
      title.boundingBox(),
    ]);
    if (!banner || !words) throw new Error('No layout.');
    expect(words.y).toBeGreaterThan(banner.y + banner.height + 100);

    // Try again shows its try, then says it is still in use.
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText(/^Still in use\./)).toBeVisible();

    await page.getByRole('button', { name: 'Choose another' }).click();
    await expect(menu(page)).toBeVisible();
    await expect(chip(page)).toHaveAccessibleName(/Nothing shared/);
    expect((await fakeRecord(page)).visions).toEqual([]);
  });

  test('blocked: the banner names site settings and no browser part', async ({ page }) => {
    await refuseCamera(page, 'NotAllowedError', 'denied');
    await live(page);
    await chip(page).click();
    await cameraRow(page).click();

    await expect(
      page.getByText('Your browser isn’t letting Convai use the camera', { exact: true }),
    ).toBeVisible();
    await expect(chip(page)).toHaveAccessibleName('Camera · Camera blocked, failed');
  });

  test('not allowed yet: plain words, nothing went wrong', async ({ page }) => {
    await refuseCamera(page, 'NotAllowedError', 'prompt');
    await live(page);
    await chip(page).click();
    await cameraRow(page).click();

    await expect(page.getByText('Camera not allowed yet', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Kira can see once you allow the camera.', { exact: true }),
    ).toBeVisible();
    // Nothing went wrong, so nothing "stopped": the stage keeps its first invitation.
    await expect(page.getByText('Show Kira something')).toBeVisible();
  });

  test('a slow camera shows its loader, then Cancel after 8 s', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => new Promise(() => undefined);
    });
    await page.clock.install();
    await live(page);
    await chip(page).click();
    await cameraRow(page).click();

    await expect(chip(page).locator('.va-chip__slot')).toHaveAttribute('data-mark', 'starting');
    await page.clock.runFor(300);
    await expect(page.getByText('Starting the camera…')).toBeVisible();
    await expect(page.getByText('Taking longer than usual')).toBeHidden();
    await page.clock.runFor(8000);
    await expect(page.getByText('Taking longer than usual')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Show Kira something')).toBeVisible();
    await expect(chip(page)).toHaveAccessibleName(/Nothing shared/);
  });
});

test.describe('the transcript’s pictures (Moments)', () => {
  async function ask(page: Page, question: string, id: string) {
    await page.keyboard.press('/');
    await page.keyboard.type(question);
    await page.keyboard.press('Enter');
    await emit(page, { type: 'activity', activity: 'thinking' });
    await emit(page, { type: 'reply', id, text: 'A ceramic mug.', streaming: false });
    await emit(page, { type: 'activity', activity: 'idle' });
  }

  test('keeps a still of what Kira saw beside each question, and no picture with nothing shared', async ({
    page,
  }) => {
    skipIn(page, ['webkit'], limits.noPlayback);
    skipIn(page, ['firefox'], limits.flatCamera);
    await page.setViewportSize({ width: 1440, height: 900 });
    await live(page);
    await ask(page, 'Can you hear me?', 'r1');
    const moments = page.locator('.va-moment');
    await expect(moments).toHaveCount(1);
    await expect(moments.first().locator('.va-moment__picture')).toHaveCount(0);

    await shareCamera(page);
    await ask(page, 'What is this?', 'r2');
    const picture = moments.nth(1).locator('.va-moment__picture');
    await expect(picture).toHaveCSS('width', '64px');
    await expect(picture).toHaveCSS('height', '40px');
    const still = picture.locator('img');
    await expect(still).toHaveAttribute('src', /^data:image\/jpeg/);
    // Twice the drawn size, from the camera's own picture: Chromium's fake camera is not one colour.
    const drawn = await still.evaluate(async (image: HTMLImageElement) => {
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      context?.drawImage(image, 0, 0);
      const data = context?.getImageData(0, 0, canvas.width, canvas.height).data ?? [];
      const colours = new Set<number>();
      for (let i = 0; i < data.length; i += 4 * 7) colours.add((data[i] ?? 0) >> 4);
      return { width: image.naturalWidth, height: image.naturalHeight, colours: colours.size };
    });
    expect(drawn.width).toBe(128);
    expect(drawn.height).toBe(80);
    expect(drawn.colours).toBeGreaterThan(1);
    // The earlier moment steps back by its question; the newest stands whole.
    await expect(moments.first().locator('.va-moment__text')).toHaveCSS('opacity', '0.8');
    await expect(moments.nth(1).locator('.va-moment__text')).toHaveCSS('opacity', '1');
    await expect(moments.nth(1).locator('.va-moment__text')).toHaveCSS('font-weight', '600');
  });

  test('marks a stopped reply under the whole moment, at the picture’s left (H3)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await live(page);
    await shareCamera(page);
    await page.keyboard.press('/');
    await page.keyboard.type('Is it microwave safe?');
    await page.keyboard.press('Enter');
    await emit(page, { type: 'activity', activity: 'thinking' });
    await emit(page, {
      type: 'reply',
      id: 'r1',
      text: 'Most likely. It’s glazed',
      streaming: true,
    });
    await emit(page, { type: 'activity', activity: 'speaking' });
    await page.keyboard.press('Escape');
    const moment = page.locator('.va-moment').first();
    const stopped = moment.getByText('Stopped', { exact: true });
    await expect(stopped).toBeVisible();
    const [picture, reply, line] = await Promise.all([
      moment.locator('.va-moment__picture').boundingBox(),
      moment.locator('.va-turn__reply').boundingBox(),
      stopped.boundingBox(),
    ]);
    if (!picture || !reply || !line) throw new Error('No box.');
    expect(Math.abs(line.x - picture.x)).toBeLessThanOrEqual(1);
    // 16 under the reply's last line (kit .cv-tx__mstopped), 12 / 400 text.tertiary.
    expect(line.y - (reply.y + reply.height)).toBeGreaterThanOrEqual(14);
    expect(line.y - (reply.y + reply.height)).toBeLessThanOrEqual(18);
    await expect(stopped).toHaveCSS('font-size', '12px');
  });
});
