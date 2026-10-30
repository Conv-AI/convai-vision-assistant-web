import { expect, test, type Locator, type Page } from '@playwright/test';
import { closeFloatingWindows, floatingWindowFrom } from './compact';
import { fakeAccess } from './fakeAccess';
import { answer, openApp, type ApiCharacter } from './fakeConvai';
import { limits, skipIn } from './engines';

test.afterEach(async ({ page }) => {
  await closeFloatingWindows(page);
});

// Reduce motion (Settings › Accessibility; kit tokens: "every motion becomes a 150 ms fade; shots
// and crossfades cut") over a fake Convai, in its three cases: stored On with the browser asking
// for nothing, System with the browser asking to reduce, and stored Off with the browser asking to
// reduce, where motion stays. The Lens is drawn by script and tested in src/kit/lens. Nothing here
// shares a screen.

type Case = 'on' | 'system' | 'off';
const cases: { name: Case; reduced: boolean; title: string }[] = [
  { name: 'on', reduced: true, title: 'stored On, the browser asking for nothing' },
  { name: 'system', reduced: true, title: 'System, the browser asking to reduce' },
  { name: 'off', reduced: false, title: 'stored Off, the browser asking to reduce' },
];

/** The stored choice and the browser's own setting, before the page loads. */
async function prefer(page: Page, which: Case): Promise<void> {
  await page.emulateMedia({ reducedMotion: which === 'on' ? 'no-preference' : 'reduce' });
  await page.addInitScript((value) => {
    window.localStorage.setItem('va.preferences', JSON.stringify({ reduceMotion: value }));
  }, which);
}

/**
 * Slows every CSS animation and transition fifty times, so a 150 ms fade is still running when it
 * is read. Durations and keyframes read back are the effect's own, not the slowed ones.
 */
async function slowAnimations(page: Page): Promise<void> {
  skipIn(page, ['firefox', 'webkit'], limits.cdp);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.02 });
}

interface Motion {
  name: string;
  duration: number;
  iterations: number;
  /** Every property any keyframe sets. */
  properties: string[];
}

/** The element's running animations and transitions: what each animates, and for how long. */
function motionOf(target: Locator): Promise<Motion[]> {
  return target.evaluate((element) =>
    element.getAnimations().map((animation) => {
      const effect = animation.effect as KeyframeEffect;
      const timing = effect.getComputedTiming();
      const meta = new Set(['offset', 'computedOffset', 'easing', 'composite']);
      return {
        name:
          animation instanceof CSSAnimation
            ? animation.animationName
            : animation instanceof CSSTransition
              ? `transition:${animation.transitionProperty}`
              : 'script',
        duration: Number(timing.duration),
        iterations: Number(timing.iterations),
        properties: [
          ...new Set(
            effect
              .getKeyframes()
              .flatMap((frame) => Object.keys(frame).filter((k) => !meta.has(k))),
          ),
        ].sort(),
      };
    }),
  );
}

/** Under Reduce motion: one fade of 150 ms at most, and nothing that moves. */
function expectFadeOnly(motions: Motion[]): void {
  expect(motions.length).toBeGreaterThan(0);
  for (const motion of motions) {
    expect(motion.properties).toEqual(['opacity']);
    expect(motion.duration).toBeLessThanOrEqual(150);
  }
}

const capsule = (page: Page) => page.locator('.convai-capsule');

async function live(page: Page, which: Case, characters?: ApiCharacter[]): Promise<void> {
  await prefer(page, which);
  await openApp(page, {}, characters);
  await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
}

