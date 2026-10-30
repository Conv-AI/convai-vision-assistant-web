import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { emit, fakeRecord, openApp, type FakeOptions } from './fakeConvai';

const capsule = (page: Page) => page.locator('.convai-capsule');
const field = (page: Page) => page.getByRole('textbox', { name: 'Message Kira' });
const composer = (page: Page) => page.locator('.va-composer');
const panel = (page: Page) => page.getByRole('region', { name: 'Transcript' });

async function live(page: Page, options: FakeOptions = {}) {
  await openApp(page, options);
  await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
  await page.evaluate(() => document.fonts.ready);
}

async function sends(page: Page, mode: FakeOptions['send']) {
  await page.evaluate((m) => {
    if (window.fakeConvai) window.fakeConvai.options.send = m;
  }, mode);
}

async function type(page: Page, text: string) {
  await page.keyboard.press('/');
  await expect(field(page)).toBeFocused();
  await page.keyboard.type(text);
}

async function box(page: Page) {
  const b = await composer(page).boundingBox();
  if (!b) throw new Error('No Type field.');
  return b;
}

test.describe('K1 · typing', () => {
  test('is the kit’s field at the frame’s size: 560 wide, 66 high on one line, 84 on two', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await live(page);
    await type(page, 'Is it dishwasher safe too?');

    let b = await box(page);
    expect(b.width).toBe(560);
    expect(b.height).toBeCloseTo(66, 0);
    expect(b.y + b.height).toBeCloseTo(864, 0);
    await page.keyboard.type(' And what about the handle, is that glazed the same way as the cup?');

    b = await box(page);
    expect(b.height).toBeGreaterThanOrEqual(82);
    expect(b.height).toBeLessThanOrEqual(85);
    expect(b.y + b.height).toBeCloseTo(864, 0);
  });

  test('draws Send’s arrow at the kit’s 1.8 and no fade on a field that does not scroll', async ({
    page,
  }) => {
    await live(page);
    await type(page, 'Hello');
    const look = await page.evaluate(() => {
      const arrow = document.querySelector('.va-composer__send svg');
      const area = document.querySelector('.va-composer__field');
      return {
        stroke: arrow ? getComputedStyle(arrow).strokeWidth : '',
        mask: area ? getComputedStyle(area).maskImage : '',
      };
    });
    expect(look.stroke).toBe('1.8px');
    expect(look.mask).toBe('none');
  });

  test('draws the frame’s Lens (40) at the field’s start and no ring of its own while focused', async ({
    page,
  }) => {
    await live(page);
    await type(page, 'Hello');
    const lens = page.locator('.va-composer__lens .convai-lens');
    const l = await lens.boundingBox();
    const b = await box(page);
    expect(l?.width).toBe(40);
    // padding 12 12 12 10 inside a 1 px edge (kit .cv-composer).
    expect((l?.x ?? 0) - b.x).toBeCloseTo(11, 0);
    const edge = await composer(page).evaluate((element) => {
      const style = getComputedStyle(element);
      return { border: style.borderTopColor, shadow: style.boxShadow };
    });
    // The frame's field is focused (its caret shows) and keeps the island edge.
    expect(edge.border).toBe('rgb(38, 38, 43)');
  });

  test('grows to eight whole lines, then scrolls', async ({ page }) => {
    await live(page);
    await page.keyboard.press('/');
    for (let i = 0; i < 10; i++) {
      await page.keyboard.type(`line ${String(i)}`);
      if (i < 9) await page.keyboard.press('Shift+Enter');
    }
    const lines = await field(page).evaluate((element) => {
      const style = getComputedStyle(element);
      const text =
        element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      // line-height normal: Inter's 1.21 of the size.
      return {
        lines: text / (parseFloat(style.fontSize) * 1.21),
        scrolls: element.scrollHeight > element.clientHeight,
      };
    });
    expect(lines.lines).toBeCloseTo(8, 1);
    expect(lines.scrolls).toBe(true);

    const mask = await field(page).evaluate((element) => getComputedStyle(element).maskImage);
    expect(mask).toContain('linear-gradient');
    // Eight lines of 15 px Inter (18.15) + 20 in the field, + 24 + 2 around it.
    const b = await box(page);
    expect(b.height).toBeGreaterThanOrEqual(189);
    expect(b.height).toBeLessThanOrEqual(193);
  });
});

