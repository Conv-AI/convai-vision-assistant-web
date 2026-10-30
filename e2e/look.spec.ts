import { expect, test, type Page } from '@playwright/test';
import { emit, openApp } from './fakeConvai';
import { fakePicker } from './fakeDisplay';
import { storedTextSize } from './textSize';
import { engineOf } from './engines';

const chip = (page: Page) => page.locator('.va-chip');
const menu = (page: Page) => page.getByRole('menu', { name: 'What Kira sees' });

async function live(page: Page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await openApp(page);
  await expect(page.locator('.convai-capsule')).toHaveAttribute('data-state', 'ready');
}

async function shareCamera(page: Page) {
  await chip(page).click();
  await menu(page)
    .getByRole('group', { name: 'Camera' })
    .getByRole('menuitemradio')
    .first()
    .click();
  await expect(chip(page).locator('.va-chip__slot')).toHaveAttribute('data-mark', 'live');
}

test('the camera stands under its top and bottom scrim (VAWindow › Stage)', async ({ page }) => {
  await live(page);
  await shareCamera(page);
  const scrim = page.locator('.va-camera__scrim');
  await expect(scrim).toHaveCSS('background-image', /linear-gradient/);
  // Black 35 % at the top, 72 % at the foot.
  await expect(scrim).toHaveCSS('background-image', /rgba\(0, 0, 0, 0\.35\) 0%/);
  await expect(scrim).toHaveCSS('background-image', /rgba\(0, 0, 0, 0\.72\) 100%/);
});

test('under the transcript sheet the camera is not drawn, and the capsule stands 28 in', async ({
  page,
}) => {
  await live(page, 600, 640);
  await shareCamera(page);
  await page.keyboard.press('/');
  await page.keyboard.type('What is this?');
  await page.keyboard.press('Enter');
  await emit(page, { type: 'reply', id: 'r1', text: 'A mug.', streaming: false });
  await emit(page, { type: 'activity', activity: 'idle' });
  await page.keyboard.press('r');
  await expect(page.locator('.va-transcript--sheet')).toBeVisible();
  await expect(page.locator('.va-camera')).toHaveCSS('visibility', 'hidden');
  const stage = await page.locator('.va-stage').boundingBox();
  const capsule = await page.locator('.convai-capsule').boundingBox();
  expect(stage && capsule).toBeTruthy();
  if (stage && capsule) {
    expect(Math.round(capsule.x - stage.x)).toBe(28);
    expect(Math.round(stage.x + stage.width - (capsule.x + capsule.width))).toBe(28);
  }
});

test('the transcript header has its hairline and the picker its capsule (SheetHeader)', async ({
  page,
}) => {
  await live(page);
  await expect(page.locator('.va-transcript__header')).toHaveCSS(
    'box-shadow',
    'rgba(255, 255, 255, 0.08) 0px -1px 0px 0px inset',
  );
  const picker = page.locator('.va-transcript__style');
  await expect(picker).toHaveCSS('height', '28px');
  await expect(picker).toHaveCSS('font-weight', '600');
  await expect(picker).toHaveCSS('font-size', '12px');
});

