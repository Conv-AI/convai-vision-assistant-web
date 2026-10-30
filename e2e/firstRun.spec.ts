import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { closeFloatingWindow, closeFloatingWindows, floatingWindowFrom } from './compact';
import { askedDevices, fakeAccess, setPermission, type FakeAccessOptions } from './fakeAccess';
import { fakeRecord, openApp, type ApiCharacter, type FakeOptions } from './fakeConvai';
import { limits, skipIn } from './engines';

test.afterEach(async ({ page }) => {
  await closeFloatingWindows(page);
});

const page$ = (page: Page) => page.locator('.va-first-run');
const title = (page: Page) => page.getByRole('heading', { level: 1 });
const go = (page: Page, name: string | RegExp) =>
  page$(page).getByRole('button', { name, exact: typeof name === 'string' });

async function open(
  page: Page,
  access: FakeAccessOptions = {},
  options: FakeOptions = {},
  characters?: ApiCharacter[],
) {
  await fakeAccess(page, access);
  await openApp(page, { firstRun: true, ...options }, characters);
}

async function toPermissions(page: Page) {
  await go(page, 'Get started').click();
  await go(page, 'Continue with Hands free').click();
  await expect(title(page)).toContainText('Let Kira hear and see');
}

test.describe('the first run', () => {
  test('shows Welcome with the character’s name, and connects nothing before Start', async ({
    page,
  }) => {
    await open(page);
    await expect(title(page)).toHaveText('Show Kira what you see');
    await expect(page$(page)).toContainText(
      'Share your camera, a window or your screen, and ask out loud.',
    );
    await expect(page.locator('.va-first-run__back')).toHaveCount(0);
    await expect(page.locator('.va-first-run__dashes')).toHaveCount(0);
    // The turn plays and holds: the whole answer read.
    await expect(page.locator('.va-first-run__answer')).toHaveAttribute('data-shown');
    await expect(page.locator('.va-first-run__unread')).toHaveCount(0, { timeout: 8000 });
    await expect(page.locator('.convai-capsule')).toHaveCount(0);
    expect((await fakeRecord(page)).connects).toBe(0);
  });

  test('walks hands free with the microphone and camera allowed, then starts listening', async ({
    page,
  }) => {
    skipIn(page, ['webkit'], limits.noPip);
    // The browser may still say "prompt" after the run was given the microphone ("Allow this time").
    await open(page, {}, { permission: 'prompt' });
    await go(page, 'Get started').click();
    await expect(title(page)).toHaveText('Step 1 of 3, How do you want to talk?');
    await expect(title(page)).toBeFocused();
    const handsFree = page.getByRole('radio', { name: /Hands free/ });
    await expect(handsFree).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.va-first-run__dash--on')).toHaveCount(1);
    await go(page, 'Continue with Hands free').click();

    await expect(go(page, 'Continue')).toBeEnabled();
    await expect(go(page, 'Continue')).toHaveClass(/convai-button--primary/);
    await expect(go(page, 'Type instead')).toHaveCount(0);
    await page$(page).getByRole('button', { name: 'Allow: Microphone' }).click();
    await expect(page$(page).locator('.va-first-run__row').first()).toContainText('Allowed');
    await page$(page).getByRole('button', { name: 'Allow: Camera' }).click();
    await expect(page$(page).locator('.va-first-run__row').nth(1)).toContainText('Allowed');
    expect(await askedDevices(page)).toEqual(['microphone', 'camera']);
    await go(page, 'Continue').click();

    await expect(title(page)).toHaveText('Step 3 of 3, Where should Kira stay?');
    await go(page, 'Continue').click();

    await expect(title(page)).toHaveText('You’re all set');
    await expect(page.locator('.va-first-run__dash')).toHaveCount(3);
    await expect(page.locator('.va-first-run__dash--on')).toHaveCount(3);
    await expect(page$(page)).toContainText('Kira is ready. Start when you are.');
    await expect(page.locator('.va-first-run__chip')).toHaveText([
      'Hands free',
      'Microphone',
      'Camera',
      'Full window',
    ]);
    await expect(page.locator('.va-first-run__back')).toHaveCount(0);
    expect((await fakeRecord(page)).connects).toBe(0);
    await go(page, 'Start').click();

    await expect(page.locator('.convai-capsule')).toHaveAttribute('data-state', 'ready');
    expect(await page.evaluate(() => localStorage.getItem('va.talk-mode'))).toBe('hands-free');
    expect(await page.evaluate(() => localStorage.getItem('va.first-run-done'))).toBe('1');
    // Hands free opens the microphone once connected.
    await expect.poll(async () => (await fakeRecord(page)).microphone).toEqual([true]);
  });

  test('chooses push to talk with the arrow keys and changes the talk key', async ({ page }) => {
    skipIn(page, ['webkit'], limits.noPip);
    await open(page, { microphone: { permission: 'granted' }, camera: { permission: 'granted' } });
    await expect(title(page)).toHaveText('Show Kira what you see');
    await page.keyboard.press('Enter');
    await expect(title(page)).toContainText('How do you want to talk?');
    await page.getByRole('radio', { name: /Hands free/ }).focus();
    await page.keyboard.press('ArrowRight');
    const ptt = page.getByRole('radio', { name: /Push to talk/ });
    await expect(ptt).toHaveAttribute('aria-checked', 'true');
    await expect(ptt).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(title(page)).toContainText('Your talk key');
    await page$(page)
      .getByRole('button', { name: /Change Talk key/ })
      .click();
    await expect(page$(page)).toContainText('Press the key you want…');
    await page.keyboard.press('m');
    await expect(page.getByRole('alert')).toHaveText(
      'M is already Mute. Press another key, or Esc to keep T.',
    );
    await page.keyboard.press('Control+g');
    await expect(page.getByRole('alert')).toHaveText('Pick a key without Ctrl or Alt.');
    // Esc ends the recording and keeps T: the step stays.
    await page.keyboard.press('Escape');
    await expect(title(page)).toContainText('Your talk key');
    await expect(page.locator('.va-first-run__small-cap')).toHaveText('T');
    await page$(page)
      .getByRole('button', { name: /Change Talk key/ })
      .click();
    await page.keyboard.press('g');
    await expect(page.locator('.va-first-run__small-cap')).toHaveText('G');
    await expect(page.locator('.va-first-run__cap')).toHaveText('G');

    // Esc is Back.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('radio', { name: /Push to talk/ })).toContainText(
      'Hold G while you talk.',
    );
    await page.keyboard.press('Enter');
    await go(page, 'Continue').click();
    await expect(title(page)).toContainText('Where should Kira stay?');
    await go(page, 'Continue').click();
    await expect(title(page)).toContainText('You’re all set');
    await expect(page$(page)).toContainText('Hold G and ask Kira about what you share.');
    await expect(page.locator('.va-first-run__chip').first()).toHaveText('Push to talk · G');
    await go(page, 'Start').click();

    await expect(page.locator('.convai-capsule')).toContainText('Hold G to talk');
    await page.keyboard.down('g');
    await expect(page.locator('.convai-capsule')).toHaveAttribute('data-state', 'held');
    await page.keyboard.up('g');
    expect((await fakeRecord(page)).microphone[0]).toBe(true);
    // T is a letter again: it holds nothing.
    await page.keyboard.down('t');
    await page.waitForTimeout(300);
    await expect(page.locator('.convai-capsule')).toHaveAttribute('data-state', 'ready');
    await page.keyboard.up('t');
  });

  test('goes on without the microphone, and the window asks for it on the first hold', async ({
    page,
  }) => {
    skipIn(page, ['webkit'], limits.noPip);
    await open(page, {}, { permission: 'prompt' });
    await go(page, 'Get started').click();
    await page.getByRole('radio', { name: /Push to talk/ }).click();
    await go(page, 'Continue with Push to talk').click();
    await go(page, 'Continue').click();
    await expect(title(page)).toContainText('Let Kira hear and see');
    await go(page, 'Continue').click();
    await go(page, 'Continue').click();
    await expect(page$(page)).toContainText('Hold T and ask Kira about what you share.');
    await expect(page$(page)).toContainText(
      'Kira asks for the microphone the first time you hold T.',
    );
    await expect(page.locator('.va-first-run__chip')).toHaveText([
      'Push to talk · T',
      'Microphone when you talk',
      'Camera when you share',
      'Full window',
    ]);
    expect(await askedDevices(page)).toEqual([]);
    await go(page, 'Start').click();
    await expect(page.locator('.convai-capsule')).toHaveAttribute('data-state', 'ready');

    await page.keyboard.down('t');
    await expect(
      page.getByRole('dialog', { name: 'I need your microphone to hear you' }),
    ).toBeVisible();
    await page.keyboard.up('t');
  });

  test('after a closed prompt offers Try again, and the window asks the browser itself', async ({
    page,
  }) => {
    skipIn(page, ['webkit'], limits.noPip);
    await open(
      page,
      { microphone: { answer: 'NotAllowedError', after: 'prompt' } },
      { permission: 'prompt' },
    );
    await go(page, 'Get started').click();
    await page.getByRole('radio', { name: /Push to talk/ }).click();
    await go(page, 'Continue with Push to talk').click();
    await go(page, 'Continue').click();
    await page$(page).getByRole('button', { name: 'Allow: Microphone' }).click();
    await expect(title(page)).toContainText('Talk or type, your choice');
    const row = page$(page).locator('.va-first-run__row').first();
    await expect(row).toContainText('Off. Kira can’t hear you');
    await expect(row.locator('.va-first-run__warn')).toHaveCount(1);
    await expect(row.getByRole('button', { name: 'Try again: Microphone' })).toHaveClass(
      /convai-button--primary/,
    );
    await expect(go(page, 'Type instead')).toHaveClass(/convai-button--secondary/);
    await go(page, 'Type instead').click();
    await go(page, 'Continue').click();
    await expect(page$(page)).toContainText(
      'To talk later, allow the microphone in your browser’s site settings.',
    );
    await go(page, 'Start').click();
    await expect(page.locator('.convai-capsule')).toHaveAttribute('data-state', 'ready');
    // The run asked already: no character's ask, the browser's prompt at once.
    await page.keyboard.down('t');
    await expect.poll(async () => (await fakeRecord(page)).microphone).toContain(true);
    await expect(page.getByRole('dialog', { name: /microphone/ })).toHaveCount(0);
    await page.keyboard.up('t');
  });

  test('says where to allow a blocked microphone and goes on when access comes back', async ({
    page,
  }) => {
    skipIn(page, ['webkit'], limits.noPip);
    await open(page, { microphone: { permission: 'denied' }, camera: { permission: 'granted' } });
    await toPermissionsBlocked(page);
    const rows = page$(page).locator('.va-first-run__row');

    await expect(rows).toHaveCount(2);
    await expect(page$(page)).toContainText(
      'You can type now. To talk, allow the microphone in your browser’s site settings.',
    );
    await expect(rows.first()).toContainText('Vision Assistant needs your microphone');
    await expect(rows.first()).toContainText('Blocked');
    await expect(rows.first().getByRole('button')).toHaveCount(0);
    await expect(page$(page)).toContainText('This page updates as soon as you allow it.');
    await setPermission(page, 'microphone', 'granted');
    await expect(title(page)).toContainText('Where should Kira stay?');
  });

  test('moves the focus to the large button when the row’s button goes', async ({ page }) => {
    await open(page);
    await toPermissions(page);
    await page$(page).getByRole('button', { name: 'Allow: Microphone' }).focus();
    await page.keyboard.press('Enter');
    await expect(page$(page).locator('.va-first-run__row').first()).toContainText('Allowed');
    await expect(go(page, 'Continue')).toBeFocused();
    await expect(page.getByRole('status').filter({ hasText: 'Microphone' })).toContainText(
      'Microphone: So you can just talk. You can type instead. Allowed',
    );
  });

  test('ends the talk key’s recording when the step is left, and on Tab', async ({ page }) => {
    skipIn(page, ['webkit'], limits.noPip);
    await open(page, { microphone: { permission: 'granted' }, camera: { permission: 'granted' } });
    await go(page, 'Get started').click();
    await page.getByRole('radio', { name: /Push to talk/ }).click();
    await go(page, 'Continue with Push to talk').click();
    const change = page$(page).getByRole('button', { name: /Change Talk key/ });
    await change.click();
    await page.keyboard.press('Tab');
    await expect(page$(page)).toContainText('Any letter or number, without Ctrl or Alt');
    // Back while recording: coming back, the row is not recording.
    await change.click();
    await page$(page).locator('.va-first-run__back').click();
    // The page's Enter works again at once: the recording ended with the step.
    await page.keyboard.press('Enter');
    await expect(title(page)).toContainText('Your talk key');
    await expect(page$(page)).toContainText('Any letter or number, without Ctrl or Alt');
    await change.click();
    await expect(page$(page)).toContainText('Press the key you want…');
    await go(page, 'Continue').click();
    await expect(title(page)).toContainText('Where should Kira stay?');
    await go(page, 'Continue').click();
    await expect(title(page)).toContainText('You’re all set');
    // Not stuck recording: the page’s own keys work again.
    await page.locator('body').click({ position: { x: 4, y: 4 } });
    await page.keyboard.press('Enter');
    await expect(page.locator('.convai-capsule')).toBeVisible();
  });

  test('names a microphone in use and lets the person try again', async ({ page }) => {
    await open(page, { microphone: { answer: 'NotReadableError' } });
    await toPermissions(page);
    await page$(page).getByRole('button', { name: 'Allow: Microphone' }).click();
    const row = page$(page).locator('.va-first-run__row').first();
    await expect(row).toContainText('Microphone in use by another app');
    await expect(row.getByRole('button', { name: 'Try again: Microphone' })).toBeVisible();
  });

  test('leaves Permissions out when nothing is left to ask', async ({ page }) => {
    skipIn(page, ['webkit'], limits.noPip);
    await open(page, { microphone: { permission: 'granted' }, camera: { connected: false } });
    await go(page, 'Get started').click();
    await go(page, 'Continue with Hands free').click();
    await expect(title(page)).toHaveText('Step 2 of 2, Where should Kira stay?');
    await go(page, 'Continue').click();
    await expect(title(page)).toHaveText('You’re all set');
    await expect(page.locator('.va-first-run__chip')).toHaveText([
      'Hands free',
      'Microphone',
      'Full window',
    ]);
  });

  test('shows once on a device', async ({ page }) => {
    skipIn(page, ['webkit'], limits.noPip);
    await open(page, { microphone: { permission: 'granted' }, camera: { permission: 'granted' } });
    await go(page, 'Get started').click();
    await go(page, 'Continue with Hands free').click();
    await go(page, 'Continue').click();
    await go(page, 'Start').click();
    await expect(page.locator('.convai-capsule')).toBeVisible();
    await page.reload();
    await expect(page.locator('.convai-capsule')).toBeVisible();
    await expect(page$(page)).toHaveCount(0);
  });

  test('gives way to the window, unmarked, when there is no character', async ({ page }) => {
    await open(page, {}, {}, []);
    await expect(page.getByText('No characters available').first()).toBeVisible();
    await expect(page$(page)).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('va.first-run-done'))).toBeNull();
  });

  test('stacks the ways of talking at 560 wide without a sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 560, height: 720 });
    await open(page);
    await go(page, 'Get started').click();
    const [first, second] = await Promise.all(
      [/Hands free/, /Push to talk/].map((name) => page.getByRole('radio', { name }).boundingBox()),
    );
    expect(second?.y ?? 0).toBeGreaterThan((first?.y ?? 0) + (first?.height ?? 0) - 1);
    const scroll = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      inner: window.innerWidth,
    }));
    expect(scroll.width).toBeLessThanOrEqual(scroll.inner);
  });

  test('passes axe on every step', async ({ page }) => {
    skipIn(page, ['webkit'], limits.noPip);
    await open(page, {}, {});
    const check = async () => {
      // A step fades in over 150 ms: measure the colours once it stands.
      await page.waitForFunction(() =>
        document
          .getAnimations()
          .every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity),
      );
      const result = await new AxeBuilder({ page }).include('.va-first-run').analyze();
      expect(result.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    };
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await check();
    await go(page, 'Get started').click();
    await check();
    await page.getByRole('radio', { name: /Push to talk/ }).click();
    await go(page, 'Continue with Push to talk').click();
    await check();
    await go(page, 'Continue').click();
    await check();
    await go(page, 'Continue').click();
    await expect(title(page)).toContainText('Where should Kira stay?');
    await check();
    await go(page, 'Continue').click();
    await check();
  });
});

