import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/gallery.html');
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole('heading', { name: 'Island' }).scrollIntoViewIfNeeded();
});

const cell = (page: Page, name: string) =>
  page.locator('.gallery__island-cell').filter({ has: page.getByText(name, { exact: true }) });
const live = (page: Page) => page.locator('.gallery__island-live');
const post = async (page: Page, name: string) => {
  await page
    .getByRole('group', { name: 'Try the Island' })
    .getByRole('button', { name, exact: true })
    .click();
};

test('a toast is 40 high on surface.island, and 48 at text size 1.30', async ({ page }) => {
  const toast = cell(page, 'Toast').locator('.convai-island__surface').first();
  const box = await toast.boundingBox();
  expect(box && Math.round(box.height)).toBe(40);
  await expect(toast).toHaveCSS('background-color', 'rgb(5, 5, 6)');
  await page.getByLabel('Text size').selectOption('1.3');
  const grown = await toast.boundingBox();
  expect(grown && Math.round(grown.height)).toBe(48);
});

test('a toast’s close is shown but pointer only; a banner’s close is in the Tab order', async ({
  page,
}) => {
  const close = cell(page, 'Toast').locator('.convai-island__close');
  await expect(close).toBeVisible();
  await expect(close).toHaveAttribute('tabindex', '-1');
  await expect(close).toHaveAttribute('aria-hidden', 'true');
  await expect(
    cell(page, 'Banner · one action').getByRole('button', { name: 'Close' }),
  ).not.toHaveAttribute('tabindex', '-1');
});

for (const scale of ['1', '1.3']) {
  test(`where the words do not fit, the close gives way first, then a second line, at text ${scale}`, async ({
    page,
  }) => {
    await page.getByLabel('Text size').selectOption(scale);
    const narrow = cell(page, 'Narrow · close given way').locator('.convai-island__toast');
    const twoLines = cell(page, 'Narrow · two lines').locator('.convai-island__toast');
    // At 1.00 the 202 sheet needs only the first step: the close gives way, the words stay whole.
    if (scale === '1') await expect(narrow).toHaveAttribute('data-fit', 'no-close');
    else await expect(narrow).not.toHaveAttribute('data-fit', 'whole');
    await expect(twoLines).toHaveAttribute('data-fit', /brief|two-lines/);
    for (const toast of [narrow, twoLines]) {
      const line = toast.locator('.convai-island__line');
      // Every word shows, on at most two lines.
      expect(
        await line.evaluate(
          (e) => e.scrollWidth <= e.clientWidth && e.scrollHeight <= e.clientHeight + 1,
        ),
      ).toBe(true);
      const lines = await line.evaluate((e) => {
        const style = getComputedStyle(e);
        const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.25;
        return Math.round(e.getBoundingClientRect().height / lineHeight);
      });
      expect(lines).toBeLessThanOrEqual(2);
    }
  });
}

test('the close comes back when the words fit again', async ({ page }) => {
  const toast = cell(page, 'Narrow · close given way').locator('.convai-island__toast');
  await page.getByLabel('Text size').selectOption('1.3');
  await expect(toast).not.toHaveAttribute('data-fit', 'whole');
  await page.getByLabel('Text size').selectOption('0.9');
  await expect(toast).toHaveAttribute('data-fit', 'whole');
});

test('the dot reads its notification and expands on a press', async ({ page }) => {
  const dot = cell(page, 'Minimized dot').getByRole('button', { name: 'Offline. Expand.' });
  await dot.click();
  await expect(cell(page, 'Minimized dot').locator('.convai-island__toast')).toContainText(
    'Offline',
  );
});

test('statuses play in turn, a problem is read assertively and Ctrl Z undoes', async ({ page }) => {
  await post(page, 'Status');
  await expect(live(page).getByRole('status')).toHaveText('Copied');
  await post(page, 'Problem');
  await expect(live(page).getByRole('alert')).toHaveText('Offline. reconnecting');
  await page.getByRole('button', { name: 'Back online' }).click();
  await expect(live(page).locator('.convai-island__surface')).toBeHidden({ timeout: 4000 });

  await post(page, 'Undo');
  await expect(live(page)).toContainText('Conversation cleared');
  await page.keyboard.press('Control+z');
  await expect(live(page)).not.toContainText('Conversation cleared');
});

