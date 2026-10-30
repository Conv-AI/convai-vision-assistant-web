import { expect, test, type Locator, type Page } from '@playwright/test';
import { emit, openApp, type FakeOptions } from './fakeConvai';
import { recordSpeech, saidTexts } from './speech';
import { storedTextSize } from './textSize';

const capsule = (page: Page) => page.locator('.va-stage .convai-capsule');
const lens = (page: Page) => page.locator('.va-stage .convai-capsule__lens');
const tip = (page: Page) => page.locator('.convai-tip');
/** The bubble of one tip, by the coach's id. */
const shown = (page: Page, id: string) => page.locator(`.va-tip[data-tip="${id}"] .convai-tip`);
const halo = (page: Page) => page.locator('.convai-tip-halo');
const chip = (page: Page) => page.locator('.va-chip');
const menu = (page: Page) => page.getByRole('menu', { name: 'What Kira sees' });

async function live(page: Page, options: FakeOptions = {}, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await openApp(page, { tips: true, ...options });
  await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
}

async function shareCamera(page: Page) {
  await chip(page).click();
  await menu(page)
    .getByRole('group', { name: 'Camera' })
    .getByRole('menuitemradio')
    .first()
    .click();
  await expect(chip(page).locator('.va-chip__slot')).toHaveAttribute('data-mark', 'live');
  await page.mouse.move(2, 2);
}

/** Holds the talk key long enough to talk (the hold starts after 150 ms). */
async function talk(page: Page) {
  await page.keyboard.down('t');
  await expect(capsule(page)).toHaveAttribute('data-state', 'held');
  await page.waitForTimeout(200);
  await page.keyboard.up('t');
  await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
}

let replies = 0;

/** A typed question, taken; its answer thought, then spoken until `end` (or left speaking). */
async function askAndSpeak(page: Page, question: string, end = true) {
  await page.keyboard.press('/');
  await page.keyboard.type(question);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Message Kira' })).toHaveCount(0);
  const id = `tip-${String(++replies)}`;
  await emit(page, { type: 'activity', activity: 'thinking' });
  await emit(page, { type: 'reply', id, text: 'A ceramic mug.', streaming: false });
  await emit(page, { type: 'activity', activity: 'speaking' });
  await expect(capsule(page)).toHaveAttribute('data-state', 'speaking');
  if (end) {
    await emit(page, { type: 'activity', activity: 'idle' });
    await expect(capsule(page)).toHaveAttribute('data-state', /^(ready|muted)$/);
  }
}

async function box(locator: Locator) {
  const found = await locator.boundingBox();
  if (!found) throw new Error('not laid out');
  return found;
}

/** The tail's centre, where it points: the bubble's left, its offset and half the tail. */
async function tailCentre(page: Page) {
  const tail = await box(page.locator('.convai-tip__tail'));
  return { x: tail.x + tail.width / 2, y: tail.y + tail.height / 2 };
}

function stored(page: Page) {
  return page.evaluate(() => localStorage.getItem('va.tips'));
}