test.describe('K2 · sending', () => {
  test('keeps the text with the kit’s loader until the service takes it, then it is a turn', async ({
    page,
  }) => {
    await live(page);
    await sends(page, 'hold');
    await type(page, 'Is it dishwasher safe too?');
    await page.keyboard.press('Enter');

    await expect(composer(page)).toHaveAttribute('data-send', 'sending');
    await expect(field(page)).toHaveValue('Is it dishwasher safe too?');
    await expect(field(page)).toHaveAttribute('readonly', '');
    await expect(composer(page).locator('.convai-lens--loader')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sending' })).toBeVisible();
    // The question is not in the transcript yet, and the SDK's echo did not make it a spoken turn.
    await expect(panel(page).getByText('Is it dishwasher safe too?')).toHaveCount(0);
    expect((await fakeRecord(page)).sent).toEqual(['Is it dishwasher safe too?']);
    // Return while Sending sends nothing more.
    await page.keyboard.press('Enter');
    expect((await fakeRecord(page)).sent).toHaveLength(1);

    // The service's listening may be the previous question's: Sending waits for its answer on this one.
    await emit(page, { type: 'activity', activity: 'listening' });
    await expect(composer(page)).toHaveAttribute('data-send', 'sending');
    await emit(page, { type: 'question-taken', text: 'Is it dishwasher safe too?' });
    await expect(field(page)).toHaveCount(0);
    await expect(panel(page).getByText('Is it dishwasher safe too?')).toHaveCount(1);
    await expect(panel(page).getByText(/^Typed · /)).toHaveCount(1);
  });

  test('draws the frame’s Sending: secondary text, Send without its glyph, the loader over it', async ({
    page,
  }) => {
    await live(page);
    await sends(page, 'hold');
    await type(page, 'Is it dishwasher safe too?');
    await page.keyboard.press('Enter');
    const look = await page.evaluate(() => {
      const need = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) throw new Error(`No ${selector}`);
        return element;
      };
      const text = getComputedStyle(need('.va-composer__field')).color;
      const send = need('.va-composer__send');
      const loader = need('.va-composer .convai-lens--loader');
      const s = send.getBoundingClientRect();
      const l = loader.getBoundingClientRect();
      return {
        text,
        glyph: getComputedStyle(need('.va-composer__send .convai-button__content')).opacity !== '0',
        loader: { w: l.width, cx: l.x + l.width / 2, cy: l.y + l.height / 2 },
        send: { cx: s.x + s.width / 2, cy: s.y + s.height / 2 },
      };
    });
    expect(look.text).toBe('rgba(246, 248, 250, 0.62)');
    expect(look.glyph).toBe(false);

    await expect
      .poll(() =>
        page.locator('.va-composer__send').evaluate((send) => getComputedStyle(send).boxShadow),
      )
      .toBe('none');
    expect(look.loader.w).toBe(24);
    expect(look.loader.cx).toBeCloseTo(look.send.cx, 0);
    expect(look.loader.cy).toBeCloseTo(look.send.cy, 0);
  });

  test('Esc leaves the text be while Sending; the question still becomes its turn', async ({
    page,
  }) => {
    await live(page);
    await sends(page, 'hold');
    await type(page, 'Is it dishwasher safe too?');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(field(page)).toHaveValue('Is it dishwasher safe too?');
    await expect(composer(page)).toHaveAttribute('data-send', 'sending');
    await emit(page, { type: 'question-taken', text: 'Is it dishwasher safe too?' });
    await expect(field(page)).toHaveCount(0);
    await expect(panel(page).getByText('Is it dishwasher safe too?')).toHaveCount(1);
  });

  test('a refusal from the service is the failed turn (T2), and the field lets go', async ({
    page,
  }) => {
    await live(page);
    await sends(page, 'hold');
    await type(page, 'Is it dishwasher safe too?');
    await page.keyboard.press('Enter');
    await emit(page, { type: 'question-failed' });
    await expect(field(page)).toHaveCount(0);
    await expect(panel(page).getByText('Kira couldn’t answer this one.')).toBeVisible();
  });
});

