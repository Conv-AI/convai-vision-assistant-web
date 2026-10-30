import { expect, test, type Locator, type Page } from '@playwright/test';
import { emit, fakeRecord, openApp } from './fakeConvai';

const capsule = (page: Page) => page.locator('.convai-capsule');
const panel = (page: Page) => page.getByRole('region', { name: 'Transcript' });

const first = {
  q: 'What is this?',
  a: 'A ceramic mug. Matte glaze outside, glossy inside. It looks hand-thrown.',
};
const second = {
  q: 'Is it microwave safe?',
  a: 'Most likely. It’s glazed stoneware with no metal rim. Check the base for a microwave symbol to be sure.',
};

let replies = 0;

async function live(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page);
  await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
}

async function ask(page: Page, question: string) {
  await page.keyboard.press('/');
  await expect(page.getByRole('textbox', { name: 'Message Kira' })).toBeFocused();
  await page.keyboard.type(question);
  await page.keyboard.press('Enter');
}

async function turn(page: Page, { q, a }: { q: string; a: string }, end = true) {
  await ask(page, q);
  const id = `t${String(++replies)}`;
  await emit(page, { type: 'activity', activity: 'thinking' });
  await emit(page, { type: 'reply', id, text: a, streaming: false });
  await emit(page, { type: 'activity', activity: 'speaking' });
  if (end) await emit(page, { type: 'activity', activity: 'idle' });
}

async function box(locator: Locator) {
  const found = await locator.boundingBox();
  if (!found) throw new Error('not laid out');
  return found;
}

/** A computed style of the element, read in the page. */
function css(locator: Locator, property: string) {
  return locator.evaluate(
    (element, name) => getComputedStyle(element).getPropertyValue(name),
    property,
  );
}

function style(page: Page, value: 'conversation' | 'continuum') {
  return page.addInitScript((s) => {
    window.localStorage.setItem('va.transcript-style', s);
  }, value);
}

test('the empty transcript is the kit’s title alone (T1)', async ({ page }) => {
  await live(page);
  const empty = panel(page).locator('.va-transcript__empty');
  await expect(empty).toHaveText('No conversation yet');
  await expect(empty.locator('svg')).toHaveCount(0);
  // Centred in the panel's body, 15/600.
  const title = empty.getByText('No conversation yet');
  expect(await css(title, 'font-size')).toBe('15px');
  expect(await css(title, 'font-weight')).toBe('600');
  // The pinned panel's 1 px edge on every side, as the kit's sheet draws it: a border, so the
  // content starts inside it (the header's hairline at 44 + 1).
  expect(await css(panel(page), 'border-left-width')).toBe('1px');
  expect(await css(panel(page), 'border-bottom-width')).toBe('1px');
  const sheet = await box(panel(page));
  const header = await box(panel(page).locator('.va-transcript__header'));
  expect(header.x - sheet.x).toBe(1);
  expect(header.y - sheet.y).toBe(1);
  const body = await box(empty);
  const words = await box(title);
  expect(Math.abs(words.y + words.height / 2 - (body.y + body.height / 2))).toBeLessThan(2);
});

test('a failed turn says so under the whole moment, the list’s width wide (T2)', async ({
  page,
}) => {
  await live(page);
  await turn(page, first);
  await ask(page, second.q);
  await emit(page, { type: 'question-failed' });

  const moment = panel(page).locator('.va-moment').last();
  const failed = moment.locator('.va-moment__failed');
  await expect(failed).toHaveAttribute('role', 'alert');
  await expect(failed).toContainText('Kira couldn’t answer this one.');
  // Not inside the question's column: it stands under the row, from the list's left.
  await expect(moment.locator('.va-moment__body .va-moment__failed')).toHaveCount(0);
  const list = await box(panel(page).locator('.va-transcript__list'));
  const row = await box(moment.locator('.va-moment__row'));
  const dot = await box(failed.locator('.va-dot'));
  const retry = failed.getByRole('button', { name: 'Try again' });
  const button = await box(retry);
  expect(dot.x).toBeCloseTo(row.x, 0);
  // Try again ends at the list's right inset (16), 32 high, 12 under the moment's row.
  expect(button.x + button.width).toBeCloseTo(list.x + list.width - 16, 0);
  expect(button.height).toBe(32);
  expect(button.y - (row.y + row.height)).toBeCloseTo(12, 0);
  // The line is 13 and reads at 72 % of the primary text (kit .cv-tx__mfail).
  const line = failed.getByText('Kira couldn’t answer this one.');
  expect(await css(line, 'font-size')).toBe('13px');
  expect(await css(line, 'color')).toMatch(/0\.72\)$/);
  // One line beside its button in the 380 column.
  expect((await box(line)).height).toBeLessThan(20);

  // Said once: drawn again (another style and back), the old failure is no alert.
  await panel(page)
    .getByRole('button', { name: /Transcript style/ })
    .click();
  await page.getByRole('menuitemradio', { name: 'Conversation' }).click();
  await panel(page)
    .getByRole('button', { name: /Transcript style/ })
    .click();
  await page.getByRole('menuitemradio', { name: 'Moments' }).click();
  await expect(failed).toBeVisible();
  await expect(failed).not.toHaveAttribute('role', 'alert');
  // Asked again and failing again, it is a new alert.
  await failed.getByRole('button', { name: 'Try again' }).click();
  await emit(page, { type: 'question-failed' });
  await expect(failed).toHaveAttribute('role', 'alert');
});