test.describe('U1 · Hold T to talk', () => {
  test('waits while the stage shows its own action, then stands over the Lens as the layout requires', async ({
    page,
  }) => {
    await recordSpeech(page);
    await live(page);

    await page.waitForTimeout(800);
    await expect(tip(page)).toHaveCount(0);
    await shareCamera(page);
    await expect(tip(page)).toBeVisible();
    await expect(page.locator('.convai-tip__title')).toHaveText('HoldTto talk');
    await expect(page.locator('.convai-tip__key')).toHaveText('T');
    expect(await page.locator('.convai-tip__line').textContent()).toBe(
      `Let go to${String.fromCharCode(160)}send.`,
    );
    await expect(shown(page, 'talk')).toBeVisible();

    await expect(tip(page)).toHaveClass(/convai-tip--over-picture/);
    await page.waitForTimeout(300);
    const bubble = await box(tip(page));
    const glass = await box(lens(page));
    const shell = await box(capsule(page));

    expect(Math.abs(bubble.x - (shell.x - 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(glass.y - (bubble.y + bubble.height) - 16)).toBeLessThanOrEqual(1);
    expect(Math.abs((await tailCentre(page)).x - (glass.x + glass.width / 2))).toBeLessThanOrEqual(
      1,
    );
    // The tail hangs under the bubble, toward the Lens: its centre on the bubble's lower edge.
    expect(Math.abs((await tailCentre(page)).y - (bubble.y + bubble.height))).toBeLessThanOrEqual(
      1,
    );
    // The halo is the Lens's own circle.
    // Measured once its breath (scale 1.08 → 1 over 1.2 s) is over.
    await page.waitForTimeout(1300);
    const ring = await box(halo(page));
    for (const side of ['x', 'y', 'width', 'height'] as const)
      expect(Math.abs(ring[side] - glass[side])).toBeLessThanOrEqual(0.5);
    await expect(halo(page)).toHaveCSS('border-radius', '50%');
    // Said once, politely.
    await page.waitForTimeout(800);
    expect((await saidTexts(page)).filter((text) => text.startsWith('Tip:'))).toEqual([
      'Tip: Hold T to talk. Let go to send.',
    ]);
  });

  test('is learned by talking: it goes at once and never comes back', async ({ page }) => {
    await live(page);
    await shareCamera(page);
    await expect(tip(page)).toBeVisible();
    const shownAt = Date.now();
    await talk(page);
    await expect(tip(page)).toHaveCount(0);
    expect(Date.now() - shownAt).toBeLessThan(5000);
    await page.reload();
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
    await shareCamera(page);
    await page.waitForTimeout(1000);
    await expect(tip(page)).toHaveCount(0);
  });

  test('leaves after 6 s, comes back once in the next session, then never', async ({ page }) => {
    await live(page);
    await shareCamera(page);
    await expect(tip(page)).toBeVisible();
    await page.waitForTimeout(5000);
    await expect(tip(page)).toBeVisible();
    await expect(tip(page)).toHaveCount(0, { timeout: 2000 });
    for (const [session, shows] of [
      [2, 1],
      [3, 0],
    ] as const) {
      await page.reload();
      await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
      await shareCamera(page);
      await page.waitForTimeout(1000);
      await expect(tip(page), `session ${String(session)}`).toHaveCount(shows);
      if (shows) await expect(tip(page)).toHaveCount(0, { timeout: 7000 });
    }
  });

  test('is skipped for the session when the person types first, and shows in the next', async ({
    page,
  }) => {
    await live(page);
    await askAndSpeak(page, 'Hello?');
    await shareCamera(page);
    await page.waitForTimeout(1000);
    await expect(shown(page, 'talk')).toHaveCount(0);
    await page.reload();
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
    await shareCamera(page);
    await expect(shown(page, 'talk')).toBeVisible();
  });

  test('counts what was done before the tips’ own chunk arrived (a slow network)', async ({
    page,
  }) => {
    // The tips load as a chunk of their own while Kira connects: held back here until released.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/\/assets\/Tips-[\w-]+\.js$/, async (route) => {
      await held;
      await route.continue();
    });
    await live(page);
    await expect(page.locator('.va-tip')).toHaveCount(0);
    // Typed first and answered, all before the chunk is there.
    await askAndSpeak(page, 'Hello?');
    release();
    await page.waitForTimeout(500);
    await shareCamera(page);
    await page.waitForTimeout(1000);
    await expect(shown(page, 'talk')).toHaveCount(0);
    const record = JSON.parse((await stored(page)) ?? '{}') as {
      answers?: number;
      tips?: { talk?: { skippedIn?: number } };
    };
    expect(record.tips?.talk?.skippedIn).toBe(1);
    expect(record.answers).toBe(1);
  });

  test('says "Just talk" in hands free, and the passing microphone of the connect is no tip 3', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('va.talk-mode', 'hands-free');
    });
    await live(page);
    await shareCamera(page);
    await expect(page.locator('.convai-tip__title')).toHaveText('Just talk');
    await expect(page.locator('.convai-tip__line')).toHaveText('Kira is listening.');
    expect(await stored(page)).toContain('"type":{"learned":false,"shows":0');
  });

  test('stands left of the capsule, clear of an inset preview (0.43.0)', async ({ page }) => {
    await live(page);
    const png = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1600;
      canvas.height = 1200;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('No 2D context.');
      context.fillStyle = '#d8d0c0';
      context.fillRect(0, 0, 1600, 1200);
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/png');
      });
      if (!blob) throw new Error('No blob.');
      return [...new Uint8Array(await blob.arrayBuffer())];
    });
    await page.locator('input[type=file]').setInputFiles({
      name: 'mug.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png),
    });
    await expect(page.locator('.va-preview')).toBeVisible();
    await expect(tip(page)).toBeVisible();
    await page.waitForTimeout(300);
    const bubble = await box(tip(page));
    const preview = await box(page.locator('.va-preview'));
    const shell = await box(capsule(page));
    const glass = await box(lens(page));
    await expect(tip(page)).toHaveClass(/convai-tip--left/);
    // Clear of the preview and of the capsule, 16 left of the Lens, the tail at its centre.
    expect(bubble.y).toBeGreaterThanOrEqual(preview.y + preview.height);
    expect(bubble.x + bubble.width).toBeLessThanOrEqual(shell.x);
    expect(Math.abs(glass.x - (bubble.x + bubble.width) - 16)).toBeLessThanOrEqual(1);
    expect(Math.abs((await tailCentre(page)).y - (glass.y + glass.height / 2))).toBeLessThanOrEqual(
      1,
    );
    // Over the app's own ground beside a preview: no edge.
    await expect(tip(page)).not.toHaveClass(/convai-tip--over-picture/);
  });
});