test.describe('K3 · couldn’t send', () => {
  test('keeps the text and says so above the field; Return sends it again', async ({ page }) => {
    await live(page);
    await sends(page, 'drop');
    await type(page, 'Is it dishwasher safe too?');
    await page.keyboard.press('Enter');

    const line = page.getByRole('alert').filter({ hasText: 'Couldn’t send.' });
    await expect(line).toHaveText('Couldn’t send. Press Return to try again.');
    await expect(field(page)).toHaveValue('Is it dishwasher safe too?');
    await expect(field(page)).toBeFocused();
    await expect(field(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(composer(page)).toHaveAttribute('data-send', 'failed');
    await expect(panel(page).getByText('Is it dishwasher safe too?')).toHaveCount(0);

    await sends(page, 'take');
    await page.keyboard.press('Enter');
    await expect(field(page)).toHaveCount(0);
    await expect(line).toHaveCount(0);
    await expect(panel(page).getByText('Is it dishwasher safe too?')).toHaveCount(1);
    expect((await fakeRecord(page)).sent).toEqual(['Is it dishwasher safe too?']);
  });

  test('draws the frame’s line: dot 6 danger at 20 in, 12 / 1.4 at 72 %, 8 over the field', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await live(page);
    await sends(page, 'drop');
    await type(page, 'Is it dishwasher safe too?');
    await page.keyboard.press('Enter');
    await expect(composer(page)).toHaveAttribute('data-send', 'failed');
    const g = await page.evaluate(() => {
      const need = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) throw new Error(`No ${selector}`);
        return element;
      };
      const line = need('.va-composer__line');
      const dot = need('.va-composer__line .va-dot');
      const box = need('.va-composer');
      const l = line.getBoundingClientRect();
      const d = dot.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      const style = getComputedStyle(line);
      return {
        dotX: d.x - b.x,
        dotW: d.width,
        dotColor: getComputedStyle(dot).backgroundColor,
        gap: b.y - (l.y + l.height),
        size: style.fontSize,
        lineHeight: style.lineHeight,
        color: style.color,
      };
    });

    expect(g.dotX).toBeCloseTo(20, 0);
    expect(g.dotW).toBe(6);
    expect(g.dotColor).toBe('rgb(255, 69, 58)');
    expect(g.gap).toBeCloseTo(8, 0);
    expect(g.size).toBe('12px');
    expect(parseFloat(g.lineHeight)).toBeCloseTo(16.8, 1);
    expect(g.color).toBe('color(srgb 0.964706 0.972549 0.980392 / 0.72)');
  });

  test('gives up on Sending after 10 s with no word from the service', async ({ page }) => {
    await page.clock.install();
    await live(page);
    await sends(page, 'hold');
    await type(page, 'Is it dishwasher safe too?');
    await page.keyboard.press('Enter');
    await expect(composer(page)).toHaveAttribute('data-send', 'sending');
    await page.clock.runFor(10_000);
    await expect(composer(page)).toHaveAttribute('data-send', 'failed');
    await expect(page.getByRole('alert').filter({ hasText: 'Couldn’t send.' })).toBeVisible();
  });

  test('emptying the field lets Couldn’t send go', async ({ page }) => {
    await live(page);
    await sends(page, 'drop');
    await type(page, 'Is it dishwasher safe too?');
    await page.keyboard.press('Enter');
    await expect(composer(page)).toHaveAttribute('data-send', 'failed');
    await page.keyboard.press('Escape');
    await expect(field(page)).toHaveValue('');
    await expect(page.locator('.va-composer__line')).toHaveCount(0);
    // A new question typed after it is not one that could not leave.
    await page.keyboard.type('And the lid?');
    await expect(page.locator('.va-composer__line')).toHaveCount(0);
    await expect(composer(page)).not.toHaveAttribute('data-send', 'failed');
  });

  test('has no accessibility violations', async ({ page }) => {
    await live(page);
    await sends(page, 'drop');
    await type(page, 'Is it dishwasher safe too?');
    await page.keyboard.press('Enter');
    await expect(composer(page)).toHaveAttribute('data-send', 'failed');
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