test('a failed turn in Conversation is the kit’s bubble and Ask again under it', async ({
  page,
}) => {
  await style(page, 'conversation');
  await live(page);
  await ask(page, second.q);
  await emit(page, { type: 'question-failed' });

  const reply = panel(page).locator('.va-bubbles__failed');
  await expect(reply).toHaveAttribute('role', 'alert');
  const bubble = reply.locator('.va-bubble--character');
  await expect(bubble).toHaveText('Kira: No answer. Something went wrong.');
  await expect(bubble).toHaveCSS('color', /0\.62\)$/);
  const again = reply.getByRole('button', { name: 'Ask again' });
  // Under the bubble, from its left (36 in: the avatar and its gap).
  const avatar = await box(reply.locator('.va-avatar'));
  const button = await box(again);
  expect(button.x - avatar.x).toBeCloseTo(36, 0);
  expect(button.y).toBeGreaterThanOrEqual((await box(bubble)).y + (await box(bubble)).height);
  expect(button.height).toBeGreaterThanOrEqual(44);
  await again.click();
  expect((await fakeRecord(page)).sent).toEqual([second.q, second.q]);
  await expect(reply).toHaveCount(0);
});

test('Conversation bubbles: Kira’s 260 at most, the avatar at its top, 16 apart (T4)', async ({
  page,
}) => {
  await style(page, 'conversation');
  await live(page);
  await turn(page, first);
  await turn(page, second, false);

  const turns = panel(page).locator('.va-bubbles');
  await expect(turns).toHaveCount(2);
  const you = await box(turns.first().locator('.va-bubble--you'));
  const reply = turns.first().locator('.va-bubble--character');
  const kira = await box(reply);
  const avatar = await box(turns.first().locator('.va-avatar'));
  expect(kira.width).toBeLessThanOrEqual(260);
  expect(kira.width).toBeGreaterThan(200);
  expect(avatar.y).toBeCloseTo(kira.y, 0);
  expect(kira.x - (avatar.x + avatar.width)).toBeCloseTo(8, 0);
  expect(kira.y - (you.y + you.height)).toBeCloseTo(16, 0);
  const next = await box(turns.nth(1).locator('.va-bubble--you'));
  expect(next.y - (kira.y + kira.height)).toBeCloseTo(16, 0);
  // Radius 16, the tail 4 at the corner nearest its speaker; padding 9 12.
  expect(await css(reply, 'border-radius')).toBe('16px 16px 16px 4px');
  expect(await css(turns.first().locator('.va-bubble--you'), 'border-radius')).toBe(
    '16px 16px 4px',
  );
  expect(await css(reply, 'padding')).toBe('9px 12px');
  // The kit's 15 with its normal line height; the list's foot is 16.
  expect(await css(reply, 'line-height')).toBe('normal');
  const list = await box(panel(page).locator('.va-transcript__list'));
  const last = await box(turns.nth(1).locator('.va-bubble--character'));
  expect(list.y + list.height - (last.y + last.height)).toBeCloseTo(16, 0);
});

test('Continuum stands at the stage’s left, 116 over its foot, the newest turn larger (T5)', async ({
  page,
}) => {
  await style(page, 'continuum');
  await live(page);
  await turn(page, first);
  await turn(page, second, false);

  const stage = await box(page.locator('.va-stage'));
  const turns = page.locator('.va-continuum__turn');
  await expect(turns).toHaveCount(2);
  const older = turns.first();
  const newest = turns.last();
  const olderBox = await box(older);
  const newestBox = await box(newest);
  expect(olderBox.x).toBeCloseTo(stage.x + 48, 0);
  expect(newestBox.x).toBeCloseTo(stage.x + 48, 0);
  expect(stage.y + stage.height - (newestBox.y + newestBox.height)).toBeCloseTo(116, 0);
  expect(newestBox.y - (olderBox.y + olderBox.height)).toBeCloseTo(18, 0);
  await expect(newest.locator('.va-continuum__answer')).toHaveCSS('text-align', 'start');
  expect(await css(older.locator('.va-continuum__question'), 'font-size')).toBe('15px');
  expect(await css(older.locator('.va-continuum__answer'), 'font-size')).toBe('17px');
  expect(await css(newest.locator('.va-continuum__question'), 'font-size')).toBe('17px');
  expect(await css(newest.locator('.va-continuum__answer'), 'font-size')).toBe('22px');
  // Only the older answer steps back; questions are secondary text throughout.
  await expect(older.locator('.va-continuum__answer')).toHaveCSS('opacity', '0.8');
  await expect(newest.locator('.va-continuum__answer')).toHaveCSS('opacity', '1');
  // Drawn at the optical size of each size, as the kit's text is; no tightening.
  for (const [part, size] of [
    [older.locator('.va-continuum__question'), 15],
    [older.locator('.va-continuum__answer'), 17],
    [newest.locator('.va-continuum__question'), 17],
    [newest.locator('.va-continuum__answer'), 22],
  ] as const) {
    expect(await css(part, 'font-variation-settings')).toBe(`"opsz" ${String(size)}`);
    expect(await css(part, 'letter-spacing')).toBe('normal');
    expect(await css(part, 'line-height')).toBe('normal');
  }
});

test('under 960 the stage captions the reply, its question at 72 % (T6)', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 720 });
  await openApp(page);
  await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
  // The bar's Transcript tool stands in for the column; the stage captions the reply.
  await expect(page.locator('.va-bar').getByRole('button', { name: /^Transcript/ })).toBeVisible();
  await turn(page, second, false);
  const question = page.locator('.va-captions__question');
  await expect(question).toHaveText(second.q);
  expect(await css(question, 'color')).toMatch(/0\.72\)$/);
  expect(await css(question, 'font-size')).toBe('17px');
});