test('F6 moves to the Island’s action, Esc puts a request away, and the focus goes back', async ({
  page,
}) => {
  await post(page, 'Request');
  await expect(live(page)).toContainText('The microphone is blocked');
  const from = page.getByRole('button', { name: 'Back online' });
  await from.focus();
  await page.keyboard.press('F6');
  await expect(page.locator(':focus')).toHaveText(/How to allow/);
  await page.keyboard.press('Escape');
  await expect(
    live(page).getByRole('button', { name: /The microphone is blocked.*Expand/ }),
  ).toBeVisible();
  await expect(from).toBeFocused();
});

test('a toast’s time runs again once the focus has left with the action', async ({ page }) => {
  await post(page, 'Undo');
  await page.keyboard.press('F6');
  await page.keyboard.press('Enter');
  await post(page, 'Status');
  await expect(live(page)).toContainText('Copied');
  await expect(live(page).locator('.convai-island__surface')).toBeHidden({ timeout: 4000 });
});

test('Ctrl Z in a text field stays the field’s own', async ({ page }) => {
  await post(page, 'Undo');
  await page.evaluate(() => {
    const field = document.createElement('input');
    field.id = 'field';
    document.body.append(field);
    field.focus();
  });
  await page.keyboard.press('Control+z');
  await expect(live(page)).toContainText('Conversation cleared');
});

test('the Islands have no accessibility violations', async ({ page }) => {
  const results = await new AxeBuilder({ page }).include('[data-capture="island"]').analyze();
  expect(results.violations).toEqual([]);
});

interface Part {
  x: number;
  y: number;
  w: number;
  h: number;
}

async function parts(page: Page, name: string) {
  return cell(page, name)
    .locator('.convai-island__surface')
    .first()
    .evaluate((s) => {
      const box = s.getBoundingClientRect();
      const at = (selector: string): Part[] =>
        [...s.querySelectorAll(selector)].map((e) => {
          const b = e.getBoundingClientRect();
          return { x: b.left - box.left, y: b.top - box.top, w: b.width, h: b.height };
        });
      return {
        w: box.width,
        h: box.height,
        radius: parseFloat(getComputedStyle(s).borderTopLeftRadius),
        lead: at(
          '.convai-island__mark, .convai-island__icon, .convai-island__toast > .convai-lens, .convai-island__dot > svg',
        )[0],
        words: at('.convai-island__line, .convai-island__title')[0],
        body: at('.convai-island__body')[0],
        acts: at('.convai-island__action, .convai-island__banner-actions > button'),
        actGlyph: at('.convai-island__action svg')[0],
        close: at('.convai-island__close')[0],
        closeGlyph: at('.convai-island__close svg')[0],
        badge: at('.convai-island__badge')[0],
      };
    });
}

const end = (p: Part | undefined) => (p ? p.x + p.w : NaN);
const bottom = (p: Part | undefined) => (p ? p.y + p.h : NaN);