test.describe('U2 · Esc to stop', () => {
  test('shows 1.5 s into the first answer, and Esc stops Kira and learns it', async ({ page }) => {
    await live(page);
    await shareCamera(page);
    await expect(tip(page)).toBeVisible();
    await talk(page);
    // When the capsule began to speak and when the bubble came, as the page saw them.
    await page.evaluate(() => {
      const times: Partial<Record<'speaking' | 'tip', number>> = {};
      (window as unknown as { tipTimes: Partial<Record<'speaking' | 'tip', number>> }).tipTimes =
        times;
      new MutationObserver(() => {
        const state = document
          .querySelector('.va-stage .convai-capsule')
          ?.getAttribute('data-state');
        if (state === 'speaking') times.speaking ??= performance.now();
        if (document.querySelector('.va-tip[data-tip="stop"]')) times.tip ??= performance.now();
      }).observe(document, { subtree: true, childList: true, attributes: true });
    });
    await askAndSpeak(page, 'What is this?', false);
    await expect(shown(page, 'stop')).toBeVisible({ timeout: 3000 });
    const times = await page.evaluate(
      () =>
        (window as unknown as { tipTimes: Partial<Record<'speaking' | 'tip', number>> }).tipTimes,
    );
    expect((times.tip ?? 0) - (times.speaking ?? 0)).toBeGreaterThanOrEqual(1500);
    expect((times.tip ?? 0) - (times.speaking ?? 0)).toBeLessThan(1800);
    await expect(page.locator('.convai-tip__key')).toHaveText('Esc');
    await expect(page.locator('.convai-tip__line')).toHaveText('Kira stops and listens again.');
    await page.keyboard.press('Escape');
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
    await expect(tip(page)).toHaveCount(0);
    expect(await stored(page)).toContain('"stop":{"learned":true');
  });

  test('waits while stage captions show (the capsule already says Esc to stop)', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const learned = { learned: true };
      localStorage.setItem(
        'va.tips',
        JSON.stringify({ sessions: 1, answers: 0, tips: { talk: learned } }),
      );
    });
    await live(page);
    // Closed, the transcript leaves the answer to the stage's captions.
    await page.keyboard.press('r');
    await expect(page.locator('.va-captions')).toHaveCount(0);
    await askAndSpeak(page, 'What is this?', false);
    await expect(page.locator('.va-captions')).toBeVisible();
    await page.waitForTimeout(2500);
    await expect(tip(page)).toHaveCount(0);
  });
});

