import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { answer, fakeRecord, openApp } from './fakeConvai';

const characters = [{ id: 'setup-character', name: 'Setup character', languages: ['en-US'] }];

test('completes welcome and accepts text without device media APIs', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'permissions', { value: undefined, configurable: true });
  });
  await openApp(page, { firstRun: true });
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByRole('radio', { name: /Push to talk/ }).click();
  await page.getByRole('button', { name: 'Continue with Push to talk' }).click();
  for (let step = 0; step < 6; step++) {
    const start = page.getByRole('button', { name: 'Start', exact: true });
    if (await start.count()) {
      await start.click();
      break;
    }
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  await expect(page.locator('.convai-capsule')).toHaveAttribute('data-state', 'ready');
  await page.keyboard.press('/');
  await page.getByRole('textbox', { name: 'Message Kira' }).fill('Can I use text?');
  await page.getByRole('textbox', { name: 'Message Kira' }).press('Enter');
  await answer(page, 'Text works without device media access.');
  await expect(page.locator('.va-turn__reply')).toHaveText(
    'Text works without device media access.',
  );
  expect(errors).toEqual([]);
});

async function failList(page: Page, status: number, error: string) {
  await openApp(page, { firstRun: true }, []);
  await page.route('**/api/characters', (route) => route.fulfill({ status, json: { error } }));
  await page.reload();
}

test('explains a missing key instead of reporting an empty account', async ({ page }) => {
  await failList(
    page,
    500,
    'CONVAI_API_KEY is not set. Add it to .env.local and restart pnpm dev.',
  );
  await expect(page.getByRole('alert')).toContainText('Add it to .env.local and restart pnpm dev.');
  await expect(page.getByText('No characters available')).toHaveCount(0);
  expect((await fakeRecord(page)).connects).toBe(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('explains an invalid key and recovers after the account configuration is fixed', async ({
  page,
}) => {
  await failList(
    page,
    502,
    'Convai refused the character list request (HTTP 401). Check your API key.',
  );
  await expect(page.getByRole('alert')).toContainText('Check your API key.');
  await page.route('**/api/characters', (route) => route.fulfill({ json: { characters } }));
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.convai-capsule')).toHaveAttribute('data-state', 'ready');
  expect((await fakeRecord(page)).connects).toBe(1);
});

test('helps an empty account create a character and reload the list', async ({ page }) => {
  await openApp(page, {}, []);
  await expect(page.getByText('Create a character to get started')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Convai account' })).toHaveAttribute(
    'href',
    'https://convai.com/',
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.route('**/api/characters', (route) => route.fulfill({ json: { characters } }));
  await page.getByRole('button', { name: 'Reload characters' }).click();
  await expect(page.locator('.convai-capsule')).toHaveAttribute('data-state', 'ready');
});

test('times out a stalled character request and starts a fresh request on retry', async ({
  page,
}) => {
  await openApp(page, { firstRun: true }, []);
  await page.route('**/api/characters', () => undefined);
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Loading characters took too long', {
    timeout: 15_000,
  });
  await page.route('**/api/characters', (route) => route.fulfill({ json: { characters } }));
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.convai-capsule')).toHaveAttribute('data-state', 'ready');
  expect((await fakeRecord(page)).connects).toBe(1);
});

test('shows a token setup error without exposing credentials', async ({ page }) => {
  await openApp(page);
  await page.route('**/api/token', (route) =>
    route.fulfill({ status: 502, json: { error: 'Check CONVAI_API_KEY in .env.local.' } }),
  );
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Check CONVAI_API_KEY in .env.local.');
  expect((await fakeRecord(page)).connects).toBe(0);
});