async function toPermissionsBlocked(page: Page) {
  await go(page, 'Get started').click();
  await go(page, 'Continue with Hands free').click();
  await expect(title(page)).toContainText('Talk or type, your choice');
}

test.describe('where Kira stays (F4)', () => {
  test.skip(({ browserName }) => browserName === 'webkit', limits.noPip);
  const cards = (page: Page) => page.getByRole('radiogroup', { name: 'Where should Kira stay?' });

  async function toWindow(page: Page) {
    await open(page, { microphone: { permission: 'granted' }, camera: { permission: 'granted' } });
    await go(page, 'Get started').click();
    await go(page, 'Continue with Hands free').click();
    await expect(title(page)).toHaveText('Step 2 of 2, Where should Kira stay?');
  }

  test('offers the full window and Compact, the full window chosen, with where to switch later', async ({
    page,
  }) => {
    await toWindow(page);
    await expect(page$(page)).toContainText('Switch any time from the title bar.');
    await expect(cards(page).getByRole('radio')).toHaveText([
      /^Full window.*A big stage for your camera, with the conversation beside it\.$/,
      /^Compact.*A small capsule that floats over any app\.$/,
    ]);
    await expect(cards(page).getByRole('radio', { name: /Full window/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    // Each card's picture: the screen, and Compact's capsule over another app's window.
    await expect(page.locator('.va-stay-picture')).toHaveCount(2);
    await expect(page.locator('.va-stay-picture__app')).toHaveCount(1);

    await page.waitForFunction(() =>
      document
        .getAnimations()
        .every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity),
    );
    const screen = await page.locator('.va-stay-picture').nth(1).boundingBox();
    const capsule = page.locator('.va-stay-picture__kira--capsule');
    const box = await capsule.boundingBox();
    if (!screen || !box) throw new Error('The Compact picture is not drawn.');

    const at = (part: number, whole: number) => (part / whole) * 100;
    const place = [
      at(box.x - screen.x, screen.width),
      at(box.y - screen.y, screen.height),
      at(box.width, screen.width),
      at(box.height, screen.height),
    ];
    [56, 72, 36, 14].forEach((want, i) => {
      expect(
        Math.abs((place[i] ?? 0) - want),
        `place ${String(i)}: ${String(place[i])}`,
      ).toBeLessThan(1);
    });
    const radius = await capsule.evaluate((element) =>
      parseFloat(getComputedStyle(element).borderTopLeftRadius),
    );
    expect(radius).toBeGreaterThanOrEqual(box.height / 2);
  });

  test('chooses with the arrow keys, keeps the choice, and Start opens the floating window', async ({
    page,
  }) => {
    await toWindow(page);
    await cards(page)
      .getByRole('radio', { name: /Full window/ })
      .focus();
    await page.keyboard.press('ArrowRight');
    const compact = cards(page).getByRole('radio', { name: /Compact/ });
    await expect(compact).toHaveAttribute('aria-checked', 'true');
    await expect(compact).toBeFocused();
    // Nothing opens before Start.
    let popups = 0;
    page.on('popup', () => {
      popups++;
    });
    await page.keyboard.press('Enter');
    await expect(title(page)).toHaveText('You’re all set');
    expect(await page.evaluate(() => localStorage.getItem('va.window-mode'))).toBe('compact');
    await expect(page.locator('.va-first-run__chip').last()).toHaveText('Compact');
    expect(popups).toBe(0);

    const pip = await floatingWindowFrom(page, () => go(page, 'Start').click());
    await expect(pip.locator('.convai-capsule')).toHaveAttribute('data-state', 'ready');
    // The tab says where Kira went, and the session runs in the floating window.
    await expect(page.getByRole('button', { name: 'Bring Kira back' })).toBeVisible();
    expect((await fakeRecord(page)).connects).toBe(1);
    // Back from the floating window, the full window shows.
    await closeFloatingWindow(pip);
    await expect(page.locator('.convai-capsule')).toBeVisible();
  });

  test('keeps the full window: Start opens nothing, and Back returns to the step', async ({
    page,
  }) => {
    await toWindow(page);
    await page.keyboard.press('Escape');
    await expect(title(page)).toContainText('How do you want to talk?');
    await page.keyboard.press('Enter');
    await expect(title(page)).toContainText('Where should Kira stay?');
    await go(page, 'Continue').click();
    let popups = 0;
    page.on('popup', () => {
      popups++;
    });
    await go(page, 'Start').click();
    await expect(page.locator('.convai-capsule')).toHaveAttribute('data-state', 'ready');
    await expect(page.getByRole('button', { name: 'Full window' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(popups).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem('va.window-mode'))).toBe('full');
  });

  test('is left out where the browser has no floating window', async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as unknown as { documentPictureInPicture?: unknown }).documentPictureInPicture;
    });
    await open(page, { microphone: { permission: 'granted' }, camera: { permission: 'granted' } });
    await go(page, 'Get started').click();
    // One step between Welcome and All set: no dashes.
    await expect(title(page)).toHaveText('How do you want to talk?');
    await expect(page.locator('.va-first-run__dashes')).toHaveCount(0);
    await go(page, 'Continue with Hands free').click();
    await expect(title(page)).toHaveText('You’re all set');
    await expect(page.locator('.va-first-run__chip')).toHaveText([
      'Hands free',
      'Microphone',
      'Camera',
    ]);
    await go(page, 'Start').click();
    await expect(page.locator('.convai-capsule')).toHaveAttribute('data-state', 'ready');
    // Start never opens the card that explains Compact.
    await expect(
      page.getByRole('dialog', { name: 'Compact needs a supported browser' }),
    ).toHaveCount(0);
  });

  test('stacks the two cards at 560 wide without a sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 560, height: 720 });
    await toWindow(page);
    const [first, second] = await Promise.all(
      [/Full window/, /Compact/].map((name) =>
        cards(page).getByRole('radio', { name }).boundingBox(),
      ),
    );
    expect(second?.y ?? 0).toBeGreaterThan((first?.y ?? 0) + (first?.height ?? 0) - 1);
    const scroll = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      inner: window.innerWidth,
    }));
    expect(scroll.width).toBeLessThanOrEqual(scroll.inner);
  });
});