test.describe('Convai UI tips 3–5', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      const learned = { learned: true };
      localStorage.setItem(
        'va.tips',
        JSON.stringify({ sessions: 0, answers: 0, tips: { talk: learned, stop: learned } }),
      );
    });
  });

  test('3 · muted, "Press / to type" points at the Type tool; one typed question learns it', async ({
    page,
  }) => {
    await live(page);
    await page.keyboard.press('m');
    await expect(capsule(page)).toHaveAttribute('data-state', 'muted');
    await expect(shown(page, 'type')).toBeVisible();
    await expect(page.locator('.convai-tip__title')).toHaveText('Press/to type');
    await page.waitForTimeout(300);
    const tool = await box(page.locator('[data-tip-target="type"]'));
    expect(Math.abs((await tailCentre(page)).x - (tool.x + tool.width / 2))).toBeLessThanOrEqual(1);
    await expect(tip(page)).toHaveClass(/convai-tip--above/);
    await askAndSpeak(page, 'Hello?');
    expect(await stored(page)).toContain('"type":{"learned":true');
  });

  test('4 · after the third answer with the transcript closed, below the bar’s Transcript tool; R learns it', async ({
    page,
  }) => {
    await live(page);
    await page.keyboard.press('r');
    for (const question of ['One?', 'Two?']) await askAndSpeak(page, question);
    await page.waitForTimeout(500);
    await expect(tip(page)).toHaveCount(0);
    await askAndSpeak(page, 'Three?');
    // With the transcript closed the answer is captioned: the tip waits until the caption goes.
    await expect(page.locator('.va-captions')).toBeVisible();
    await expect(tip(page)).toHaveCount(0);
    await expect(shown(page, 'transcript')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('.convai-tip__title')).toHaveText('PressRfor the transcript');
    await expect(tip(page)).toHaveClass(/convai-tip--below/);
    await page.waitForTimeout(300);
    const tool = await box(page.locator('[data-tip-target="transcript"]'));
    expect(Math.abs((await tailCentre(page)).x - (tool.x + tool.width / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs((await box(tip(page))).y - (tool.y + tool.height) - 16)).toBeLessThanOrEqual(1);
    await page.keyboard.press('r');
    await expect(tip(page)).toHaveCount(0);
    expect(await stored(page)).toContain('"transcript":{"learned":true');
  });

  test('5 · the second session, after its first answer, over More; Q learns it', async ({
    page,
  }) => {
    await live(page);
    await askAndSpeak(page, 'One?');
    await page.waitForTimeout(500);
    await expect(shown(page, 'quick')).toHaveCount(0);
    await page.reload();
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
    await page.waitForTimeout(500);
    await expect(tip(page)).toHaveCount(0);
    await askAndSpeak(page, 'Two?');
    await expect(shown(page, 'quick')).toBeVisible();
    await expect(page.locator('.convai-tip__title')).toHaveText('PressQfor quick controls');
    await page.keyboard.press('q');
    await expect(page.getByRole('dialog', { name: 'Quick controls' })).toBeVisible();
    await expect(tip(page)).toHaveCount(0);
    expect(await stored(page)).toContain('"quick":{"learned":true');
  });
});

test.describe('at text 1.30', () => {
  test('U1 and tip 3 stay above their target, 6 clear of the taller capsule', async ({ page }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('va.tips', JSON.stringify({ sessions: 0, answers: 0, tips: {} }));
    });
    await storedTextSize(page, 1.3);
    await live(page);
    await shareCamera(page);
    await expect(shown(page, 'talk')).toBeVisible();
    await page.waitForTimeout(300);
    await expect(tip(page)).toHaveClass(/convai-tip--above/);
    const shell = await box(capsule(page));
    const bubble = await box(tip(page));
    expect(Math.abs(shell.y - (bubble.y + bubble.height) - 6)).toBeLessThanOrEqual(1);
    const glass = await box(lens(page));
    expect(Math.abs((await tailCentre(page)).x - (glass.x + glass.width / 2))).toBeLessThanOrEqual(
      1,
    );

    await talk(page);
    await page.keyboard.press('m');
    await expect(shown(page, 'type')).toBeVisible();
    await page.waitForTimeout(300);
    await expect(tip(page)).toHaveClass(/convai-tip--above/);
    const typeBubble = await box(tip(page));
    expect(Math.abs(shell.y - (typeBubble.y + typeBubble.height) - 6)).toBeLessThanOrEqual(1);
  });
});

