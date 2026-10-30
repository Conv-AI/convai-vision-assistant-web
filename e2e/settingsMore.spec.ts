import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { closeFloatingWindows, floatingWindowFrom, letFloatingWindowLoad } from './compact';
import { fakeRecord, openApp } from './fakeConvai';
import { launchOptions } from './launch';
import { engineOf, limits, skipIn } from './engines';

test.afterEach(async ({ page }) => {
  await closeFloatingWindows(page);
});

test.use({ launchOptions: launchOptions() });

const capsule = (page: Page) => page.locator('.convai-capsule');
const gear = (page: Page) => page.getByRole('button', { name: 'Settings' });
const settings = (page: Page) => page.locator('dialog.va-settings');
const title = (page: Page) => settings(page).getByRole('heading', { level: 2 });
const section = (page: Page, name: string) => settings(page).getByRole('tab', { name });
const row = (page: Page, id: string) => settings(page).locator(`[data-row="${id}"]`);

/** Live in push to talk with the microphone allowed before, as a returning visit. */
async function live(page: Page, width = 1280, height = 800) {
  await page.setViewportSize({ width, height });

  if (engineOf(page) !== 'firefox') await page.context().grantPermissions(['microphone']);
  await openApp(page);
  await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
}

async function openSection(page: Page, name: string) {
  await gear(page).click();
  await expect(settings(page)).toBeVisible();
  await section(page, name).click();
  await expect(title(page)).toHaveText(name);
}

/** Holds `key` long enough to talk, says what the capsule showed, and lets go. */
async function hold(page: Page, key: string): Promise<string | null> {
  await page.keyboard.down(key);
  await page.waitForTimeout(500);
  const state = await capsule(page).getAttribute('data-state');
  await page.keyboard.up(key);
  await expect(capsule(page)).not.toHaveAttribute('data-state', 'held');
  return state;
}

