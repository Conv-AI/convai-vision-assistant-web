import { expect, test, type Page } from '@playwright/test';
import { closeFloatingWindow, closeFloatingWindows, enterCompact } from './compact';
import { answer, emit, openApp } from './fakeConvai';
import { fakeNotify, notifyRecord, setHidden } from './fakeNotify';
import { limits, skipIn } from './engines';

test.afterEach(async ({ page }) => {
  await closeFloatingWindows(page);
});

const capsule = (page: Page) => page.locator('.convai-capsule');
const turns = (page: Page) => page.locator('.va-moment');

async function live(page: Page) {
  await openApp(page);
  await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
}

async function ask(page: Page, question: string) {
  await page.keyboard.press('/');
  await page.keyboard.type(question);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Message Kira' })).toBeHidden();
}

const reply = 'A ceramic mug. Matte glaze outside.\nIt looks hand-thrown.';

test('a typed question answered while the tab is hidden: one notification, gone on return', async ({
  page,
}) => {
  await fakeNotify(page, 'granted');
  await live(page);
  await ask(page, 'What is this?');
  await setHidden(page, true);
  await answer(page, reply);
  await expect
    .poll(async () => (await notifyRecord(page)).made)
    .toEqual([
      {
        title: 'Kira replied',
        body: 'A ceramic mug. Matte glaze outside.',
        tag: 'va-reply',
        closed: false,
      },
    ]);
  await setHidden(page, false);
  await expect.poll(async () => (await notifyRecord(page)).made[0]?.closed).toBe(true);
});

test('a click on it brings the tab forward and closes it', async ({ page }) => {
  await fakeNotify(page, 'granted');
  await live(page);
  await ask(page, 'What is this?');
  await setHidden(page, true);
  await answer(page, reply);
  await expect.poll(async () => (await notifyRecord(page)).made.length).toBe(1);
  await page.evaluate(() => window.fakeNotify?.click(0));
  const record = await notifyRecord(page);
  expect(record.focused).toBe(1);
  expect(record.made[0]?.closed).toBe(true);
});

test('nothing for a spoken question, or for a typed one answered in view', async ({ page }) => {
  await fakeNotify(page, 'granted');
  await live(page);
  await ask(page, 'What is this?');
  await answer(page, reply);
  await expect(turns(page)).toHaveCount(1);
  await setHidden(page, true);
  await emit(page, { type: 'question', text: 'And this?' });
  await answer(page, 'A teapot.');
  await expect(turns(page)).toHaveCount(2);
  await page.waitForTimeout(300);
  expect((await notifyRecord(page)).made).toEqual([]);
});

test('nothing when the permission was refused', async ({ page }) => {
  await fakeNotify(page, 'default', 'denied');
  await live(page);
  await ask(page, 'What is this?');
  await setHidden(page, true);
  await answer(page, reply);
  await expect(turns(page)).toHaveCount(1);
  await page.waitForTimeout(300);
  const record = await notifyRecord(page);
  expect(record.asked).toEqual([true]);
  expect(record.made).toEqual([]);
});

test('the permission is asked in the first typed question’s press, once, never at start', async ({
  page,
}) => {
  await fakeNotify(page, 'default', 'default');
  await live(page);
  await page.waitForTimeout(300);
  expect((await notifyRecord(page)).asked).toEqual([]);
  await ask(page, 'What is this?');
  // Asked while the Return press was still active: a browser that needs a gesture shows it.
  expect((await notifyRecord(page)).asked).toEqual([true]);
  await answer(page, reply);
  await ask(page, 'And this?');
  expect((await notifyRecord(page)).asked).toEqual([true]);
  // A later visit: dismissed once, it is not asked again.
  await page.reload();
  await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
  await ask(page, 'Once more?');
  expect((await notifyRecord(page)).asked).toEqual([]);
});

test('nothing while the floating window shows the answer; once it is closed, one again', async ({
  page,
}) => {
  skipIn(page, ['webkit'], limits.noPip);
  await fakeNotify(page, 'granted');
  await live(page);
  await ask(page, 'What is this?');
  const pip = await enterCompact(page);
  await setHidden(page, true);
  await answer(page, reply);
  await expect(turns(page)).toHaveCount(1);
  await page.waitForTimeout(300);
  expect((await notifyRecord(page)).made).toEqual([]);

  await closeFloatingWindow(pip);
  await expect(page.getByRole('button', { name: 'Compact', exact: true })).toBeVisible();
  await setHidden(page, false);
  await ask(page, 'And this?');
  await setHidden(page, true);
  await answer(page, 'A teapot.');
  await expect
    .poll(async () => (await notifyRecord(page)).made.map((n) => n.body))
    .toEqual(['A teapot.']);
});
