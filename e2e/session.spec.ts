import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { answer, emit, fakeRecord, openApp } from './fakeConvai';

const capsule = (page: Page) => page.locator('.convai-capsule');

async function live(page: Page, options: Parameters<typeof openApp>[1] = {}) {
  await openApp(page, options);
  await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
}

/**
 * A clock paused before the page loads: only the test moves it. Paused at a time read a moment
 * before, a running clock can already be past it on a loaded machine; installed at the epoch, it is
 * paused at today by a jump forward that no delay turns into the past, with nothing loaded to fire.
 */
async function pausedClock(page: Page) {
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(Date.now());
}

type HeardOffline = Window & { heardOffline?: Promise<void> };

/**
 * Takes the network away and waits until the page has heard it, before a test moves the clock: the
 * page hears `offline` a moment after `setOffline` returns, and a clock moved meanwhile ran before the
 * app's own 3 s had begun. The app's listener was there first, so it has run once this one has.
 */
async function goOffline(page: Page, context: BrowserContext) {
  await page.evaluate(() => {
    (window as HeardOffline).heardOffline = new Promise((resolve) => {
      window.addEventListener(
        'offline',
        () => {
          resolve();
        },
        { once: true },
      );
    });
  });
  await context.setOffline(true);
  await page.evaluate(() => (window as HeardOffline).heardOffline);
}

/**
 * Offline (3 s), then Couldn't connect 30 s after it: the clock jumps to each, firing what falls due on
 * the way once. Stepped through every animation frame of those 33 s, a loaded machine ran into the
 * test's own time limit.
 */
async function untilStranded(page: Page) {
  await page.clock.fastForward(3000);
  await page.clock.fastForward(30_000);
}

async function ask(page: Page, question: string) {
  await page.keyboard.press('/');
  await expect(page.getByRole('textbox', { name: 'Message Kira' })).toBeFocused();
  await page.keyboard.type(question);
  await page.keyboard.press('Enter');
}