for (const { name, reduced, title } of cases) {
  test.describe(`Reduce motion, ${title}`, () => {
    test('marks the root, and the Compact window’s root', async ({ page }) => {
      skipIn(page, ['webkit'], limits.noPip);
      await live(page, name);
      const root = page.locator('html');
      if (reduced) await expect(root).toHaveClass(/convai-reduce-motion/);
      else await expect(root).not.toHaveClass(/convai-reduce-motion/);
      const pip = await floatingWindowFrom(page, () =>
        page.getByRole('button', { name: 'Compact', exact: true }).click(),
      );
      const floating = pip.locator('html');
      if (reduced) await expect(floating).toHaveClass(/convai-reduce-motion/);
      else await expect(floating).not.toHaveClass(/convai-reduce-motion/);
    });

    test('Quick controls fade in at their place, or grow up out of the capsule', async ({
      page,
    }) => {
      await live(page, name);
      await slowAnimations(page);
      await page.getByRole('button', { name: 'Quick controls' }).click();
      const motions = await motionOf(page.locator('.va-quick'));
      if (reduced) expectFadeOnly(motions);
      else
        expect(motions).toEqual([
          {
            name: 'va-quick-in',
            duration: 250,
            iterations: 1,
            properties: ['opacity', 'translate'],
          },
        ]);
    });

    test('the Island’s content fades in, the same in every case', async ({ page }) => {
      await live(page, name);
      await slowAnimations(page);
      await page.context().setOffline(true);
      await expect(capsule(page)).toHaveAttribute('data-state', 'offline');
      expectFadeOnly(await motionOf(page.locator('.convai-island__content').first()));
      await page.context().setOffline(false);
    });

    test('a caption cuts in, or fades in over a crossfade', async ({ page }) => {
      await live(page, name);
      // Captions stand on the stage only with the transcript closed (VAWindow).
      await page.keyboard.press('r');
      await page.keyboard.press('/');
      await page.keyboard.type('What is this?');
      await page.keyboard.press('Enter');
      await slowAnimations(page);
      const reply = answer(page, 'A ceramic mug.');
      const caption = page.locator('.va-captions__answer');
      await expect(caption).toBeVisible();
      const motions = await motionOf(caption);
      if (reduced) expect(motions).toEqual([]);
      else
        expect(motions).toEqual([
          { name: 'va-fade-in', duration: 120, iterations: 1, properties: ['opacity'] },
        ]);
      await reply;
    });

    test('a starting camera’s mark holds still as an arc, or turns', async ({ page }) => {
      await page.addInitScript(() => {
        navigator.mediaDevices.getUserMedia = () => new Promise(() => undefined);
      });
      await live(page, name);
      const chip = page.locator('.va-chip');
      await chip.click();
      await page.getByRole('group', { name: 'Camera' }).getByRole('menuitemradio').first().click();
      await expect(chip.locator('.va-chip__slot')).toHaveAttribute('data-mark', 'starting');
      const arc = chip.locator('.va-chip__loader-arc');
      const ring = chip.locator('.va-chip__loader-ring');
      const still = chip.locator('.va-chip__loader-still');

      const length = (path: typeof arc) =>
        path.evaluate((element: SVGPathElement) => Math.round(element.getTotalLength() * 10) / 10);
      expect(await length(arc)).toBeCloseTo((Math.PI * 3.25) / 2, 0);
      expect(await length(still)).toBeCloseTo((3 * Math.PI * 2.25) / 2, 0);
      if (reduced) {
        await expect(ring).toBeHidden();
        await expect(arc).toBeHidden();
        await expect(still).toBeVisible();
        expect(await motionOf(still)).toEqual([]);
      } else {
        expect(await motionOf(arc)).toEqual([
          { name: 'convai-spin', duration: 900, iterations: Infinity, properties: ['transform'] },
        ]);
        await expect(ring).toBeVisible();
        await expect(still).toBeHidden();
      }
    });

    test('a row Settings points out holds lit and cuts, or fades', async ({ page }) => {
      await live(page, name);
      await page.getByRole('button', { name: 'Settings' }).click();
      const settings = page.locator('dialog.va-settings');
      await page.keyboard.press('Control+f');
      await page.keyboard.type('mic');
      await settings.getByRole('button', { name: 'Show in Audio' }).click();
      const lit = settings.locator('.va-settings__row-box[data-row="input-device"]');
      await expect(lit).toHaveAttribute('data-lit');
      const motions = await motionOf(lit);
      if (reduced) {
        expect(motions).toEqual([]);
        await expect(lit).not.toHaveAttribute('data-lit', /.*/, { timeout: 2500 });
      } else {
        expect(motions.map(({ name: n, duration }) => ({ n, duration }))).toEqual([
          { n: 'va-settings-lit', duration: 1600 },
        ]);
        expect(motions[0]?.properties).toContain('backgroundColor');
      }
    });

    test('a portrait cuts in, and a card’s picture holds its size on hover', async ({ page }) => {
      await page.route('https://portraits.test/**', (route) =>
        route.fulfill({
          contentType: 'image/png',
          body: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
            'base64',
          ),
        }),
      );
      await live(page, name, [
        { id: 'kira-1', name: 'Kira', languages: ['en-US'] },
        { id: 'elena-2', name: 'Elena', portrait: 'https://portraits.test/elena.png' },
      ]);
      await slowAnimations(page);
      await page.locator('.va-bar__character').click();
      const picker = page.locator('dialog.va-picker');
      const card = picker.locator('.va-card', { has: page.getByText('Elena', { exact: true }) });
      const portrait = card.locator('.va-portrait').first();
      await expect(portrait).toBeVisible();
      await expect(portrait).toHaveAttribute('data-loaded', 'true');
      const shown = await motionOf(portrait);
      if (reduced) expect(shown).toEqual([]);
      else
        expect(shown).toEqual([
          { name: 'va-fade-in', duration: 200, iterations: 1, properties: ['opacity'] },
        ]);

      await card.hover();
      const picture = card.locator('.va-card__picture');
      if (reduced) {
        // It brightens, a fade of 150 ms, and never grows.
        expect(await motionOf(picture)).toEqual([
          { name: 'transition:filter', duration: 150, iterations: 1, properties: ['filter'] },
        ]);
        await expect(picture).toHaveCSS('transform', 'none');
      } else {
        expect(await motionOf(picture)).toEqual([
          { name: 'transition:transform', duration: 200, iterations: 1, properties: ['transform'] },
        ]);
      }
    });
  });

  test.describe(`the first run under Reduce motion, ${title}`, () => {
    const run = (page: Page) => page.locator('.va-first-run');

    async function open(page: Page) {
      await prefer(page, name);
      await fakeAccess(page);
      await openApp(page, { firstRun: true });
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Show Kira what you see');
    }

    test('Welcome shows the finished turn at once, or plays it', async ({ page }) => {
      await open(page);
      const answerBubble = run(page).locator('.va-first-run__answer');
      if (reduced) {
        // Read at once, not waited for: a turn that plays would show its answer 3.8 s in.
        expect(await answerBubble.getAttribute('data-shown')).toBe('true');
        expect(await run(page).locator('.va-first-run__unread').count()).toBe(0);
      } else {
        // The answer comes 3.8 s in; the turn is read to its end at 6 s.
        await expect(answerBubble).not.toHaveAttribute('data-shown');
        await expect(answerBubble).toHaveAttribute('data-shown', 'true', { timeout: 6000 });
      }
    });

    if (name === 'system')
      test('the bubbles still to come fade in without rising when the browser asks mid-turn', async ({
        page,
      }) => {
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await fakeAccess(page);
        await openApp(page, { firstRun: true });
        const answerBubble = run(page).locator('.va-first-run__answer');
        await expect(run(page).locator('.va-first-run__ask')).toHaveAttribute('data-shown', 'true');
        expect(await answerBubble.getAttribute('data-shown')).toBeNull();
        await slowAnimations(page);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await expect(answerBubble).toHaveAttribute('data-shown', 'true');
        for (const motion of await motionOf(answerBubble))
          expect(motion.properties).not.toContain('transform');
        await expect(answerBubble).toHaveCSS('transform', 'none');
      });

    test('a step fades in, or comes in from the right as it fades', async ({ page }) => {
      await open(page);
      await slowAnimations(page);
      await run(page).getByRole('button', { name: 'Get started', exact: true }).click();
      const motions = await motionOf(run(page).locator('.va-first-run__step'));
      if (reduced) expectFadeOnly(motions);
      else
        expect(motions).toEqual([
          {
            name: 'va-first-run-step',
            duration: 200,
            iterations: 1,
            properties: ['opacity', 'transform'],
          },
        ]);
    });

    test('How to talk’s pictures hold still, or play', async ({ page }) => {
      await open(page);
      await run(page).getByRole('button', { name: 'Get started', exact: true }).click();
      const bar = run(page).locator('.va-first-run__bar').first();
      const key = run(page).locator('.va-first-run__well-key').first();
      await expect(bar).toBeVisible();
      if (reduced) {
        expect(await motionOf(bar)).toEqual([]);
        expect(await motionOf(key)).toEqual([]);
      } else {
        expect((await motionOf(bar)).map((m) => m.name)).toEqual(['va-first-run-wave']);
        expect((await motionOf(key)).map((m) => m.name)).toEqual(['va-first-run-press']);
      }
    });
  });
}
