import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/gallery.html');
  await expect(page.getByRole('heading', { name: 'Buttons' })).toBeVisible();
});

test('a primary button lightens under the pointer and darkens when pressed', async ({ page }) => {
  const allow = page.getByRole('group', { name: 'Primary' }).getByRole('button').first();
  await expect(allow).toHaveCSS('background-color', 'rgb(246, 248, 250)');
  await allow.hover();
  await expect(allow).toHaveCSS('background-color', 'rgb(224, 225, 228)');
  await page.mouse.down();
  await expect(allow).toHaveCSS('background-color', 'rgb(221, 225, 229)');
  await page.mouse.up();
});

test('a disabled button has no fill and an edge.disabled outline', async ({ page }) => {
  const cancel = page.getByRole('group', { name: 'Secondary' }).getByRole('button').nth(4);
  await expect(cancel).toBeDisabled();
  await expect(cancel).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(cancel).toHaveCSS('box-shadow', 'rgba(255, 255, 255, 0.1) 0px 0px 0px 1px inset');
  await expect(cancel).toHaveCSS('color', 'rgba(246, 248, 250, 0.4)');
});

test('a small button takes a press over 44 px', async ({ page }) => {
  const small = page.getByRole('button', { name: 'Small' });
  await small.scrollIntoViewIfNeeded();
  const box = await small.boundingBox();
  if (!box) throw new Error('no box');
  expect(Math.round(box.height)).toBe(28);
  // 7 px above and below the drawn button still press it: (44 - 28) / 2 = 8.
  const hits = await page.evaluate(
    ({ x, top, bottom }) =>
      [top - 7, bottom + 7].map(
        (y) => document.elementFromPoint(x, y)?.closest('button')?.textContent,
      ),
    { x: box.x + box.width / 2, top: box.y, bottom: box.y + box.height },
  );
  expect(hits).toEqual(['Small', 'Small']);
});

test('a button disabled with a reason stays in the Tab order and reads its reason', async ({
  page,
}) => {
  const proceed = page.getByRole('button', { name: 'Continue' });
  await proceed.focus();
  await expect(proceed).toBeFocused();
  await expect(proceed).toHaveAttribute('aria-disabled', 'true');
  await expect(proceed).toHaveAccessibleDescription('Allow the microphone to continue');
});

test('an icon button shows its name at once on keyboard focus, and Esc closes it', async ({
  page,
}) => {
  const icon = page.getByRole('group', { name: 'Icon' }).getByRole('button').first();
  await icon.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(icon).toBeFocused();
  await expect(page.getByRole('tooltip', { includeHidden: true })).toHaveText('Transcript');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip', { includeHidden: true })).toHaveCount(0);
});

test('under the pointer a tooltip waits 600 ms', async ({ page }) => {
  // The page's clock paused, so the wait is the tooltip's alone: in real time a loaded machine had
  // let 600 ms pass before the test looked. Installed at the epoch, the pause at today is a jump
  // forward that no delay turns into the past.
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(Date.now());
  const icon = page.getByRole('group', { name: 'Icon' }).getByRole('button').first();
  await icon.hover();
  await page.clock.runFor(590);
  await expect(page.getByRole('tooltip', { includeHidden: true })).toHaveCount(0);
  await page.clock.runFor(20);
  await expect(page.getByRole('tooltip', { includeHidden: true })).toHaveText('Transcript');
});

test('the spinner holds still as a ring under Reduce Motion', async ({ page }) => {
  const arc = page.locator('.convai-button--loading .convai-spinner__arc').first();
  await expect(arc).toBeVisible();
  await page.getByLabel('Reduce motion').selectOption('on');
  await expect(arc).toBeHidden();
  await expect(page.locator('.convai-spinner__ring').first()).toHaveCSS('opacity', '0.6');
});

test('a loading button shows no press', async ({ page }) => {
  const working = page.getByRole('group', { name: 'Secondary' }).getByRole('button').nth(5);
  await working.hover();
  await page.mouse.down();
  await expect(working).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.08)');
  await page.mouse.up();
});

test('a toggle that is on is filled, dimmed when disabled, and edged under high contrast', async ({
  page,
}) => {
  const toggles = page.getByRole('group', { name: 'Toggles' });
  const on = toggles.getByRole('button', { name: 'Unmute', pressed: true }).first();
  await expect(on).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.14)');
  const dimmed = toggles.getByRole('button', { name: 'Unmute' }).last();
  // fill.selected at 40 % (5.6 %), as the browser keeps it in 8 bits.
  await expect(dimmed).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.055)');
  await page.getByLabel('Increase contrast').selectOption('on');
  await expect(on).toHaveCSS('box-shadow', 'rgba(255, 255, 255, 0.5) 0px 0px 0px 1px inset');
});

test('a cut label shows its whole text after 600 ms, and a whole one shows none', async ({
  page,
}) => {
  const cut = page.getByRole('group', { name: 'Cut labels' }).getByRole('button').first();
  await cut.hover();
  await expect(page.getByRole('tooltip', { includeHidden: true })).toHaveText(
    'Vision Assistant – Quarterly planning notes for the design review.docx',
  );
  await page.getByRole('button', { name: 'Notes.docx' }).hover();
  await page.waitForTimeout(800);
  await expect(page.getByRole('tooltip', { includeHidden: true })).toHaveCount(0);
});

test('under high contrast a tooltip stands 8 clear of the 3 px focus ring', async ({ page }) => {
  await page.getByLabel('Increase contrast').selectOption('on');
  const icon = page.getByRole('group', { name: 'Icon' }).getByRole('button').first();
  await icon.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  const tip = page.getByRole('tooltip', { includeHidden: true });
  await expect(tip).toBeVisible();
  const [button, box] = await Promise.all([icon.boundingBox(), tip.boundingBox()]);
  if (!button || !box) throw new Error('no box');
  // 8 + a 3 px ring + its 2 px gap.
  expect(Math.round(button.y - (box.y + box.height))).toBe(13);
});

test('in a Windows contrast theme every button keeps a border', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  const cancel = page.getByRole('group', { name: 'Secondary' }).getByRole('button').first();
  await expect(cancel).toHaveCSS('border-top-width', '1px');
  await expect(cancel).not.toHaveCSS('border-top-style', 'none');
});