test.describe('starting', () => {
  test('wakes the character, then opens the conversation', async ({ page }) => {
    await openApp(page, { connect: 'hold' });

    const words = page.getByText('Connecting to Kira…');
    await expect(words).toBeHidden();
    const lens = page.locator('.va-launch .convai-lens');
    const before = await lens.boundingBox();
    await expect(words).toBeVisible({ timeout: 3000 });
    expect(await lens.boundingBox()).toEqual(before);
    // Said as they show: the Lens is drawn only and there is no capsule to say it.
    await expect(page.getByRole('status').filter({ hasText: 'Connecting to Kira…' })).toHaveCount(
      1,
    );
    await expect(capsule(page)).toHaveCount(0);

    await page.evaluate(() => window.fakeConvai?.accept());
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
    await expect(page.getByText('Ask Kira')).toBeVisible();
    await expect(page.getByText('Show Kira something')).toBeVisible();
    await expect(page.getByText('No conversation yet')).toBeVisible();
  });

  test('keeps one Lens from boot to Connecting, and mounts Couldn’t connect anew', async ({
    page,
  }) => {
    await openApp(page, { connect: 'hold' }, undefined, 1000);
    const boot = await page.locator('.va-launch').elementHandle();
    await expect(page.getByText('Connecting to Kira…')).toBeVisible({ timeout: 4000 });
    // The Lens eases from ready to connecting rather than start again.
    expect(await boot.evaluate((node) => node.isConnected)).toBe(true);
    await page.evaluate(() => window.fakeConvai?.refuse('network'));
    await expect(page.getByRole('alert')).toContainText('Couldn’t connect');
    // A new element, so a screen reader says the alert.
    expect(await boot.evaluate((node) => node.isConnected)).toBe(false);
  });

  test('holds the empty transcript still from boot to the name (L1 to L2)', async ({ page }) => {
    await openApp(page, { connect: 'hold' }, undefined, 1500);
    const title = page.getByText('No conversation yet');
    await expect(title).toBeVisible();
    await expect(page.getByText('Connecting to Kira…')).toHaveCount(0);
    // Measured in its own font: Inter arriving late on a loaded machine widened the words.
    await page.evaluate(() => document.fonts.ready);
    const before = await title.boundingBox();

    await expect(page.getByText('Connecting to Kira…')).toBeVisible({ timeout: 4000 });
    expect(await title.boundingBox()).toEqual(before);
  });

  test('says it couldn’t connect, and Try again connects', async ({ page }) => {
    await openApp(page, { connect: 'refuse-network' });
    await expect(page.getByRole('alert')).toContainText('Couldn’t connect');
    const retry = page.getByRole('button', { name: 'Try again' });
    await expect(retry).toBeFocused();

    expect((await retry.boundingBox())?.height).toBe(44);

    await retry.click();
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
    expect((await fakeRecord(page)).connects).toBe(2);
  });

  test('names the service when it is the service that refused', async ({ page }) => {
    await openApp(page, { connect: 'refuse-service' });
    await expect(page.getByRole('alert')).toContainText('Kira is unavailable right now');
  });

  test('is calm with no character configured (H10c)', async ({ page }) => {
    await openApp(page, {}, []);
    await expect(capsule(page)).toHaveAttribute('data-state', 'no-character');
    await expect(page.getByText('No characters available').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Type' })).toHaveCount(0);
    // No stand-in name anywhere, and no promise that voice or text work.
    await expect(page.getByText(/Character/)).toHaveCount(0);
    await expect(page.getByText(/Voice and text work/)).toHaveCount(0);
    await page.keyboard.press('/');
    await expect(page.getByRole('textbox')).toHaveCount(0);
  });
});

test.describe('talking', () => {
  test('types a question, shows the reply, and captions it while it is spoken', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('va.preferences', JSON.stringify({ readAnswers: true }));
    });
    await live(page);
    await ask(page, 'What is this?');
    expect((await fakeRecord(page)).sent).toEqual(['What is this?']);

    const panel = page.getByRole('region', { name: 'Transcript' });
    await expect(panel.getByText('What is this?')).toBeVisible();
    await expect(panel.getByText(/^Typed · /)).toBeVisible();

    const reply = answer(page, 'A ceramic mug.');
    // Beside a pinned column the words are the column's: no caption on the stage, even while speaking.
    await expect(capsule(page)).toHaveAttribute('data-state', 'speaking');
    await expect(panel.getByText('A ceramic mug.')).toBeVisible();
    await expect(page.locator('.va-captions')).toHaveCount(0);
    await reply;
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('.va-captions')).toHaveCount(0);
    await expect(panel.getByText('A ceramic mug.')).toBeVisible();

    await expect(page.getByRole('status').filter({ hasText: 'Kira: A ceramic mug.' })).toHaveCount(
      1,
    );
  });

  test('stops a spoken reply with Esc and marks it Stopped', async ({ page }) => {
    await live(page);
    await ask(page, 'Tell me a story.');
    await emit(page, { type: 'activity', activity: 'thinking' });
    await emit(page, { type: 'reply', id: 'r1', text: 'Once upon a time', streaming: true });
    await emit(page, { type: 'activity', activity: 'speaking' });
    await expect(capsule(page)).toHaveAttribute('data-state', 'speaking');

    await page.keyboard.press('Escape');
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
    expect((await fakeRecord(page)).interrupts).toBe(1);
    const panel = page.getByRole('region', { name: 'Transcript' });
    await expect(panel.getByText('Once upon a time…')).toBeVisible();
    await expect(panel.getByText('Stopped', { exact: true })).toBeVisible();
  });

  test('offers Try again on a turn that failed, and resends it (T2)', async ({ page }) => {
    await live(page);
    await ask(page, 'Is it dishwasher safe?');
    await emit(page, { type: 'question-failed' });

    const panel = page.getByRole('region', { name: 'Transcript' });
    await expect(panel.getByText('Kira couldn’t answer this one.')).toBeVisible();
    await panel.getByRole('button', { name: 'Try again' }).click();
    expect((await fakeRecord(page)).sent).toEqual([
      'Is it dishwasher safe?',
      'Is it dishwasher safe?',
    ]);
    await expect(panel.getByText('Kira couldn’t answer this one.')).toHaveCount(0);
  });

  test('takes letters typed right after / as the message, not as shortcuts', async ({ page }) => {
    await live(page);
    // No wait between the two: "t" and "m" must not hold to talk or mute.
    await page.keyboard.press('/');
    await page.keyboard.type('tm r');
    await expect(page.getByRole('textbox', { name: 'Message Kira' })).toHaveValue('tm r');
    expect((await fakeRecord(page)).microphone).toEqual([]);

    // Straight after a send, the next / and its letters still land in the new field.
    await page.keyboard.press('Enter');
    await page.keyboard.press('/');
    await page.keyboard.type('is it?');
    await expect(page.getByRole('textbox', { name: 'Message Kira' })).toHaveValue('is it?');
  });

  test('Esc clears the field, then closes it and gives the focus back to Type', async ({
    page,
  }) => {
    await live(page);
    await page.keyboard.press('/');
    await page.keyboard.type('Half a thought');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('textbox', { name: 'Message Kira' })).toHaveValue('');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('textbox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Type' })).toBeFocused();
  });

  test('mutes with M and unmutes with M again', async ({ page }) => {
    await live(page);
    await page.keyboard.press('m');
    await expect(capsule(page)).toHaveAttribute('data-state', 'muted');
    await expect(page.getByText('Muted · Kira can’t hear you')).toBeVisible();
    await page.keyboard.press('m');
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
  });
});

