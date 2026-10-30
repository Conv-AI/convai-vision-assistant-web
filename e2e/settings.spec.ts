import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { answer, fakeRecord, openApp } from './fakeConvai';
import { fakePicker } from './fakeDisplay';
import { launchOptions } from './launch';
import { limits, skipIn } from './engines';

test.use({ launchOptions: launchOptions({ tabTitle: 'Vision Assistant e2e settings fixture' }) });

const capsule = (page: Page) => page.locator('.convai-capsule');
const gear = (page: Page) => page.getByRole('button', { name: 'Settings' });
const settings = (page: Page) => page.locator('dialog.va-settings');
const title = (page: Page) => settings(page).getByRole('heading', { level: 2 });
const section = (page: Page, name: string) => settings(page).getByRole('tab', { name });
const search = (page: Page) => settings(page).getByRole('searchbox', { name: 'Search settings' });
const textScale = (page: Page) =>
  page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--convai-text-scale').trim(),
  );

async function live(page: Page, width = 1280, height = 800) {
  await page.setViewportSize({ width, height });
  await openApp(page);
  await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
}

async function ask(page: Page, question: string) {
  await page.keyboard.press('/');
  await page.keyboard.type(question);
  await page.keyboard.press('Enter');
}

async function openSettings(page: Page) {
  await gear(page).click();
  await expect(settings(page)).toBeVisible();
}

