import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { fakeAccess } from './fakeAccess';
import { fakePicker } from './fakeDisplay';
import { answer, openApp, type ApiCharacter, type FakeOptions } from './fakeConvai';
import { recordSpeech, saidTexts } from './speech';
import { storedTextSize } from './textSize';
import { limits, skipIn } from './engines';

const capsule = (page: Page) => page.locator('.convai-capsule');
const tooltip = (page: Page) => page.locator('.convai-tooltip');
const quick = (page: Page) => page.getByRole('dialog', { name: 'Quick controls' });
const three: ApiCharacter[] = [
  { id: 'kira-1', name: 'Kira', languages: ['en-US'] },
  { id: 'elena-2', name: 'Elena', languages: ['es-ES'] },
  { id: 'marcus-3', name: 'Marcus', languages: ['de-DE'] },
];

async function live(
  page: Page,
  options: FakeOptions = {},
  characters?: ApiCharacter[],
  size = { width: 1280, height: 860 },
) {
  await page.setViewportSize(size);
  await openApp(page, options, characters);
  await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
}

/** Lets a change settle: an announcement follows a state that held for half a second. */
const settle = (page: Page) => page.waitForTimeout(900);

async function axeClean(page: Page) {
  // Anything fading in is measured once it stands.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity),
  );
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}