test.describe('push to talk', () => {
  test('asks for the microphone on the first hold, then talks while T is held', async ({
    page,
  }) => {
    await live(page, { permission: 'prompt' });
    await page.keyboard.down('t');
    await page.keyboard.up('t');
    const ask = page.getByRole('dialog', { name: 'I need your microphone to hear you' });
    await expect(ask).toBeVisible();
    await expect(page.getByText('Waiting for the microphone')).toBeVisible();

    await ask.getByRole('button', { name: 'Allow microphone' }).click();
    await expect(ask).toHaveCount(0);
    await expect(page.locator('.convai-island')).toContainText('Microphone is on');
    expect((await fakeRecord(page)).microphone).toEqual([true, false]);

    await page.keyboard.down('t');
    await expect(capsule(page)).toHaveAttribute('data-state', 'held');
    await expect(page.getByText('Release T to send')).toBeVisible();
    await page.keyboard.up('t');
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
    await expect
      .poll(async () => (await fakeRecord(page)).microphone)
      .toEqual([true, false, true, false]);
  });

  test('closes the microphone when the window loses focus while T is held', async ({ page }) => {
    await live(page);
    await page.keyboard.down('t');
    await expect(capsule(page)).toHaveAttribute('data-state', 'held');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
    await expect.poll(async () => (await fakeRecord(page)).microphone).toEqual([true, false]);
    await page.keyboard.up('t');
  });

  test('names a blocked microphone on the Island, with Type instead', async ({ page }) => {
    await live(page, { microphone: 'blocked' });
    await page.keyboard.down('t');
    await page.waitForTimeout(250);
    await page.keyboard.up('t');
    const island = page.locator('.convai-island');
    await expect(island).toContainText('The microphone is blocked');
    await expect(island).toContainText('Allow the microphone in this site’s settings');

    await expect(page.locator('.convai-capsule__hint')).toHaveText('Press / to type');
    await page.getByRole('button', { name: 'Type instead' }).click();
    await expect(page.getByRole('textbox', { name: 'Message Kira' })).toBeFocused();
  });
});