test.describe('Settings', () => {
  test('opens from the gear and Ctrl ,, closes with Esc, and gives the focus back', async ({
    page,
  }) => {
    await live(page);
    await openSettings(page);
    await expect(title(page)).toHaveText('Talking');
    await expect(section(page, 'Talking')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(settings(page)).toBeHidden();
    await expect(gear(page)).toBeFocused();

    await page.keyboard.press('Control+Comma');
    await expect(settings(page)).toBeVisible();
    // The window's letters wait while Settings is open.
    await page.keyboard.press('m');
    await expect(capsule(page)).not.toHaveAttribute('data-state', 'muted');
    await page.keyboard.press('Control+Comma');
    await expect(settings(page)).toBeHidden();
  });

  test('changes how you talk at once, and the next visit starts the same way', async ({ page }) => {
    await live(page);
    await expect(capsule(page)).toContainText('Hold T to talk');
    await openSettings(page);
    await settings(page).getByRole('radio', { name: 'Hands free' }).click();
    await expect(settings(page).getByText('Push to talk key')).toBeHidden();
    await page.keyboard.press('Escape');
    // Hands free listens at once: the microphone opens with no key held.
    await expect.poll(async () => (await fakeRecord(page)).microphone.at(-1)).toBe(true);
    await expect(capsule(page)).not.toContainText('Hold T to talk');
    await page.reload();
    await expect(capsule(page)).toHaveAttribute('data-state', /ready|listening/);
    await expect(capsule(page)).not.toContainText('Hold T to talk');
    expect(await page.evaluate(() => localStorage.getItem('va.talk-mode'))).toBe('hands-free');
  });

  test('turns captions off from anywhere on their row', async ({ page }) => {
    await live(page, 1280, 800);
    const shown = page.locator('.va-captions');
    // Closed panel: the stage carries the captions while the character speaks.
    await page.keyboard.press('r');
    await ask(page, 'What is this?');
    let reply = answer(page, 'A ceramic mug.');
    await expect(capsule(page)).toHaveAttribute('data-state', 'speaking');
    await expect(shown).toContainText('A ceramic mug.');
    await reply;
    await openSettings(page);
    const captions = settings(page).getByRole('switch', { name: 'Captions' });
    await settings(page).getByText('On the stage when the Transcript panel is closed').click();
    await expect(captions).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Escape');
    await expect(settings(page)).toBeHidden();
    await ask(page, 'And this?');
    reply = answer(page, 'A spoon.');
    await expect(capsule(page)).toHaveAttribute('data-state', 'speaking');
    await expect(shown).toHaveCount(0);
    await reply;
    expect((await fakeRecord(page)).sent).toEqual(['What is this?', 'And this?']);
  });

  test('changes the transcript panel live from its style cards', async ({ page }) => {
    await live(page, 1440, 900);
    await openSettings(page);
    await settings(page)
      .getByRole('radio', { name: /Conversation/ })
      .click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /Conversation/ })).toBeVisible();
    await page.reload();
    await openSettings(page);
    await expect(settings(page).getByRole('radio', { name: /Conversation/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('changes the text size live, the share preview’s band with it, and keeps it', async ({
    page,
  }) => {
    skipIn(page, ['webkit'], limits.noPlayback);
    await fakePicker(page, ['browser']);
    await page.addInitScript(() => {
      window.localStorage.setItem('va.share-card-shown', '2');
    });
    await live(page, 1440, 900);
    await page.locator('.va-chip').click();
    await page
      .getByRole('menu', { name: 'What Kira sees' })
      .getByRole('menuitemradio', { name: 'Browser tab…' })
      .click();
    const frame = page.locator('.va-preview__frame');
    await expect(frame).toBeVisible();
    const before = await frame.boundingBox();
    expect(await textScale(page)).toBe('1');

    await openSettings(page);
    await section(page, 'Accessibility').click();
    const size = settings(page).getByRole('slider', { name: 'Text size' });
    await size.focus();
    await page.keyboard.press('End');
    await expect(size).toHaveAttribute('aria-valuetext', '130%');
    expect(await textScale(page)).toBe('1.3');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(settings(page)).toBeHidden();

    await expect
      .poll(async () => Math.round(((await frame.boundingBox())?.y ?? 0) - (before?.y ?? 0)))
      .toBe(8);
    await page.reload();
    expect(await textScale(page)).toBe('1.3');
  });

  test('turns high contrast and reduced motion on and off over the system’s', async ({ page }) => {
    await live(page);
    await openSettings(page);
    await section(page, 'Accessibility').click();
    const root = page.locator('html');
    await settings(page)
      .getByRole('radiogroup', { name: 'Increase contrast' })
      .getByRole('radio', { name: 'On' })
      .click();
    await expect(root).toHaveClass(/convai-high-contrast/);
    await settings(page)
      .getByRole('radiogroup', { name: 'Reduce motion' })
      .getByRole('radio', { name: 'On' })
      .click();
    await expect(root).toHaveClass(/convai-reduce-motion/);
    await page.keyboard.press('ArrowRight');
    await expect(root).not.toHaveClass(/convai-reduce-motion/);
  });

  test('reads finished answers to a screen reader only once asked to', async ({ page }) => {
    await live(page);
    const said = page.locator('[role="status"]', { hasText: 'Kira: A ceramic mug.' });
    await page.keyboard.press('/');
    await page.keyboard.type('What is this?');
    await page.keyboard.press('Enter');
    await answer(page, 'A ceramic mug.');
    await page.waitForTimeout(800);
    await expect(said).toHaveCount(0);
    await openSettings(page);
    await section(page, 'Accessibility').click();
    await settings(page)
      .getByRole('switch', { name: /Read Kira’s answers/ })
      .click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('/');
    await page.keyboard.type('What is this?');
    await page.keyboard.press('Enter');
    await answer(page, 'A ceramic mug.');
    await expect(said).toHaveCount(1);
  });

  test('chooses a microphone the browser lists, and the conversation moves to it', async ({
    page,
  }) => {
    skipIn(page, ['firefox'], limits.oneMicrophone);
    skipIn(page, ['webkit'], limits.noMicrophone);
    await live(page);
    await openSettings(page);
    await section(page, 'Audio').click();
    const field = settings(page).getByRole('button', { name: /^Input device/ });
    await expect(field).toContainText('Default');
    await field.click();
    const options = settings(page).getByRole('option');
    expect(await options.count()).toBeGreaterThan(1);
    const second = options.nth(1);
    const name = (await second.textContent()) ?? '';
    await second.click();
    await expect(field).toContainText(name);
    const record = await fakeRecord(page);
    expect(record.devices).toHaveLength(1);
    expect(record.devices[0]).not.toBeNull();
    await page.reload();
    await expect.poll(async () => (await fakeRecord(page)).devices).toEqual(record.devices);
  });

  test('records three seconds and plays them back on Test', async ({ page }) => {
    skipIn(page, ['webkit'], limits.noMicrophone);
    skipIn(page, ['firefox'], limits.testPlayback);
    await live(page);
    await openSettings(page);
    await section(page, 'Audio').click();
    await settings(page).getByRole('button', { name: 'Test' }).click();
    await expect(settings(page).getByRole('button', { name: /Recording · \d/ })).toBeVisible();
    await expect(settings(page).getByRole('button', { name: 'Playing back' })).toBeVisible({
      timeout: 6000,
    });
    await expect(settings(page).getByRole('button', { name: 'Test' })).toBeVisible({
      timeout: 8000,
    });
  });

  test('sets the voice’s volume', async ({ page }) => {
    await live(page);
    await openSettings(page);
    await section(page, 'Audio').click();
    const volume = settings(page).getByRole('slider', { name: 'Kira’s volume' });
    await volume.focus();
    await page.keyboard.press('Shift+ArrowLeft');
    await expect(volume).toHaveAttribute('aria-valuetext', '50%');
    await expect.poll(async () => (await fakeRecord(page)).volume).toBe(0.5);
  });

  test('clears the conversation after asking, and Keep it keeps it', async ({ page }) => {
    await live(page, 1440, 900);
    await page.keyboard.press('/');
    await page.keyboard.type('What is this?');
    await page.keyboard.press('Enter');
    await answer(page, 'A ceramic mug.');
    const turns = page.locator('.va-transcript__list').getByText('What is this?');
    await expect(turns).toBeVisible();
    await openSettings(page);
    await settings(page).getByRole('button', { name: 'Clear' }).click();
    const ask = page.getByRole('alertdialog', { name: 'Clear this conversation?' });
    await expect(ask.getByRole('button', { name: 'Keep it' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(ask).toBeHidden();
    await expect(settings(page)).toBeVisible();
    await settings(page).getByRole('button', { name: 'Clear' }).click();
    await ask.getByRole('button', { name: 'Clear' }).click();
    await page.keyboard.press('Escape');
    await expect(turns).toHaveCount(0);
  });

  test('searches every section, shows a row in its section, and says when nothing matches', async ({
    page,
  }) => {
    await live(page);
    await openSettings(page);
    await page.keyboard.press('Control+f');
    await expect(search(page)).toBeFocused();
    await page.keyboard.type('mic');
    await expect(title(page)).toHaveText('Results for “mic”');
    await expect(settings(page).getByText('Audio › Microphone')).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: '5 settings found for mic' }),
    ).toHaveCount(1);
    await settings(page).getByRole('button', { name: 'Show in Audio' }).click();
    await expect(title(page)).toHaveText('Audio');
    await expect(settings(page).locator('[data-row="input-device"]')).toHaveAttribute('data-lit');
    await expect(settings(page).getByRole('button', { name: /^Input device/ })).toBeFocused();

    await search(page).click();
    await page.keyboard.type('lighting');
    await expect(settings(page).getByText('No settings match “lighting”')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(search(page)).toHaveValue('');
    await expect(title(page)).toHaveText('Audio');
    await page.keyboard.press('Escape');
    await expect(section(page, 'Audio')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(settings(page)).toBeHidden();
  });

  test('opens the picker over Settings from Change, and Esc closes the picker first', async ({
    page,
  }) => {
    await live(page);
    await openSettings(page);
    await settings(page).getByRole('button', { name: 'Change', exact: true }).click();
    await expect(page.locator('dialog.va-picker')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog.va-picker')).toBeHidden();
    await expect(settings(page)).toBeVisible();
    await expect(settings(page).getByRole('button', { name: 'Change', exact: true })).toBeFocused();
  });

  test('turns its sidebar into a select under 720 wide', async ({ page }) => {
    await live(page, 640, 720);
    await openSettings(page);
    await expect(settings(page).getByRole('tab')).toHaveCount(0);
    await settings(page)
      .getByRole('button', { name: /^Sections/ })
      .click();
    await settings(page).getByRole('option', { name: 'Audio' }).click();
    await expect(title(page)).toHaveText('Audio');
    const box = await settings(page).boundingBox();
    expect(box?.width).toBe(640 - 32);
  });

  test('passes axe on each section, the results and the narrow form', async ({ page }) => {
    await live(page);
    await openSettings(page);
    for (const name of ['Talking', 'Audio', 'Accessibility']) {
      await section(page, name).click();
      await expect(title(page)).toHaveText(name);
      const result = await new AxeBuilder({ page }).include('dialog.va-settings').analyze();
      expect(result.violations, name).toEqual([]);
    }
    // Key by key: Playwright's fill of a search field sets a value React misses in WebKit.
    await search(page).pressSequentially('caption');
    await expect(title(page)).toHaveText('Results for “caption”');
    const results = await new AxeBuilder({ page }).include('dialog.va-settings').analyze();
    expect(results.violations).toEqual([]);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 600, height: 700 });
    await openSettings(page);
    const narrow = await new AxeBuilder({ page }).include('dialog.va-settings').analyze();
    expect(narrow.violations).toEqual([]);
  });
});