for (const [scale, band, inset, right, action] of [
  ['1', 40, 16, 6, 28],
  ['1.15', 44, 17, 7, 31],
  ['1.3', 48, 18, 8, 34],
] as const) {
  test(`a toast draws as the kit’s at text ${scale}: band ${String(band)}, ${String(inset)} in, ${String(right)} from the right`, async ({
    page,
  }) => {
    await page.getByLabel('Text size').selectOption(scale);
    const toast = await parts(page, 'Toast');
    expect(toast.h).toBe(band);
    expect(toast.lead?.x).toBeCloseTo(inset, 1);
    // The dot, 8 to the words, 8 to the close glyph's 28 tool, then the right inset.
    expect((toast.words?.x ?? 0) - end(toast.lead)).toBeCloseTo(8, 1);
    expect((toast.close?.x ?? 0) - end(toast.words)).toBeCloseTo(8, 1);
    expect(toast.w - end(toast.close)).toBeCloseTo(right, 1);
    expect(toast.close?.w).toBe(28);
    expect(toast.closeGlyph?.w).toBe(12);

    const undo = await parts(page, 'Undo toast');
    expect(undo.words?.x).toBeCloseTo(inset, 1);
    expect(undo.acts[0]?.h).toBe(action);
    expect(undo.acts[0]?.y).toBe((band - action) / 2);
    expect(undo.actGlyph?.w).toBe(14);

    expect((undo.acts[0]?.x ?? 0) - end(undo.words)).toBeCloseTo(12, 1);
    expect((undo.close?.x ?? 0) - end(undo.acts[0])).toBeCloseTo(10, 1);
    expect(undo.w - end(undo.close)).toBeCloseTo(right, 1);

    const weak = await parts(page, 'Weak connection');
    expect(weak.lead?.x).toBeCloseTo(14, 1);

    // The loader form: Lens 24 at 10, then 10 between every part, 14 before the action.
    const offline = await parts(page, 'Persistent problem');
    expect(offline.lead?.x).toBeCloseTo(10, 1);
    expect((offline.words?.x ?? 0) - end(offline.lead)).toBeCloseTo(10, 1);
    expect((offline.acts[0]?.x ?? 0) - end(offline.words)).toBeCloseTo(14, 1);
    expect((offline.close?.x ?? 0) - end(offline.acts[0])).toBeCloseTo(12, 1);

    const dot = await parts(page, 'Minimized dot');
    expect(dot.w).toBe(band);
    expect(dot.badge).toMatchObject({ y: 4, h: 9 });
    expect(dot.w - end(dot.badge)).toBe(4);
  });

  test(`a banner draws as the kit’s at text ${scale}: 460, 16 18 in, 32-high actions`, async ({
    page,
  }) => {
    await page.getByLabel('Text size').selectOption(scale);
    for (const name of ['Banner · one action', 'Banner · two actions']) {
      const banner = await parts(page, name);
      expect(banner.w).toBe(460);
      expect(banner.radius).toBe(24);
      expect(banner.words).toMatchObject({ x: 18, y: 16 });
      expect(banner.close).toMatchObject({ x: 426, y: 6, w: 28, h: 28 });
      // The line 4 under the title.
      expect((banner.body?.y ?? 0) - bottom(banner.words)).toBeCloseTo(4, 1);
      for (const act of banner.acts) expect(act.h).toBe(32);
      const last = banner.acts.at(-1);
      expect(banner.w - end(last)).toBeCloseTo(18, 1);
      expect(banner.h - ((last?.y ?? 0) + 32)).toBeCloseTo(16, 1);
      expect((last?.y ?? 0) - ((banner.body?.y ?? 0) + (banner.body?.h ?? 0))).toBeCloseTo(12, 1);
    }
    const two = await parts(page, 'Banner · two actions');
    expect(two.acts.map((a) => [a.x, a.w])).toEqual([
      [18, 208],
      [234, 208],
    ]);
  });
}

test('a two-line toast keeps radius 20 and 16 in at every text size (N-FIT step 3)', async ({
  page,
}) => {
  for (const scale of ['1', '1.15', '1.3']) {
    await page.getByLabel('Text size').selectOption(scale);
    const toast = cell(page, 'Narrow · two lines').locator('.convai-island__surface');
    await expect(toast.locator('.convai-island__toast')).toHaveAttribute(
      'data-fit',
      /two-lines|brief/,
    );
    if ((await toast.locator('[data-fit="two-lines"]').count()) === 0) continue;
    expect(await toast.evaluate((e) => getComputedStyle(e).borderTopLeftRadius)).toBe('20px');
    // 16 in from the outer edge at every size (the kit's padding 11 16).
    const inset = await toast.evaluate((e) => {
      const mark = e.querySelector('.convai-island__mark');
      return mark ? mark.getBoundingClientRect().left - e.getBoundingClientRect().left : NaN;
    });
    expect(inset).toBeCloseTo(16, 1);
  }
});

test('a banner binds "the" to its next word and keeps no lone last word', async ({ page }) => {
  await page.getByLabel('Text size').selectOption('1.3');
  const body = cell(page, 'Banner · one action').locator('.convai-island__body');
  const text = (await body.textContent()) ?? '';
  const nbsp = String.fromCharCode(160);
  expect(text).toContain(`the${nbsp}service`);
  expect(text).toContain(`is${nbsp}back.`);
});