test.describe('the connection', () => {
  test('offline for more than 30 s shows Couldn’t connect in place of the capsule (L6)', async ({
    page,
    context,
  }) => {
    await pausedClock(page);
    await openApp(page);
    await page.clock.runFor(1000);
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
    await ask(page, 'What is this?');
    await page.keyboard.press('Escape');
    await goOffline(page, context);

    await page.clock.fastForward(3000);
    await expect(capsule(page)).toHaveAttribute('data-state', 'offline');
    await page.clock.fastForward(29_000);
    await expect(page.locator('.va-launch[role="alert"]')).toHaveCount(0);

    await page.clock.fastForward(1000);
    const alert = page.locator('.va-launch[role="alert"]');
    await expect(alert).toContainText('Couldn’t connect');
    await expect(alert).toContainText('Check your internet connection, then try again.');
    // The capsule and the Island give way; the transcript keeps what was said.
    await expect(capsule(page)).toHaveCount(0);
    await expect(page.locator('.convai-island')).toHaveCount(0);
    await expect(page.locator('.va-transcript')).toContainText('What is this?');

    // Try again, still offline, comes straight back to Couldn't connect.
    await alert.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('.va-launch[role="alert"]')).toContainText('Couldn’t connect');

    // Online again, the session comes back by itself and the overlay goes.
    await context.setOffline(false);
    await page.clock.runFor(1000);
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('.va-launch[role="alert"]')).toHaveCount(0);
  });

  test('Try again on L6 shows Connecting while it runs, then the conversation', async ({
    page,
    context,
  }) => {
    await page.clock.install();
    await live(page, { later: 'hold' });
    await emit(page, { type: 'ended' });
    await goOffline(page, context);
    await untilStranded(page);
    await expect(page.locator('.va-launch[role="alert"]')).toContainText('Couldn’t connect');

    // Back online, a connect starts by itself or on Try again (whichever comes first).
    const before = (await fakeRecord(page)).connects;
    await context.setOffline(false);
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.clock.runFor(2000);
    await expect(page.getByText('Connecting to Kira…')).toBeVisible();
    await expect(capsule(page)).toHaveCount(0);
    // The token comes first: accept the connect once it has started.
    await expect.poll(async () => (await fakeRecord(page)).connects).toBeGreaterThan(before);
    await page.evaluate(() => window.fakeConvai?.accept());
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
  });

  test('L6 mid-session leaves the focus where the person put it', async ({ page, context }) => {
    await page.clock.install();
    await live(page);
    const style = page.getByRole('button', { name: /Moments/ });
    await style.focus();
    await goOffline(page, context);
    await untilStranded(page);
    await expect(page.locator('.va-launch[role="alert"]')).toBeVisible();
    await expect(style).toBeFocused();
  });

  test('L6 takes the focus to Try again when the focus went with the capsule', async ({
    page,
    context,
  }) => {
    await page.clock.install();
    await live(page);
    await goOffline(page, context);
    await page.clock.fastForward(4000);
    await capsule(page).getByRole('button', { name: 'Reconnect' }).focus();
    await page.clock.fastForward(30_000);
    await expect(page.getByRole('button', { name: 'Try again' })).toBeFocused();
  });

  test('goes offline after 3 s without network and comes back', async ({ page, context }) => {
    await live(page);
    await context.setOffline(true);
    await page.keyboard.press('/');
    await page.keyboard.type('And the handle?');
    await expect(capsule(page)).toHaveCount(0);
    // The draft waits, and the line above the field says why.
    await expect(page.locator('.va-composer__note')).toHaveText(
      'Typing returns when you’re back online',
      {
        timeout: 6000,
      },
    );
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(capsule(page)).toHaveAttribute('data-state', 'offline', { timeout: 6000 });
    await expect(capsule(page)).toContainText('You’re offline');
    await expect(capsule(page)).toContainText('Reconnects on its own');
    await expect(page.locator('.convai-island')).toContainText(
      'You’re offline. You can keep working.',
    );

    await context.setOffline(false);
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('.convai-island')).toContainText('Back online');
  });

  test('offline is said once on the Island (4 s), then the capsule carries it with Reconnect (H10)', async ({
    page,
    context,
  }) => {
    await live(page);
    await context.setOffline(true);
    await expect(capsule(page)).toHaveAttribute('data-state', 'offline', { timeout: 6000 });
    const island = page.locator('.convai-island');
    await expect(island).toContainText('You’re offline. You can keep working.');
    // A status toast with no action of its own: Reconnect is the capsule's, secondary.
    await expect(island.getByRole('button', { name: /Try again|Reconnect/ })).toHaveCount(0);
    const reconnect = capsule(page).getByRole('button', { name: 'Reconnect' });
    await expect(reconnect).toHaveClass(/convai-button--secondary/);
    await expect(capsule(page).getByRole('button', { name: 'Quick controls' })).toBeVisible();
    await expect(island).not.toContainText('You’re offline', { timeout: 6000 });
    await expect(capsule(page)).toHaveAttribute('data-state', 'offline');
    await context.setOffline(false);
  });

  test('unavailable is the capsule’s alone: no Island, Try again primary, the warn dot (H10b)', async ({
    page,
  }) => {
    await live(page, { later: 'refuse-service' });
    await emit(page, { type: 'ended' });
    await expect(capsule(page)).toHaveAttribute('data-state', 'unavailable');
    await expect(capsule(page)).toContainText('Kira is unavailable right now');
    await expect(capsule(page).getByRole('button', { name: 'Try again' })).toHaveClass(
      /convai-button--primary/,
    );
    await expect(capsule(page).locator('.convai-lens__warning')).toBeVisible();
    // Watch past the Island's own timing: nothing comes.
    for (let i = 0; i < 15; i++) {
      await expect(page.locator('.convai-island')).not.toContainText('unavailable');
      await page.waitForTimeout(100);
    }
  });

  test('starts a new session when the old one ends, and marks the break', async ({ page }) => {
    await live(page);
    await ask(page, 'Hello?');
    await answer(page, 'Hi.');
    await emit(page, { type: 'ended' });

    await expect(page.locator('.convai-island')).toContainText('Kira restarted after a break');
    await expect(page.getByRole('separator')).toHaveText('Restarted');
    expect((await fakeRecord(page)).connects).toBe(2);
  });

  test('shows the weak-connection warning while the link is poor', async ({ page }) => {
    await live(page);
    await emit(page, { type: 'quality', quality: 'poor' });
    await expect(page.locator('.convai-island')).toContainText('Weak connection');

    const surface = page.locator('.convai-island__surface');
    const [box, dot] = await Promise.all([
      surface.boundingBox(),
      surface.locator('.convai-island__mark--warn').boundingBox(),
    ]);
    if (!box || !dot) throw new Error('No layout.');
    expect(dot.x - box.x).toBeCloseTo(14, 1);
  });
});