test.describe('one at a time, never in the way', () => {
  test('Esc with nothing else to close sends it away unlearned; a press elsewhere too', async ({
    page,
  }) => {
    await live(page);
    await shareCamera(page);
    await expect(tip(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tip(page)).toHaveCount(0);
    expect(await stored(page)).toContain('"talk":{"learned":false,"shows":1');

    // Unlearned, it comes back once in the next session; a press on the stage sends it away too.
    await page.reload();
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
    await shareCamera(page);
    await expect(tip(page)).toBeVisible();
    await page.mouse.click(700, 300);
    await expect(tip(page)).toHaveCount(0);
    expect(await stored(page)).toContain('"talk":{"learned":false,"shows":2');
  });

  test('a press on the target is no press elsewhere', async ({ page }) => {
    await live(page);
    await shareCamera(page);
    await expect(tip(page)).toBeVisible();
    const glass = await box(lens(page));
    await page.mouse.move(glass.x + 22, glass.y + 22);
    await page.mouse.down();
    await expect(capsule(page)).toHaveAttribute('data-state', 'held');
    await page.waitForTimeout(200);
    await page.mouse.up();
    await expect(tip(page)).toHaveCount(0);
    expect(await stored(page)).toContain('"talk":{"learned":true');

    await askAndSpeak(page, 'What is this?', false);
    await expect(shown(page, 'stop')).toBeVisible({ timeout: 3000 });
  });

  test('Esc closes the floating transcript first; the tip stays (0.43.0)', async ({ page }) => {
    await live(page, {}, 900, 800);
    await page.keyboard.press('r');
    await expect(page.locator('.va-transcript--float')).toBeVisible();
    await shareCamera(page);
    await expect(shown(page, 'talk')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.va-transcript--float')).toHaveCount(0);
    await page.waitForTimeout(300);
    await expect(shown(page, 'talk')).toBeVisible();
  });

  test('goes when Quick controls opens over it', async ({ page }) => {
    await live(page);
    await shareCamera(page);
    await expect(shown(page, 'talk')).toBeVisible();
    await page.keyboard.press('q');
    await expect(page.getByRole('dialog', { name: 'Quick controls' })).toBeVisible();
    await expect(tip(page)).toHaveCount(0);
  });

  test('tips 3–5 wait while stage captions stand after an answer', async ({ page }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      const learned = { learned: true };
      localStorage.setItem(
        'va.tips',
        JSON.stringify({
          sessions: 1,
          answers: 3,
          tips: { talk: learned, stop: learned, type: learned },
        }),
      );
    });
    await live(page);
    // Closed, the transcript leaves the answer to the stage's captions; tip 5 is this session's.
    await page.keyboard.press('r');
    await askAndSpeak(page, 'One?');
    await expect(page.locator('.va-captions')).toBeVisible();
    await page.waitForTimeout(500);
    await expect(tip(page)).toHaveCount(0);
    // The captions go a few seconds after the voice; then More's tip comes.
    await expect(page.locator('.va-captions')).toHaveCount(0, { timeout: 8000 });
    await expect(shown(page, 'quick')).toBeVisible();
  });

  test('the target’s tooltip waits while a tip shows', async ({ page }) => {
    await live(page);
    await shareCamera(page);
    await expect(tip(page)).toBeVisible();
    await lens(page).hover();
    await page.waitForTimeout(900);
    await expect(page.locator('.convai-tooltip')).toHaveCount(1);
    await expect(page.locator('.convai-tooltip')).toBeHidden();
  });

  test('goes when Settings opens, and nothing shows while it is open', async ({ page }) => {
    await page.addInitScript(() => {
      const learned = { learned: true };
      localStorage.setItem(
        'va.tips',
        JSON.stringify({ sessions: 0, answers: 0, tips: { talk: learned, stop: learned } }),
      );
    });
    await live(page);
    await page.keyboard.press('m');
    await expect(shown(page, 'type')).toBeVisible();
    await page.keyboard.press('Control+,');
    await expect(page.locator('dialog.va-settings')).toBeVisible();
    await expect(tip(page)).toHaveCount(0);
  });
});

test.describe('Show tips again (S6) and Try it (S8)', () => {
  test('Show again makes the tips new; they start when Settings closes', async ({ page }) => {
    await live(page);
    await shareCamera(page);
    await expect(tip(page)).toBeVisible();
    await talk(page);
    await expect(tip(page)).toHaveCount(0);
    await page.keyboard.press('Control+,');
    const settings = page.locator('dialog.va-settings');
    await settings.getByRole('button', { name: 'Show again' }).click();
    await expect(settings.getByText('The tips start again when you close Settings')).toBeVisible();
    await expect(tip(page)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(shown(page, 'talk')).toBeVisible();
  });

  test('Try it closes Settings and the first tip shows at once', async ({ page }) => {
    await page.addInitScript(() => {
      const learned = { learned: true };
      const tips = { talk: learned, stop: learned, type: learned, transcript: learned };
      localStorage.setItem('va.tips', JSON.stringify({ sessions: 1, answers: 3, tips }));
    });
    await live(page);
    await shareCamera(page);
    await page.waitForTimeout(500);
    await expect(tip(page)).toHaveCount(0);
    await page.keyboard.press('Control+,');
    const settings = page.locator('dialog.va-settings');
    await settings.getByRole('tab', { name: 'About' }).click();
    await settings.getByRole('button', { name: 'How to use' }).click();
    await settings.getByRole('button', { name: 'Try it' }).click();
    await expect(settings).toHaveCount(0);
    await expect(shown(page, 'talk')).toBeVisible();
  });
});