test.describe('Settings › Shortcuts', () => {
  test('records a new talk key mid-session; the window talks with it and T is a letter again', async ({
    page,
  }) => {
    await live(page);
    await expect(capsule(page)).toContainText('Hold T to talk');
    await openSection(page, 'Shortcuts');
    await row(page, 'shortcut-talk').getByRole('button', { name: 'Change Talk, T' }).click();
    await expect(row(page, 'shortcut-talk')).toContainText('Press the key you want. Esc cancels.');
    await expect(row(page, 'shortcut-talk')).toContainText('Press a key…');
    await page.keyboard.press('g');
    await expect(row(page, 'shortcut-talk')).toContainText('Changed');
    await expect(row(page, 'shortcut-hands-free')).toContainText('ShiftG');
    await expect(settings(page).getByRole('button', { name: 'Change Talk, G' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(settings(page)).toBeHidden();
    await expect(capsule(page)).toContainText('Hold G to talk');

    expect(await hold(page, 't')).toBe('ready');
    expect(await hold(page, 'g')).toBe('held');
    await expect.poll(async () => (await fakeRecord(page)).microphone).toContain(true);
    // A new page keeps the key.
    await page.reload();
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
    await expect(capsule(page)).toContainText('Hold G to talk');
  });

  test('a saved key types into a field: the Type field and the search take G and J as letters', async ({
    page,
  }) => {
    await live(page);
    await openSection(page, 'Shortcuts');
    await row(page, 'shortcut-talk').getByRole('button', { name: 'Change Talk, T' }).click();
    await page.keyboard.press('g');
    await expect(row(page, 'shortcut-talk')).toContainText('Changed');
    await row(page, 'shortcut-mute')
      .getByRole('button', { name: 'Change Mute microphone, M' })
      .click();
    await page.keyboard.press('j');
    await expect(row(page, 'shortcut-mute')).toContainText('Changed');

    const search = settings(page).getByRole('searchbox');
    await search.focus();
    expect(await hold(page, 'g')).toBe('ready');
    await page.keyboard.press('j');
    await expect(search).toHaveValue('gj');
    await expect(settings(page)).toBeVisible();
    // Esc clears the words, leaves the field, then closes.
    for (let i = 0; i < 3; i++) await page.keyboard.press('Escape');
    await expect(settings(page)).toBeHidden();

    await page.keyboard.press('/');
    const field = page.getByRole('textbox', { name: /^Message / });
    await expect(field).toBeFocused();
    await page.keyboard.down('g');
    await page.waitForTimeout(500);
    await page.keyboard.up('g');
    await page.keyboard.press('j');
    await expect(field).toHaveValue('gj');
    expect((await fakeRecord(page)).microphone).not.toContain(true);
    // Neither key acted: J did not mute, so the capsule still offers G to talk.
    await field.fill('');
    await page.keyboard.press('Escape');
    await expect(field).toBeHidden();
    await expect(capsule(page)).toContainText('Hold G to talk');
  });

  test('asks before taking Mute’s key; Mute is left without one and says nothing about M', async ({
    page,
  }) => {
    await live(page);
    await openSection(page, 'Shortcuts');
    await row(page, 'shortcut-talk').getByRole('button', { name: 'Change Talk, T' }).click();
    await page.keyboard.press('m');
    await expect(row(page, 'shortcut-talk')).toContainText(
      'M is already Mute microphone. Use it for Talk and leave Mute without a key?',
    );
    await expect(settings(page).getByRole('button', { name: 'Use M for Talk' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(row(page, 'shortcut-mute')).toContainText('Not set · Changed');
    await expect(settings(page).getByRole('button', { name: 'Reset all shortcuts' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(settings(page)).toBeHidden();

    // M talks now, and nothing mutes on it.
    expect(await hold(page, 'm')).toBe('held');
    // Shift M turns Hands free on; there the Lens mutes, with no key named.
    await page.keyboard.press('Shift+M');
    await expect(capsule(page)).toContainText('Just start talking');
    const lens = page.locator('.convai-capsule__lens');
    await expect(lens).toHaveAttribute('aria-label', 'Mute');
    await expect(lens).not.toHaveAttribute('aria-keyshortcuts');
    await lens.hover();
    const tip = page.locator('.convai-tooltip').filter({ hasText: 'Mute' });
    await expect(tip).toBeVisible();
    await expect(tip.locator('.convai-tooltip__shortcut')).toHaveCount(0);
    // Shift M again: push to talk.
    await page.mouse.move(4, 4);
    await page.keyboard.press('Shift+M');
    await expect(capsule(page)).toContainText('Hold M to talk');
  });

  test('refuses what the browser keeps in place, and Esc ends the wait before it closes Settings', async ({
    page,
  }) => {
    await live(page);
    await openSection(page, 'Shortcuts');
    const type = row(page, 'shortcut-type');
    await type.getByRole('button', { name: 'Change Type a message, Slash' }).click();
    await page.keyboard.press('Tab');
    await expect(type).toContainText('Tab moves between controls. Choose another key.');
    await expect(type.getByRole('button', { name: /^Change Type a message/ })).toBeFocused();
    await page.keyboard.press('Control+KeyF');
    await expect(type).toContainText('Ctrl+F belongs to the browser. Choose another key.');
    await page.keyboard.press('Control+Comma');
    await expect(settings(page)).toBeVisible();
    await expect(type).toContainText('Ctrl+, is Settings and can’t be changed.');
    await page.keyboard.press('Shift+KeyQ');
    await expect(type).toContainText('Shift+Q isn’t a shortcut here. Press a key on its own.');
    await page.keyboard.press('Escape');
    await expect(type).not.toHaveAttribute('data-recording');
    await expect(settings(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(settings(page)).toBeHidden();
    // Nothing changed.
    await page.keyboard.press('/');
    await expect(page.getByRole('textbox', { name: 'Message Kira' })).toBeVisible();
  });

  test('opens Shortcuts with Talk waiting from Talking’s key row, and resets every key after asking', async ({
    page,
  }) => {
    await live(page);
    await gear(page).click();
    await settings(page)
      .getByRole('button', { name: /^Push to talk key/ })
      .click();
    await expect(title(page)).toHaveText('Shortcuts');
    await expect(row(page, 'shortcut-talk')).toHaveAttribute('data-recording', 'true');
    await page.keyboard.press('7');
    await expect(row(page, 'shortcut-talk')).toContainText('Changed');
    await settings(page).getByRole('button', { name: 'Reset all shortcuts' }).click();
    const question = page.getByRole('alertdialog', { name: 'Reset all shortcuts?' });
    await expect(question.getByRole('button', { name: 'Keep my keys' })).toBeFocused();
    await question.getByRole('button', { name: 'Reset all' }).click();
    await expect(row(page, 'shortcut-talk')).not.toContainText('Changed');
    await expect(settings(page).getByRole('button', { name: 'Change Talk, T' })).toBeVisible();
    await expect(settings(page).getByRole('button', { name: 'Reset all shortcuts' })).toHaveCount(
      0,
    );
  });
});

test.describe('Settings › Vision, Privacy, About', () => {
  test('turns the camera preview’s mirror off, and lists the camera shared', async ({ page }) => {
    await live(page);
    await page.locator('.va-chip').click();
    await page
      .getByRole('menu', { name: 'What Kira sees' })
      .getByRole('group', { name: 'Camera' })
      .getByRole('menuitemradio')
      .first()
      .click();
    const video = page.locator('.va-camera__video');
    await expect(video).toBeVisible();
    const transform = () => video.evaluate((element) => getComputedStyle(element).transform);
    expect(await transform()).toBe('matrix(-1, 0, 0, 1, 0, 0)');
    await openSection(page, 'Vision');
    // The camera by the name the browser gives it (each engine's fake camera has its own).
    const camera = await page.evaluate(async () => {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.find((device) => device.kind === 'videoinput')?.label ?? '';
    });
    expect(camera).not.toBe('');
    await expect(settings(page).getByRole('button', { name: /^Camera/ })).toContainText(camera);
    await settings(page).getByRole('switch', { name: 'Mirror my camera' }).click();
    expect(await transform()).toBe('none');
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
    await openSection(page, 'Vision');
    await expect(settings(page).getByRole('switch', { name: 'Mirror my camera' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  test('copies the version and the support details', async ({ page }) => {
    skipIn(page, ['firefox', 'webkit'], limits.clipboard);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await live(page);
    await openSection(page, 'About');
    await settings(page).getByRole('button', { name: 'Copy version' }).click();
    await expect(settings(page).getByRole('button', { name: 'Copied' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      'Version 0.0.0 · Conversation by Convai',
    );
    await settings(page).getByRole('button', { name: 'Copy details' }).click();
    const details = await page.evaluate(() => navigator.clipboard.readText());

    expect(details).toMatch(/^Convai Vision Assistant 0\.0\.0\r?\nBrowser: .+\r?\nCharacter: .+$/);
    // "Copied" reads as before after a moment.
    await expect(settings(page).getByRole('button', { name: 'Copy version' })).toBeVisible();
  });

  test('pushes How to use with the person’s keys, and the licenses with each text', async ({
    page,
  }) => {
    await live(page);
    await openSection(page, 'Shortcuts');
    await row(page, 'shortcut-mute')
      .getByRole('button', { name: 'Change Mute microphone, M' })
      .click();
    await page.keyboard.press('k');
    await section(page, 'About').click();
    await settings(page).getByRole('button', { name: 'How to use' }).click();
    await expect(title(page)).toHaveText('How to use');
    await expect(row(page, 'step-3')).toContainText('K/');
    await expect(settings(page).getByRole('button', { name: 'Back to About' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(title(page)).toHaveText('About');
    await settings(page).getByRole('button', { name: 'Keyboard shortcuts' }).click();
    await expect(title(page)).toHaveText('Shortcuts');
    await section(page, 'About').click();
    await settings(page).getByRole('button', { name: 'Open-source licenses' }).click();
    await expect(title(page)).toHaveText('Open-source licenses');
    await expect(
      settings(page).getByRole('button', { name: /^@convai\/web-sdk Apache-2\.0/ }),
    ).toBeVisible();
    await expect(
      settings(page).getByRole('button', { name: /^livekit-client Apache-2\.0/ }),
    ).toBeVisible();
    await settings(page)
      .getByRole('button', { name: /^Inter SIL OFL 1\.1/ })
      .click();
    await expect(title(page)).toHaveText('Inter');
    await expect(settings(page).locator('.va-settings__license')).toContainText(
      'SIL Open Font License, Version 1.1',
    );
    await page.keyboard.press('Escape');
    await expect(title(page)).toHaveText('Open-source licenses');
    await expect(settings(page).getByRole('button', { name: /^Inter SIL OFL 1\.1/ })).toBeFocused();
    // A package with no license file says so, with its license.
    await settings(page)
      .getByRole('button', { name: /^@bufbuild\/protobuf/ })
      .click();
    await expect(settings(page).locator('.va-settings__license')).toContainText(
      'This package ships no license file. It is published under Apache-2.0 AND BSD-3-Clause.',
    );
  });

  test('shows the welcome again over the conversation and keeps everything as it was', async ({
    page,
  }) => {
    skipIn(page, ['webkit'], limits.noPip);
    await live(page);
    const before = await fakeRecord(page);
    await openSection(page, 'About');
    await settings(page).getByRole('button', { name: 'Show', exact: true }).click();
    await expect(settings(page)).toBeHidden();
    const welcome = page.locator('dialog.va-first-run-replay');
    await expect(welcome.getByRole('heading', { level: 1 })).toHaveText('Show Kira what you see');
    // The window's keys wait under it.
    expect(await hold(page, 't')).toBe('ready');
    await welcome.getByRole('button', { name: 'Get started' }).click();
    await expect(welcome.getByRole('heading', { level: 1 })).toHaveText(
      'Step 1 of 2, How do you want to talk?',
    );
    await welcome.getByRole('radio', { name: /Hands free/ }).click();
    await welcome.getByRole('button', { name: 'Continue with Hands free' }).click();

    await expect(welcome.getByRole('heading', { level: 1 })).toHaveText(
      'Step 2 of 2, Where should Kira stay?',
    );
    await expect(welcome.getByRole('radio', { name: /Full window/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await welcome.getByRole('button', { name: 'Done' }).click();
    await expect(welcome).toBeHidden();
    await expect(gear(page)).toBeFocused();
    await expect(capsule(page)).toContainText('Hold T to talk');
    const after = await fakeRecord(page);
    expect(after.connects).toBe(before.connects);
    expect(
      await page.evaluate(() => [
        localStorage.getItem('va.first-run-done'),
        localStorage.getItem('va.talk-mode'),
      ]),
    ).toEqual(['1', null]);
    // Esc closes it from any step.
    await openSection(page, 'About');
    await settings(page).getByRole('button', { name: 'Show', exact: true }).click();
    await expect(welcome).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(welcome).toBeHidden();
  });

  test('moves to Compact from the welcome shown again, in Done’s press, and keeps nothing', async ({
    page,
  }) => {
    skipIn(page, ['webkit'], limits.noPip);
    await live(page);
    await letFloatingWindowLoad(page);
    await openSection(page, 'About');
    await settings(page).getByRole('button', { name: 'Show', exact: true }).click();
    const welcome = page.locator('dialog.va-first-run-replay');
    await welcome.getByRole('button', { name: 'Get started' }).click();
    await welcome.getByRole('button', { name: /^Continue with/ }).click();
    await welcome.getByRole('radio', { name: /Compact/ }).click();
    await page.waitForFunction(() =>
      document
        .getAnimations()
        .every(
          (one) => one.effect?.getTiming().iterations === Infinity || one.playState !== 'running',
        ),
    );
    const axe = await new AxeBuilder({ page }).include('dialog.va-first-run-replay').analyze();
    expect(axe.violations).toEqual([]);
    const pip = await floatingWindowFrom(page, () =>
      welcome.getByRole('button', { name: 'Done' }).click(),
    );
    await expect(welcome).toBeHidden();
    await expect(pip.locator('.convai-capsule')).toHaveAttribute('data-state', 'ready');
    await expect(page.getByRole('button', { name: 'Bring Kira back' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('va.window-mode'))).toBeNull();
    // Shown again while Kira floats, the step starts at Compact; Full window brings Kira back.
    await openSection(page, 'About');
    await settings(page).getByRole('button', { name: 'Show', exact: true }).click();
    await welcome.getByRole('button', { name: 'Get started' }).click();
    await welcome.getByRole('button', { name: /^Continue with/ }).click();
    await expect(welcome.getByRole('radio', { name: /Compact/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await welcome.getByRole('radio', { name: /Full window/ }).click();
    const closed = pip.waitForEvent('close');
    await welcome.getByRole('button', { name: 'Done' }).click();
    await closed;
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
  });

  test('says in Window whether Compact works in this browser (S1)', async ({ page }) => {
    skipIn(page, ['webkit'], limits.noPip);
    await live(page);
    await openSection(page, 'Window');
    const compact = row(page, 'compact');
    await expect(compact).toContainText('Compact on the web');
    await expect(compact).toContainText(
      'Uses this browser’s Picture-in-Picture window. Switch with Window mode at the top.',
    );
    await expect(compact.locator('.va-settings__value')).toHaveText('Supported');
    await expect(compact.getByRole('button')).toHaveCount(0);
    // Under "Vision Assistant", before Vision.
    const tabs = settings(page).getByRole('tab');
    const names = await tabs.allTextContents();
    expect(names.indexOf('Window')).toBe(names.indexOf('Vision') - 1);
    const result = await new AxeBuilder({ page }).include('dialog.va-settings').analyze();
    expect(result.violations).toEqual([]);
  });

  test('says where Compact is where the browser has no floating window (S1)', async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as unknown as { documentPictureInPicture?: unknown }).documentPictureInPicture;
    });
    await live(page);
    await openSection(page, 'Window');
    const compact = row(page, 'compact');
    await expect(compact.locator('.va-settings__value')).toHaveText('Not in this browser');
    await expect(compact).toContainText(
      'Kira stays in this tab because this browser does not support floating windows. Try a desktop browser with Document Picture-in-Picture support.',
    );
    // Found by its words.
    // Key by key: Playwright's fill of a search field sets a value React misses in WebKit.
    await settings(page).getByRole('searchbox').pressSequentially('picture');
    await expect(settings(page)).toContainText('Compact on the web');
    // With one mode there is no choice: the welcome shown again ends at How to talk.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await section(page, 'About').click();
    await settings(page).getByRole('button', { name: 'Show', exact: true }).click();
    const welcome = page.locator('dialog.va-first-run-replay');
    await welcome.getByRole('button', { name: 'Get started' }).click();
    await expect(welcome.getByRole('heading', { level: 1 })).toHaveText('How do you want to talk?');
    await expect(welcome.getByRole('button', { name: 'Done' })).toBeVisible();
  });

  test('passes axe on Shortcuts while recording and asking, Vision, Privacy, About and its pages', async ({
    page,
  }) => {
    await live(page);
    const axe = async (name: string) => {
      const result = await new AxeBuilder({ page }).include('dialog.va-settings').analyze();
      expect(result.violations, name).toEqual([]);
    };
    await openSection(page, 'Shortcuts');
    await axe('Shortcuts');
    // The sidebar's "Vision Assistant" label is drawing only: the tab list holds its tabs alone.
    const tabs = await settings(page).getByRole('tablist', { name: 'Sections' }).ariaSnapshot();
    expect(tabs).not.toContain('Vision Assistant');
    expect(tabs.split('\n').filter((line) => line.trim().startsWith('- tab '))).toHaveLength(8);
    await row(page, 'shortcut-talk').getByRole('button', { name: 'Change Talk, T' }).click();
    await axe('recording');
    await page.keyboard.press('m');
    await axe('conflict');
    await page.keyboard.press('Escape');
    for (const name of ['Vision', 'Privacy', 'About']) {
      await section(page, name).click();
      await expect(title(page)).toHaveText(name);
      await axe(name);
    }
    await settings(page).getByRole('button', { name: 'How to use' }).click();
    await axe('How to use');
    await page.keyboard.press('Escape');
    await settings(page).getByRole('button', { name: 'Open-source licenses' }).click();
    await expect(settings(page).getByRole('button', { name: /^react MIT/ })).toBeVisible();
    await axe('licenses');
    await settings(page)
      .getByRole('button', { name: /^react MIT/ })
      .click();
    await axe('license');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(settings(page)).toBeHidden();
    await openSection(page, 'About');
    await settings(page).getByRole('button', { name: 'Show', exact: true }).click();
    const welcome = page.locator('dialog.va-first-run-replay');
    await expect(welcome).toBeVisible();
    await page.waitForFunction(() =>
      document
        .getAnimations()
        .every(
          (one) => one.effect?.getTiming().iterations === Infinity || one.playState !== 'running',
        ),
    );
    const replay = await new AxeBuilder({ page }).include('dialog.va-first-run-replay').analyze();
    expect(replay.violations).toEqual([]);
  });
});