test.describe('the transcript', () => {
  test('R hides the pinned column and brings it back; the bar gets its tool meanwhile', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await live(page);
    const panel = page.getByRole('region', { name: 'Transcript' });
    await expect(page.getByRole('button', { name: 'Transcript', exact: true })).toHaveCount(0);

    await page.keyboard.press('r');
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Transcript', exact: true })).toBeVisible();
    await page.keyboard.press('r');
    await expect(panel).toBeVisible();
  });

  test('floats beside a Compact capsule at 760, and Esc gives the focus back to the bar', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 760, height: 720 });
    await live(page);
    const panel = page.getByRole('region', { name: 'Transcript' });
    await expect(panel).toHaveCount(0);

    await page.keyboard.press('r');
    await expect(panel).toHaveClass(/va-transcript--float/);
    await expect(capsule(page)).toHaveClass(/convai-capsule--compact/);
    await expect(capsule(page).getByText('Ask Kira')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Transcript', exact: true })).toBeFocused();
  });

  test('covers a stage under 640 as a sheet, with the capsule above it', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 640 });
    await live(page);
    await page.keyboard.press('r');
    await expect(page.getByRole('region', { name: 'Transcript' })).toHaveClass(
      /va-transcript--sheet/,
    );
    await expect(capsule(page)).toBeVisible();
  });

  test('keeps its place when scrolled up, and New reply takes the person to the end (T3)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await live(page);
    for (let i = 0; i < 12; i++) {
      await ask(page, `Question ${String(i)}`);
      await answer(
        page,
        'A long enough answer to fill the column a little more each time it comes.',
      );
    }
    const list = page.locator('.va-transcript__list');
    const info = await list.evaluate((element) => {
      element.scrollTop = 0;
      return { scroll: element.scrollHeight, client: element.clientHeight };
    });
    expect(info.scroll).toBeGreaterThan(info.client);
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBe(0);

    await ask(page, 'One more?');
    await answer(page, 'Yes.');
    expect(await list.evaluate((element) => element.scrollTop)).toBe(0);
    const pill = page.getByRole('button', { name: 'New reply' });
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(pill).toHaveCount(0);
    await expect
      .poll(() => list.evaluate((e) => e.scrollHeight - e.scrollTop - e.clientHeight < 2))
      .toBe(true);
  });

  test('switches to the Conversation style and keeps it', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await live(page);
    await ask(page, 'What is this?');
    await page.getByRole('button', { name: /Transcript style/ }).click();
    await page.getByRole('menuitemradio', { name: 'Conversation' }).click();
    await expect(page.locator('.va-bubble--you')).toHaveText(/What is this\?/);

    await page.reload();
    await expect(page.getByRole('button', { name: /Transcript style/ })).toContainText(
      'Conversation',
    );
  });

  test('captions the reply on the stage while the transcript is closed', async ({ page }) => {
    await page.setViewportSize({ width: 760, height: 720 });
    await live(page);
    await ask(page, 'What is this?');
    await answer(page, 'A ceramic mug.');
    // The finished caption holds for a moment after the voice ends.
    await expect(page.locator('.va-captions')).toContainText('A ceramic mug.');
  });
});

test.describe('accessibility', () => {
  for (const [name, size] of [
    ['the wide window', { width: 1440, height: 900 }],
    ['the narrow window with the floating transcript', { width: 760, height: 720 }],
  ] as const) {
    test(`${name} has no violations`, async ({ page }) => {
      await page.setViewportSize(size);
      await live(page);
      await ask(page, 'What is this?');
      await answer(page, 'A ceramic mug.');
      if (size.width < 960) await page.keyboard.press('r');
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });
  }

  test('Couldn’t connect has no violations', async ({ page }) => {
    await openApp(page, { connect: 'refuse-network' });
    await expect(page.getByRole('alert')).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