test.describe('what a screen reader is told', () => {
  test('says the character is ready once it connects, and not again when the Type field closes', async ({
    page,
  }) => {
    await recordSpeech(page);
    await openApp(page, { connect: 'hold' });
    await page.waitForTimeout(600);
    await page.evaluate(() => window.fakeConvai?.accept());
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
    await settle(page);
    expect(await saidTexts(page)).toEqual(['Kira, ready. Hold T to talk.']);

    await page.keyboard.press('/');
    await expect(page.getByRole('textbox', { name: 'Message Kira' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(capsule(page)).toBeVisible();
    await settle(page);
    expect(await saidTexts(page)).toEqual([]);
  });

  test('says Kira thinks and speaks while the Type field stands in the capsule’s place', async ({
    page,
  }) => {
    await recordSpeech(page);
    await live(page);
    await settle(page);
    await saidTexts(page);
    await page.keyboard.press('/');
    await page.keyboard.type('What is this?');
    await page.keyboard.press('Enter');
    await page.keyboard.press('/');
    await answer(page, 'A ceramic mug on a wooden desk, with a little steam above it.');
    await settle(page);
    expect(await saidTexts(page)).toContain('Kira, speaking');
  });

  test('going offline and back is said once each, by the Island', async ({ page, context }) => {
    await recordSpeech(page);
    await live(page);
    await settle(page);
    await saidTexts(page);

    await context.setOffline(true);
    await expect(capsule(page)).toHaveAttribute('data-state', 'offline', { timeout: 6000 });
    await settle(page);
    expect(await saidTexts(page)).toEqual(['You’re offline. You can keep working.']);

    await context.setOffline(false);
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready', { timeout: 6000 });
    // Back online stays 2 s; the capsule's ready must not follow it then, nor once it goes.
    await page.waitForTimeout(3500);
    expect(await saidTexts(page)).toEqual(['Back online']);
  });

  test('a switch is said by its stage (L5), not by a hidden capsule', async ({ page }) => {
    await recordSpeech(page);
    await live(page, { later: 'hold' }, [
      { id: 'kira-1', name: 'Kira' },
      { id: 'marcus-3', name: 'Marcus', languages: ['de-DE'] },
    ]);
    await settle(page);
    await saidTexts(page);
    await page.locator('.va-bar__character').click();
    const picker = page.locator('dialog.va-picker');
    await picker.locator('.va-card', { has: page.getByText('Marcus', { exact: true }) }).click();
    await picker.getByRole('button', { name: 'Talk to Marcus' }).click();
    await expect(page.locator('.va-launch--switching')).toBeVisible();
    // Past the 1.5 s after which a connect is said.
    await page.waitForTimeout(2500);
    const texts = await saidTexts(page);
    expect(texts.filter((text) => /Connecting|connecting/.test(text))).toEqual([]);
  });

  test('a blocked microphone is said once, by the Island', async ({ page }) => {
    await recordSpeech(page);
    await live(page, { microphone: 'blocked' });
    await settle(page);
    await saidTexts(page);
    await page.keyboard.down('t');
    await page.waitForTimeout(300);
    await page.keyboard.up('t');
    await expect(page.locator('.va-stage__island')).toContainText('The microphone is blocked');
    await settle(page);
    const texts = await saidTexts(page);
    expect(texts.filter((text) => /microphone/i.test(text))).toEqual([
      'The microphone is blocked. Allow the microphone in this site’s settings, then try again. You can type to Kira until then.',
    ]);
  });

  test('the first run’s demo turn says nothing while nobody talks', async ({ page }) => {
    await recordSpeech(page);
    await fakeAccess(page, {});
    await openApp(page, { firstRun: true });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // The Welcome turn loops through ready, listening and thinking in about three seconds.
    await page.waitForTimeout(3500);
    expect((await saidTexts(page)).filter((text) => text.startsWith('Kira,'))).toEqual([]);
  });
});

test.describe('tooltips and Esc', () => {
  test('a focus given back by Esc shows no tooltip, so the next Esc is not lost', async ({
    page,
  }) => {
    await live(page, {}, three);

    await page.keyboard.press('q');
    await expect(quick(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Quick controls' })).toBeFocused();
    await page.waitForTimeout(700);
    await expect(tooltip(page)).toHaveCount(0);

    await page.keyboard.press('Control+,');
    await expect(page.locator('dialog.va-settings')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Settings' })).toBeFocused();
    await page.waitForTimeout(700);
    await expect(tooltip(page)).toHaveCount(0);

    // One Esc closes the picker: its Close shows no tooltip as it opens.
    await page.keyboard.press('Control+k');
    await expect(page.locator('dialog.va-picker')).toBeVisible();
    await page.waitForTimeout(300);
    await expect(tooltip(page)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog.va-picker')).toBeHidden();
    await expect(tooltip(page)).toHaveCount(0);
  });

  test('Tab still shows a control’s name at once', async ({ page }) => {
    await live(page);
    await page.getByRole('button', { name: 'Compact', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Settings' })).toBeFocused();
    await expect(tooltip(page)).toHaveText(/Settings/);
  });
});

test.describe('Quick controls by keyboard', () => {
  test('the tiles are one Tab stop between Change and All settings', async ({ page }) => {
    await live(page);
    await page.keyboard.press('q');
    const hands = quick(page).getByRole('button', { name: /^Hands free/ });
    await expect(hands).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(quick(page).getByRole('button', { name: /^Captions/ })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(quick(page).getByRole('button', { name: 'All settings' })).toBeFocused();
    // Back into the tiles lands on the one last focused, then on to Change.
    await page.keyboard.press('Shift+Tab');
    await expect(quick(page).getByRole('button', { name: /^Captions/ })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(quick(page).getByRole('button', { name: 'Change' })).toBeFocused();
  });

  test('Tab past its last control closes it, and the focus stays where it went', async ({
    page,
  }) => {
    await live(page);
    await page.keyboard.press('q');
    await page.keyboard.press('Tab');
    await expect(quick(page).getByRole('button', { name: 'All settings' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(quick(page)).toBeHidden();
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(focused).toBe('BUTTON');
  });
});

test.describe('axe in the states no other spec checks', () => {
  test('connecting, then held, then the Type field', async ({ page }) => {
    await page.setViewportSize({ width: 760, height: 720 });
    await openApp(page, { connect: 'hold' });
    await expect(page.getByText('Connecting to Kira…')).toBeVisible({ timeout: 3000 });
    await axeClean(page);
    await page.evaluate(() => window.fakeConvai?.accept());
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
    await page.keyboard.down('t');
    await expect(capsule(page)).toHaveAttribute('data-state', 'held');
    await axeClean(page);
    await page.keyboard.up('t');
    await page.keyboard.press('/');
    await axeClean(page);
  });

  test('no character, and unavailable', async ({ page }) => {
    await openApp(page, {}, []);
    await expect(capsule(page)).toHaveAttribute('data-state', 'no-character');
    await axeClean(page);
    await openApp(page, { connect: 'refuse-service' });
    await expect(page.getByRole('alert').first()).toBeVisible();
    await axeClean(page);
  });

  test('offline and back, with captions on the stage', async ({ page, context }) => {
    await live(page, {}, undefined, { width: 760, height: 720 });
    await page.keyboard.press('/');
    await page.keyboard.type('What is this?');
    await page.keyboard.press('Enter');
    await answer(page, 'A ceramic mug.');
    await expect(page.locator('.va-captions')).toContainText('A ceramic mug.');
    await axeClean(page);
    await context.setOffline(true);
    await expect(capsule(page)).toHaveAttribute('data-state', 'offline', { timeout: 6000 });
    await axeClean(page);
    await context.setOffline(false);
    await expect(page.locator('.va-stage__island')).toContainText('Back online', {
      timeout: 6000,
    });
    await axeClean(page);
  });

  test('a live camera, Quick controls’ Text size page, and the Compact card', async ({ page }) => {
    await fakePicker(page, ['browser']);
    await page.addInitScript(() => {
      delete (window as { documentPictureInPicture?: unknown }).documentPictureInPicture;
    });
    await live(page);
    await page.locator('.va-chip').click();
    await page
      .getByRole('menu', { name: 'What Kira sees' })
      .getByRole('group', { name: 'Camera' })
      .getByRole('menuitemradio')
      .first()
      .click();
    await expect(page.locator('.va-chip__slot')).toHaveAttribute('data-mark', 'live');
    await axeClean(page);
    await page.keyboard.press('q');
    await quick(page)
      .getByRole('button', { name: /^Text size/ })
      .click();
    await expect(quick(page).getByRole('slider')).toBeFocused();
    await axeClean(page);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Compact', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Got it' })).toBeFocused();
    await axeClean(page);
  });

  for (const [label, stored] of [
    ['with Increase contrast on', { highContrast: 'on' }],
    ['at text size 130 %', null],
  ] as const) {
    test(`the session, Quick controls, Settings and the picker ${label}`, async ({ page }) => {
      if (stored) {
        await page.addInitScript((value) => {
          window.localStorage.setItem('va.preferences', JSON.stringify(value));
        }, stored);
      } else await storedTextSize(page, 1.3);
      await live(page, {}, three);
      await axeClean(page);
      await page.keyboard.press('q');
      await axeClean(page);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+,');
      await axeClean(page);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+k');
      await axeClean(page);
    });
  }
});

/** Relative luminance of each pixel of a PNG, read in the page. */
async function luminances(page: Page, png: Buffer): Promise<number[]> {
  return page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(
      await (await fetch(`data:image/png;base64,${data}`)).blob(),
    );
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No 2d context.');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const linear = (c: number) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const out: number[] = [];
    for (let i = 0; i < pixels.length; i += 4)
      out.push(
        0.2126 * linear(pixels[i] ?? 0) +
          0.7152 * linear(pixels[i + 1] ?? 0) +
          0.0722 * linear(pixels[i + 2] ?? 0),
      );
    return out;
  }, png.toString('base64'));
}

const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * How a control's words stand on its fill: the share of the words' box that is the fill (a plate
 * behind the words leaves almost none), and the strongest contrast of a pixel there against it.
 */
async function wordsOnFill(page: Page, control: Locator, words: Locator) {
  // Measured once the panel or dialog has grown in and every hover or press colour has settled.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity),
  );
  await page.mouse.move(0, 0);
  // The fill, 4 px in from the control's right edge, halfway down: no words or icon stand there.
  const box = await control.boundingBox();
  if (!box) throw new Error('The control is not drawn.');
  const [fill = 0] = await luminances(
    page,
    await page.screenshot({
      clip: { x: box.x + box.width - 5, y: box.y + box.height / 2, width: 1, height: 1 },
    }),
  );
  const clip = await words.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const r = range.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const pixels = await luminances(page, await page.screenshot({ clip }));
  const onFill = pixels.filter((l) => contrast(l, fill) < 1.2).length / pixels.length;
  return { onFill, best: Math.max(...pixels.map((l) => contrast(l, fill))) };
}

/** How many pixels of `area` change visibly (3:1 or more) when `part` is hidden: what it draws. */
async function drawnPixels(page: Page, area: Locator, part: Locator): Promise<number> {
  const shown = await luminances(page, await area.screenshot());
  await part.evaluate((element) => {
    (element as HTMLElement).style.visibility = 'hidden';
  });
  const hidden = await luminances(page, await area.screenshot());
  await part.evaluate((element) => {
    (element as HTMLElement).style.visibility = '';
  });
  return shown.filter((l, i) => contrast(l, hidden[i] ?? l) >= 3).length;
}

test.describe('forced colors', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active', colorScheme: 'dark' });
  });

  test('a tile that is on, and a chosen segment, keep their words readable', async ({ page }) => {
    skipIn(page, ['firefox', 'webkit'], limits.forcedColors);
    await live(page);
    await page.keyboard.press('q');
    const captions = quick(page).getByRole('button', { name: /^Captions/ });
    await expect(captions).toHaveAttribute('aria-pressed', 'true');
    // Off the tile's focus ring, which would draw over its edge.
    await page.keyboard.press('ArrowDown');
    const tile = await wordsOnFill(page, captions, captions.locator('.va-quick__label'));
    expect(tile.onFill).toBeGreaterThan(0.5);
    expect(tile.best).toBeGreaterThan(4.5);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+,');
    const chosen = page.getByRole('radio', { name: 'Push to talk' });
    await expect(chosen).toHaveAttribute('aria-checked', 'true');
    const segment = await wordsOnFill(page, chosen, chosen);
    expect(segment.onFill).toBeGreaterThan(0.5);
    expect(segment.best).toBeGreaterThan(4.5);
  });

  test('a switch that is off and a slider show their knobs', async ({ page }) => {
    await live(page);
    await page.keyboard.press('Control+,');
    await page.getByRole('tab', { name: 'Accessibility' }).click();
    const off = page.getByRole('switch', { name: /Stronger caption backing/ });
    await expect(off).toHaveAttribute('aria-checked', 'false');
    // A 16 px round knob: well over 100 of its pixels stand out from the track.
    expect(await drawnPixels(page, off, off.locator('.convai-switch__knob'))).toBeGreaterThan(100);
    const slider = page.getByRole('slider', { name: 'Text size' });
    expect(await drawnPixels(page, slider, slider.locator('.convai-slider__knob'))).toBeGreaterThan(
      100,
    );
  });

  test('menus and dialogs keep an edge', async ({ page }) => {
    await fakePicker(page, ['browser']);
    await live(page, {}, three);
    const edge = (element: Locator) =>
      element.evaluate((e) => {
        const style = getComputedStyle(e);
        // A border, or an outline drawn inside that takes no room (the source menu).
        return (
          (style.borderTopStyle === 'solid' && Number.parseFloat(style.borderTopWidth) >= 1) ||
          (style.outlineStyle === 'solid' && Number.parseFloat(style.outlineWidth) >= 1)
        );
      });
    await page.locator('.va-chip').click();
    expect(await edge(page.locator('.va-source-menu'))).toBe(true);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Transcript style/ }).click();
    expect(await edge(page.locator('.va-menu'))).toBe(true);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+k');
    expect(await edge(page.locator('dialog.va-picker'))).toBe(true);
    expect(await edge(page.locator('.va-card').first())).toBe(true);
    await page.keyboard.press('Escape');
    await page.locator('.va-chip').click();
    await page.getByRole('menuitemradio', { name: 'Browser tab…' }).click();
    expect(await edge(page.locator('dialog.convai-dialog'))).toBe(true);
  });

  test('a control drawn as is rings its focus in the system highlight, on a light theme too', async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: 'active', colorScheme: 'light' });
    await live(page);
    const highlight = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'Highlight';
      document.body.append(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    });
    await page.keyboard.press('q');
    const captions = quick(page).getByRole('button', { name: /^Captions/ });
    await page.keyboard.press('ArrowRight');
    await expect(captions).toBeFocused();
    await expect(captions).toHaveAttribute('aria-pressed', 'true');
    expect(await captions.evaluate((e) => getComputedStyle(e).outlineColor)).toBe(highlight);
  });

  test('a focus drawn as a shadow becomes an outline', async ({ page }) => {
    await live(page);
    const outlined = (element: Locator) =>
      element.evaluate((e) => getComputedStyle(e).outlineStyle !== 'none');
    await page.keyboard.press('/');
    expect(await outlined(page.locator('.va-composer'))).toBe(true);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+,');
    await page.getByRole('searchbox', { name: 'Search settings' }).focus();
    expect(await outlined(page.locator('.va-settings__search'))).toBe(true);
    await page.getByRole('tab', { name: 'Talking' }).click();
    const key = page.locator('.va-settings__row--link, .va-settings__hit').first();
    await key.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    expect(await outlined(key)).toBe(true);
  });
});