test('the chips carry their chevrons, and an open source menu turns its chevron up', async ({
  page,
}) => {
  await live(page);
  await expect(page.locator('.va-bar__character .va-bar__chevron')).toBeVisible();
  const chevron = chip(page).locator('.va-chip__chevron');
  await expect(chevron).toHaveCSS('transform', 'none');
  await chip(page).click();
  await expect(menu(page)).toBeVisible();
  // rotate(180deg)
  await expect(chevron).toHaveCSS('transform', /^matrix\(-1, 0, 0, -1/);
});

test('menus are solid: nothing behind reads through', async ({ page }) => {
  await live(page);
  await chip(page).click();
  const source = page.locator('.va-source-menu');
  await expect(source).toHaveCSS('background-image', /linear-gradient/);
  await expect(source).toHaveCSS('background-color', 'rgb(10, 10, 12)');
});

test('the share card is an ask dialog: Cancel a text button, the body one paragraph', async ({
  page,
}) => {
  await fakePicker(page, ['browser']);
  await live(page);
  await chip(page).click();
  await menu(page).getByRole('menuitemradio', { name: 'Browser tab…' }).click();
  const card = page.getByRole('alertdialog');
  await expect(card).toBeVisible();
  await expect(card.getByRole('button', { name: 'Cancel' })).toHaveClass(/convai-button--text/);
  await expect(card.locator('.convai-dialog__body > *')).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Continue' })).toHaveCSS('height', '36px');
});

test('the bar’s round tools are fill alone, 12 apart, and an open panel’s tool stands at 18 %', async ({
  page,
}) => {
  await live(page, 940, 720);
  const gear = page.getByRole('button', { name: 'Settings' });
  await expect(gear).toHaveCSS('box-shadow', 'none');
  const transcript = page.locator('.va-bar__tools').getByRole('button', { name: /^Transcript/ });
  await transcript.click();
  await expect(transcript).toHaveAttribute('aria-pressed', 'true');
  await expect(transcript).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.18)');
  await expect(page.locator('.va-bar__tools')).toHaveCSS('column-gap', '12px');
});

test('the source menu is the kit’s menu: edge.strong inside, inset 4 within it', async ({
  page,
}) => {
  await live(page);
  await chip(page).click();
  const source = page.locator('.va-source-menu');
  await expect(source).toHaveCSS('padding-top', '5px');
  await expect(source).toHaveCSS(
    'box-shadow',
    /rgba\(255, 255, 255, 0\.12\) 0px 0px 0px 1px inset/,
  );
});

test('the transcript’s foot: the newest answer ends 16 above the panel’s foot', async ({
  page,
}) => {
  await live(page);
  await page.keyboard.press('/');
  await page.keyboard.type('What is this?');
  await page.keyboard.press('Enter');
  await emit(page, { type: 'reply', id: 'r1', text: 'A mug.', streaming: false });
  await emit(page, { type: 'activity', activity: 'idle' });
  await expect(page.locator('.va-transcript__list')).toHaveCSS('padding-bottom', '16px');
  await expect(page.locator('.va-moment__body').first()).toHaveCSS('row-gap', '4px');
});

test('the condensed capsule’s talk key is a 22 cap with its edge', async ({ page }) => {
  await live(page, 760, 720);
  await page.keyboard.press('/');
  await page.keyboard.type('What is this?');
  await page.keyboard.press('Enter');
  await emit(page, { type: 'reply', id: 'r1', text: 'A mug.', streaming: false });
  await emit(page, { type: 'activity', activity: 'idle' });
  await page.keyboard.press('r');
  const cap = page.locator('.convai-capsule--compact .convai-capsule__key .convai-key-cap');
  await expect(cap).toHaveCSS('height', '22px');
  await expect(cap).toHaveCSS('box-shadow', /inset/);
});

test('the Window tile shows no chevron at rest', async ({ page }) => {
  await live(page, 600, 800);
  await page.keyboard.press('q');
  await page.mouse.move(0, 0);
  const chevron = page.locator('[data-tile="window"] .va-quick__chevron');
  await expect(chevron).toHaveCSS('opacity', '0');
});

test('at text 1.30 the header’s title grows and its picker stays 12 (SheetHeader)', async ({
  page,
}) => {
  await storedTextSize(page, 1.3);
  await live(page);
  // 14 × 1.30. Firefox rounds a computed font size to a coarser step: 18.1875.
  const title = await page
    .locator('.va-transcript__title')
    .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
  expect(title).toBeCloseTo(18.2, engineOf(page) === 'firefox' ? 1 : 3);
  await expect(page.locator('.va-transcript__style')).toHaveCSS('font-size', '12px');
  await expect(page.locator('.va-transcript__header')).toHaveCSS('height', '44px');
});