test.describe('the first run as the reference viewport draw it', () => {
  /** A color token, resolved the way the browser writes a computed color. */
  async function token(page: Page, name: string): Promise<string> {
    return page.evaluate((variable) => {
      const probe = document.createElement('span');
      probe.style.color = `var(${variable})`;
      document.querySelector('.va-first-run')?.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    }, name);
  }

  test('titles every step 28/600, Welcome too', async ({ page }) => {
    await open(page);
    const size = () => title(page).evaluate((h) => getComputedStyle(h).fontSize);
    expect(await size()).toBe('28px');
    await go(page, 'Get started').click();
    await expect(title(page)).toContainText('How do you want to talk?');
    expect(await size()).toBe('28px');
  });

  test('draws the welcome answer’s unread part at text.secondary, for AA', async ({ page }) => {
    await open(page);
    const unread = page.locator('.va-first-run__unread');
    await expect(unread).toHaveCount(1);
    expect(await unread.evaluate((span) => getComputedStyle(span).color)).toBe(
      await token(page, '--convai-text-secondary'),
    );
  });

  test('counts four dashes for push to talk with Where Kira stays', async ({ page }) => {
    skipIn(page, ['webkit'], limits.noPip);
    await open(page);
    await go(page, 'Get started').click();
    await page.getByRole('radio', { name: /Push to talk/ }).click();
    await expect(page.locator('.va-first-run__dash')).toHaveCount(4);
    await go(page, 'Continue with Push to talk').click();
    await expect(title(page)).toHaveText('Step 2 of 4, Your talk key');
    // The row's key is the kit's KeyCap 24: fill.emphasis in a 1 px key edge.
    const cap = page.locator('.va-first-run__small-cap');
    expect(
      await cap.evaluate((c) => [
        c.getBoundingClientRect().height,
        getComputedStyle(c).backgroundColor,
      ]),
    ).toEqual([24, await token(page, '--convai-fill-emphasis')]);
    await go(page, 'Continue').click();
    // The note under the rows is text.tertiary (kit .cv-fr-note).
    expect(
      await page.locator('.va-first-run__note').evaluate((p) => getComputedStyle(p).color),
    ).toBe(await token(page, '--convai-text-tertiary'));
  });

  test('draws Where Kira stays as the kit’s PlaceCards', async ({ page }) => {
    skipIn(page, ['webkit'], limits.noPip);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, { microphone: { permission: 'granted' }, camera: { permission: 'granted' } });
    await go(page, 'Get started').click();
    await go(page, 'Continue with Hands free').click();
    await expect(title(page)).toContainText('Where should Kira stay?');
    const group = page.getByRole('radiogroup', { name: 'Where should Kira stay?' });
    const full = group.getByRole('radio', { name: /Full window/ });
    const compact = group.getByRole('radio', { name: /Compact/ });
    // Measured once the step has slid in: each box is read at its own moment of the slide.
    await page
      .locator('.va-first-run__step')
      .evaluate((step) => Promise.all(step.getAnimations().map((a) => a.finished)));
    const [a, b] = await Promise.all([full.boundingBox(), compact.boundingBox()]);
    if (!a || !b) throw new Error('The cards are not drawn.');
    // The frame's cards (a third of the kit's 920 grid each, 293), 20 apart.
    expect([a.width, b.width, b.x - (a.x + a.width)].map((n) => Math.round(n))).toEqual([
      293, 293, 20,
    ]);
    const look = (card: typeof full) =>
      card.evaluate((element) => {
        const style = getComputedStyle(element);
        const radio = element.querySelector('.va-first-run__radio');
        const dot = element.querySelector('.va-first-run__radio-dot');
        const name = element.querySelector('.va-first-run__mode-name');
        const well = element.querySelector('.va-first-run__well');
        return {
          padding: style.paddingTop,
          ring: style.boxShadow,
          radio: radio
            ? [radio.getBoundingClientRect().width, getComputedStyle(radio).backgroundColor]
            : null,
          dot: dot ? dot.getBoundingClientRect().width : null,
          title: name ? getComputedStyle(name).fontSize : null,
          well: well ? Math.round((well.clientWidth / well.clientHeight) * 100) / 100 : null,
        };
      });
    const green = await token(page, '--convai-switch-on');
    const white = await token(page, '--convai-text-primary');
    const chosen = await look(full);
    expect(chosen).toMatchObject({
      padding: '16px',
      radio: [20, green],
      dot: 8,
      title: '17px',
      well: 1.6,
    });
    // The 2 px ring lies inside the card, in text.primary.
    expect(chosen.ring).toBe(`${white} 0px 0px 0px 2px inset`);
    const other = await look(compact);
    expect(other.ring).not.toContain('inset');
    expect(other.dot).toBe(0);
  });
});

test('marks the chosen place under forced colors, card and radio', async ({ page }) => {
  skipIn(page, ['webkit'], limits.noPip);
  await page.emulateMedia({ forcedColors: 'active' });
  await open(page, { microphone: { permission: 'granted' }, camera: { permission: 'granted' } });
  await go(page, 'Get started').click();
  await go(page, 'Continue with Hands free').click();
  await expect(title(page)).toContainText('Where should Kira stay?');
  const group = page.getByRole('radiogroup', { name: 'Where should Kira stay?' });
  const radio = (name: RegExp) =>
    group.getByRole('radio', { name }).evaluate((card) => {
      const mark = card.querySelector('.va-first-run__radio');
      return {
        card: getComputedStyle(card).borderTopWidth,
        radio: mark ? getComputedStyle(mark).borderTopWidth : '',
      };
    });
  const chosen = await radio(/Full window/);
  const other = await radio(/Compact/);
  // Forced colors drop fills and shadows: the chosen card and its radio are told by their borders.
  expect(chosen.card).toBe('2px');
  expect(parseFloat(chosen.radio)).toBeGreaterThan(parseFloat(other.radio));
  expect(parseFloat(other.radio)).toBeGreaterThan(0);
});
