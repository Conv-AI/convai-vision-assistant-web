import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { fakeRecord, openApp, type ApiCharacter, type FakeOptions } from './fakeConvai';
import { engineOf, limits, skipIn } from './engines';

const kira: ApiCharacter = { id: 'kira-1', name: 'Kira', languages: ['en-US'] };
const elena: ApiCharacter = { id: 'elena-2', name: 'Elena', languages: ['es-ES', 'en-US'] };
const marcus: ApiCharacter = { id: 'marcus-3', name: 'Marcus', languages: ['de-DE'] };
const three = [kira, elena, marcus];

const capsule = (page: Page) => page.locator('.convai-capsule');
const picker = (page: Page) => page.locator('dialog.va-picker');
const chip = (page: Page) => page.locator('.va-bar__character');
const card = (page: Page, name: string) =>
  picker(page).locator('.va-card', { has: page.getByText(name, { exact: true }) });

async function live(page: Page, characters: ApiCharacter[] = three, options: FakeOptions = {}) {
  await openApp(page, options, characters);
  await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
}

async function openPicker(page: Page) {
  await chip(page).click();
  await expect(picker(page)).toBeVisible();
}

test.describe('the character chip', () => {
  test('names who is listening and opens the picker on the current card (C1)', async ({ page }) => {
    await live(page);
    await expect(chip(page)).toHaveAccessibleName(/^Kira ?, Characters$/);
    await expect(chip(page)).toHaveAttribute('aria-expanded', 'false');
    await openPicker(page);

    await expect(chip(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(picker(page).getByRole('heading', { name: 'Characters' })).toBeVisible();
    await expect(
      picker(page).getByRole('searchbox', { name: 'Search characters' }),
    ).toHaveAttribute('placeholder', 'Search 3 characters');

    const names = await picker(page).locator('.va-card__name').allTextContents();
    expect(names).toEqual(['Kira', 'Elena', 'Marcus']);
    await expect(card(page, 'Kira')).toBeFocused();
    await expect(card(page, 'Kira')).toContainText('Talking now');
    await expect(card(page, 'Elena')).not.toContainText('Talking now');
    // Only one card is a Tab stop; the arrows move between them.
    await expect(picker(page).locator('.va-card[tabindex="0"]')).toHaveCount(1);
  });

  test('closes on Esc, on Close and on the scrim, giving the focus back to the chip', async ({
    page,
  }) => {
    await live(page);
    await openPicker(page);
    await page.keyboard.press('Escape');
    await expect(picker(page)).toHaveCount(0);
    await expect(chip(page)).toBeFocused();

    await openPicker(page);
    await picker(page).getByRole('button', { name: 'Close' }).click();
    await expect(picker(page)).toHaveCount(0);

    await openPicker(page);
    await page.mouse.click(8, 400);
    await expect(picker(page)).toHaveCount(0);
  });

  test('opens and closes with Ctrl K, from the Type field too', async ({ page }) => {
    await live(page);
    await page.keyboard.press('Control+k');
    await expect(picker(page)).toBeVisible();
    await page.keyboard.press('Control+k');
    await expect(picker(page)).toHaveCount(0);

    await page.keyboard.press('/');
    await expect(page.getByRole('textbox', { name: 'Message Kira' })).toBeFocused();
    await page.keyboard.press('Control+k');
    await expect(picker(page)).toBeVisible();
    // Esc: the picker (the focus comes back to the chip, with no tooltip), then the Type field.
    await page.keyboard.press('Escape');
    await expect(chip(page)).toBeFocused();
    await expect(page.locator('.convai-tooltip')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
    // The window's letters wait while the picker is open.
    await page.keyboard.press('Control+k');
    await card(page, 'Kira').press('m');
    await page.keyboard.press('Escape');
    await expect(picker(page)).toHaveCount(0);
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
  });

  test('keeps a long name whole at 560; the source chip gives way beside it', async ({ page }) => {
    const long: ApiCharacter = {
      id: 'long-1',
      name: 'Maximiliana Konstantinopoulou-Wetherby',
      languages: ['en-GB'],
    };
    await page.setViewportSize({ width: 560, height: 720 });
    await live(page, [long, elena]);
    await page.locator('.va-chip').click();
    await page.getByRole('group', { name: 'Camera' }).getByRole('menuitemradio').first().click();
    await expect(page.locator('.va-chip')).toHaveAttribute('aria-label', /Camera/);
    await page.mouse.move(280, 400);

    const name = page.locator('.va-bar__name');
    expect(await name.evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
    const character = await chip(page).boundingBox();
    const source = await page.locator('.va-chip').boundingBox();
    const tools = await page.locator('.va-bar__tools').boundingBox();
    if (!character || !source || !tools) throw new Error('The bar is not laid out.');
    expect(character.x + character.width + 12).toBeLessThanOrEqual(Math.round(source.x) + 0.5);
    expect(source.x + source.width + 12).toBeLessThanOrEqual(Math.round(tools.x) + 0.5);
    // The source menu opens from the slid chip and stays inside the window.
    await page.locator('.va-chip').click();
    const menu = page.getByRole('menu', { name: /^What .* sees$/ });
    await expect(menu).toBeVisible();
    const menuBox = await menu.boundingBox();
    if (!menuBox) throw new Error('The menu is not laid out.');
    expect(menuBox.x).toBeGreaterThanOrEqual(0);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(560);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    // With room beside the name, the chip stands centred on the bar again.
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect
      .poll(async () => {
        const box = await page.locator('.va-chip').boundingBox();
        return box ? Math.round(box.x + box.width / 2) : null;
      })
      .toBe(720);
  });

  test('is absent with no character configured', async ({ page }) => {
    await openApp(page, {}, []);
    await expect(capsule(page)).toHaveAttribute('data-state', 'no-character');
    await expect(chip(page)).toHaveCount(0);
    await page.keyboard.press('Control+k');
    await expect(picker(page)).toHaveCount(0);
  });
});

test.describe('the gallery', () => {
  test('moves between cards with the arrow keys', async ({ page }) => {
    await live(page);
    await openPicker(page);
    await page.keyboard.press('ArrowRight');
    await expect(card(page, 'Elena')).toBeFocused();
    await expect(card(page, 'Elena')).toHaveAttribute('tabindex', '0');
    await page.keyboard.press('End');
    await expect(card(page, 'Marcus')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(card(page, 'Kira')).toBeFocused();
  });

  test('searches names and languages live, with a count (C3)', async ({ page }) => {
    await live(page);
    await openPicker(page);
    const search = picker(page).getByRole('searchbox');
    await search.fill('ELE');
    await expect(picker(page).locator('.va-card__name')).toHaveText(['Elena']);
    await expect(picker(page).getByRole('status').first()).toHaveText('1 result');

    await search.fill('deutsch');
    await expect(picker(page).locator('.va-card__name')).toHaveText(['Marcus']);
    await search.fill('english');
    await expect(picker(page).locator('.va-card__name')).toHaveText(['Kira', 'Elena']);
    await expect(picker(page).getByText('2 results')).toBeVisible();
    // Down goes from the search to the first result.
    await page.keyboard.press('ArrowDown');
    await expect(card(page, 'Kira')).toBeFocused();
  });

  test('says when nothing matches (C4); Esc clears, a second Esc closes', async ({ page }) => {
    await live(page);
    await openPicker(page);
    const search = picker(page).getByRole('searchbox');
    await search.fill('astronomy');
    await expect(picker(page).getByText('No characters match “astronomy”')).toBeVisible();
    await expect(picker(page).getByText('Search looks at names and languages.')).toBeVisible();
    await expect(picker(page).locator('.va-card')).toHaveCount(0);

    const box = await picker(page).locator('.va-picker__message').boundingBox();
    const dialog = await picker(page).boundingBox();
    if (!box || !dialog) throw new Error('The message is not laid out.');
    expect(box.x - dialog.x).toBe(1 + 28);
    // Across the cards' width, which Chromium's scrollbar gutter sets (limits.scrollbar).
    if (engineOf(page) === 'chromium') expect(Math.round(box.width)).toBe(880 - 2 - 2 * 28);
    await expect(picker(page).getByRole('button', { name: 'Clear search' })).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    await expect(picker(page).locator('.va-card')).toHaveCount(3);
    await page.keyboard.press('Escape');
    await expect(picker(page)).toHaveCount(0);
  });

  test('is as tall as what it holds under 24 characters, and 640 from 24', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await live(page);
    await openPicker(page);
    const height = async () => Math.round((await picker(page).boundingBox())?.height ?? 0);

    const row = (await card(page, 'Kira').boundingBox())?.height ?? 0;
    expect(row).toBeGreaterThan(230);
    expect(await height()).toBe(Math.round(1 + 64 + 4 + row + 24 + 1));

    await picker(page).getByRole('searchbox').fill('astronomy');
    await expect(picker(page).getByText('No characters match “astronomy”')).toBeVisible();
    const message = await picker(page).locator('.va-picker__message').boundingBox();
    expect(await height()).toBe(Math.round(1 + 64 + 4 + (message?.height ?? 0) + 24 + 1));
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    const many = Array.from({ length: 26 }, (_, i) => ({
      id: `id-${String(i)}`,
      name: `${String.fromCharCode(65 + i)}ora`,
    }));
    await page.route('**/api/characters', (route) => route.fulfill({ json: { characters: many } }));
    await openPicker(page);
    await expect(picker(page).locator('.va-card')).toHaveCount(26);
    expect(await height()).toBe(640);
    await picker(page).getByRole('searchbox').fill('astronomy');
    await expect(picker(page).getByText('No characters match “astronomy”')).toBeVisible();
    expect(await height()).toBe(640);
  });

  test('gives the search the focus when Esc clears it from a card', async ({ page }) => {
    await live(page);
    await openPicker(page);
    const search = picker(page).getByRole('searchbox');
    await search.fill('e');
    await page.keyboard.press('ArrowDown');
    await expect(picker(page).locator('.va-card').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    await expect(picker(page)).toBeVisible();
  });

  test('lists 24 and more by name with letter captions, and hides them while searching', async ({
    page,
  }) => {
    const many = Array.from({ length: 26 }, (_, i) => {
      const letter = String.fromCharCode(90 - i);
      return { id: `id-${letter}`, name: letter === 'K' ? 'Kira' : `${letter}ora` };
    });
    await live(page, many);
    await openPicker(page);
    await expect(picker(page).getByRole('region', { name: 'All characters' })).toBeVisible();
    await expect(picker(page).getByRole('region', { name: 'Recent' })).toHaveCount(0);
    const names = await picker(page).locator('.va-card__name').allTextContents();
    expect(names[0]).toBe('Aora');
    expect(names.at(-1)).toBe('Zora');
    await expect(picker(page).locator('.va-picker__caption').first()).toHaveText('A');
    // On open the focus is still the current character's card: the first configured, Zora.
    await expect(card(page, 'Zora')).toBeFocused();
    await expect(card(page, 'Zora')).toContainText('Talking now');

    await picker(page).getByRole('searchbox').fill('ora');
    await expect(picker(page).getByText('25 results')).toBeVisible();
    await expect(picker(page).locator('.va-picker__caption')).toHaveCount(0);
  });

  test('opens on the Talking now card in Recent, which All characters lists again', async ({
    page,
  }) => {
    const many = Array.from({ length: 26 }, (_, i) => {
      const letter = String.fromCharCode(65 + i);
      return { id: `id-${letter}`, name: `${letter}ora` };
    });
    await page.addInitScript(() => {
      window.localStorage.setItem('va.recent-characters', JSON.stringify(['id-K', 'id-B']));
    });
    await live(page, many);
    await expect(chip(page)).toContainText('Kora');
    await openPicker(page);
    const recent = picker(page).getByRole('region', { name: 'Recent' });
    await expect(recent.locator('.va-card__name')).toHaveText(['Kora', 'Bora']);
    await expect(recent.locator('.va-card').first()).toBeFocused();
    // Down goes on to All characters in the same column; Up comes back.
    await page.keyboard.press('ArrowDown');
    const all = picker(page).getByRole('region', { name: 'All characters' });
    await expect(all.locator('.va-card').first()).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(recent.locator('.va-card').first()).toBeFocused();
  });
});

test.describe('the stage', () => {
  test('opens from a card with English language names (C2)', async ({ page }) => {
    await live(page);
    await openPicker(page);
    await card(page, 'Elena').click();

    await expect(picker(page).getByRole('heading', { name: 'Elena', level: 2 })).toBeVisible();
    const languages = picker(page).getByRole('list', { name: 'Speaks' }).getByRole('listitem');
    // The device's language first (the test browser is en-US), displayed in English.
    await expect(languages).toHaveText(['English', 'Spanish']);
    await expect(languages.nth(1)).toHaveAttribute('lang', 'en');
    const talk = picker(page).getByRole('button', { name: 'Talk to Elena' });
    await expect(talk).toBeFocused();
    // Nothing switches until Talk.
    expect((await fakeRecord(page)).characters).toEqual(['kira-1']);
    await expect(chip(page)).toContainText('Kira');
  });

  test('steps to the neighbours with ← and →, and Esc goes back to the card', async ({ page }) => {
    await live(page);
    await openPicker(page);
    await card(page, 'Elena').click();
    await page.keyboard.press('ArrowRight');
    await expect(picker(page).getByRole('heading', { name: 'Marcus' })).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(picker(page).getByRole('heading', { name: 'Marcus' })).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(picker(page).getByRole('heading', { name: 'Kira', level: 2 })).toBeVisible();
    // The current character's stage says so in place of Talk.
    await expect(picker(page).getByText('Talking now')).toBeVisible();
    await expect(picker(page).getByRole('button', { name: /Talk to/ })).toHaveCount(0);

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Escape');
    await expect(picker(page).getByRole('heading', { name: 'Characters' })).toBeVisible();
    await expect(card(page, 'Elena')).toBeFocused();
  });

  test('goes back with its Back button and moves with its dots', async ({ page }) => {
    await live(page);
    await openPicker(page);
    await card(page, 'Marcus').click();

    const dots = picker(page).getByRole('slider', { name: 'Character' });
    await expect(dots).toHaveAttribute('aria-valuetext', 'Marcus, 3 of 3');
    await expect(picker(page).locator('.va-character__dot')).toHaveCount(3);
    await picker(page).locator('.va-character__dot').first().click();
    await expect(picker(page).getByRole('heading', { name: 'Kira', level: 2 })).toBeVisible();
    await expect(dots).toHaveAttribute('aria-valuetext', 'Kira, 1 of 3');
    // On the row the keys step and the focus stays there: →, End, Home.
    await dots.focus();
    await page.keyboard.press('ArrowRight');
    await expect(dots).toHaveAttribute('aria-valuetext', 'Elena, 2 of 3');
    await page.keyboard.press('End');
    await expect(dots).toHaveAttribute('aria-valuetext', 'Marcus, 3 of 3');
    await page.keyboard.press('Home');
    await expect(dots).toHaveAttribute('aria-valuetext', 'Kira, 1 of 3');
    await expect(dots).toBeFocused();
    // Its press row is 44 high over a 32 capsule.
    const row = await dots.evaluate((el) => {
      const after = getComputedStyle(el, '::after');
      return { capsule: el.getBoundingClientRect().height, press: after.height };
    });
    expect(row).toEqual({ capsule: 32, press: '44px' });
    await picker(page).getByRole('button', { name: 'Back to characters' }).click();
    await expect(card(page, 'Kira')).toBeFocused();
  });

  test('opens from a Recent face', async ({ page }) => {
    await live(page);
    await openPicker(page);
    await card(page, 'Elena').click();
    await picker(page).getByRole('button', { name: 'Talk to Elena' }).click();
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');

    await openPicker(page);
    const faces = picker(page).locator('.va-face');
    await expect(faces).toHaveCount(2);
    await expect(faces.first()).toHaveAccessibleName('Elena');
    await faces.nth(1).click();
    await expect(picker(page).getByRole('heading', { name: 'Kira', level: 2 })).toBeVisible();
  });
});

test.describe('switching', () => {
  test('Talk ends the conversation and connects to the chosen character', async ({ page }) => {
    await live(page);
    await page.keyboard.press('/');
    await page.keyboard.type('Hello');
    await page.keyboard.press('Enter');
    await expect(page.locator('.va-transcript article')).toHaveCount(1);

    await openPicker(page);
    await card(page, 'Elena').click();
    await picker(page).getByRole('button', { name: 'Talk to Elena' }).click();

    await expect(picker(page)).toHaveCount(0);
    await expect(chip(page)).toContainText('Elena');
    await expect(chip(page)).toBeFocused();
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
    await expect(page.getByText('Ask Elena')).toBeVisible();
    await expect(page.locator('.va-transcript article')).toHaveCount(0);
    await expect(page.getByText('No conversation yet')).toBeVisible();
    const record = await fakeRecord(page);
    expect(record.characters).toEqual(['kira-1', 'elena-2']);
    // One fixed end user: a new one would mint a memory speaker each time.
    expect(record.endUsers).toEqual(['e2e-user', 'e2e-user']);
  });

  test('shows the chosen character waking up on the stage while it connects (L5)', async ({
    page,
  }) => {
    await live(page, three, { later: 'hold' });
    await openPicker(page);
    await card(page, 'Marcus').click();
    await picker(page).getByRole('button', { name: 'Talk to Marcus' }).click();
    const waking = page.locator('.va-launch--switching');
    await expect(waking).toHaveRole('status');
    await expect(waking).toHaveText(/^Waking up\s*Marcus\s*German$/);
    // The stage is the overlay's: no capsule, no Island, no picture, until Marcus is live.
    await expect(capsule(page)).toHaveCount(0);
    await expect(page.locator('.convai-island')).toHaveCount(0);
    await expect(waking.locator('img')).toHaveCount(0);
    // Without a picture the overlay keeps its own ground: no fade over nothing.
    await expect(waking.locator('.va-launch__fade')).toHaveCount(0);
    await expect(chip(page)).toBeFocused();

    await page.evaluate(() => window.fakeConvai?.accept());
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
    await expect(waking).toHaveCount(0);
    await expect(page.getByText('Ask Marcus')).toBeVisible();
  });

  test('gives a switch up after 10 s: Couldn’t connect, then Try again', async ({ page }) => {
    await page.clock.install();
    await live(page, three, { later: 'hold' });
    await openPicker(page);
    await card(page, 'Marcus').click();
    await picker(page).getByRole('button', { name: 'Talk to Marcus' }).click();
    await expect(page.locator('.va-launch--switching')).toBeVisible();
    await page.clock.runFor(9000);
    await expect(page.locator('.va-launch[role="alert"]')).toHaveCount(0);
    await page.clock.runFor(1500);
    await expect(page.locator('.va-launch[role="alert"]')).toContainText('Couldn’t connect');

    const before = (await fakeRecord(page)).connects;
    await page.getByRole('button', { name: 'Try again' }).click();
    // The token comes first: accept only the connect Try again started, once it has.
    await expect.poll(async () => (await fakeRecord(page)).connects).toBeGreaterThan(before);
    await page.evaluate(() => window.fakeConvai?.accept());
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
    await expect(page.getByText('Ask Marcus')).toBeVisible();
    // Marcus was never live before: no break to mark.
    await expect(page.locator('.convai-island')).not.toContainText('restarted');
  });

  test('breaks a long name rather than run it off a narrow stage (L5)', async ({ page }) => {
    await page.setViewportSize({ width: 560, height: 640 });
    const long = 'Maximilianatheodorakonstantinopolitanische';
    await live(page, [kira, { id: 'long-9', name: long, languages: ['en-US'] }], {
      later: 'hold',
    });
    await openPicker(page);
    await card(page, long).click();
    await picker(page)
      .getByRole('button', { name: `Talk to ${long}` })
      .click();
    const name = page.locator('.va-launch__title--name');
    await expect(name).toHaveText(long);
    const box = await name.boundingBox();
    const stage = await page.locator('.va-launch').boundingBox();
    expect(
      box && stage ? box.x >= stage.x && box.x + box.width <= stage.x + stage.width : false,
    ).toBe(true);
    expect(box?.height ?? 0).toBeGreaterThan(50);
  });

  test('draws the chosen character’s picture behind the words (L5)', async ({ page }) => {
    await page.route('https://portraits.test/**', (route) =>
      route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          'base64',
        ),
      }),
    );
    await live(page, [kira, { ...elena, portrait: 'https://portraits.test/elena.png' }], {
      later: 'hold',
    });
    await openPicker(page);
    await card(page, 'Elena').click();
    await picker(page).getByRole('button', { name: 'Talk to Elena' }).click();
    const picture = page.locator('.va-launch__portrait img');
    await expect(picture).toHaveAttribute('src', 'https://portraits.test/elena.png');
    await expect(picture).toHaveAttribute('alt', '');
    // At 40 %, over the stage's top 70 %.
    const place = page.locator('.va-launch__portrait');
    const box = await place.boundingBox();
    const stage = await page.locator('.va-launch').boundingBox();
    expect(box && stage ? Math.round((box.height / stage.height) * 100) : null).toBe(70);
    await expect(place).toHaveCSS('opacity', '0.4');
  });

  test('starts again with the character last talked to', async ({ page }) => {
    await live(page);
    await openPicker(page);
    await card(page, 'Marcus').click();
    await picker(page).getByRole('button', { name: 'Talk to Marcus' }).click();
    await expect(chip(page)).toContainText('Marcus');

    await page.reload();
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
    await expect(chip(page)).toContainText('Marcus');
    expect((await fakeRecord(page)).characters).toEqual(['marcus-3']);
  });

  test('keeps what is shared for the new character', async ({ page }) => {
    await live(page);
    await page.locator('.va-chip').click();
    await page.getByRole('group', { name: 'Camera' }).getByRole('menuitemradio').first().click();
    await expect(page.locator('.va-chip')).toContainText('Camera');
    // Live, the camera's picture is with the transport: the chip names it while it still starts.
    await expect(page.locator('.va-chip__slot')).toHaveAttribute('data-mark', 'live');
    const published = (await fakeRecord(page)).visions.length;
    expect(published).toBeGreaterThan(0);

    await openPicker(page);
    await card(page, 'Elena').click();
    await picker(page).getByRole('button', { name: 'Talk to Elena' }).click();
    await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('.va-chip')).toContainText('Camera');
    // Nothing was let go: the transport publishes the same picture again on its own connect.
    const visions = (await fakeRecord(page)).visions;
    expect(visions).toHaveLength(published);
    expect(visions.at(-1)).not.toBeNull();
  });
});

test.describe('one character (V18)', () => {
  test('the chip opens that character’s stage alone', async ({ page }) => {
    await live(page, [kira]);
    await expect(chip(page)).toHaveAccessibleName(/^Kira ?, About Kira$/);
    await openPicker(page);
    await expect(picker(page).getByRole('heading', { name: 'Kira', level: 2 })).toBeVisible();

    await expect(picker(page).getByText('Talking now')).toHaveCount(0);
    await expect(picker(page).locator('.va-character__action')).toHaveCount(0);
    await expect(picker(page).getByRole('button', { name: 'Back to characters' })).toHaveCount(0);
    await expect(picker(page).getByRole('searchbox')).toHaveCount(0);
    await expect(picker(page).locator('.va-character__dot')).toHaveCount(0);
    await expect(picker(page).getByRole('button', { name: 'Close' })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(picker(page).getByRole('heading', { name: 'Kira', level: 2 })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(picker(page)).toHaveCount(0);
  });
});

test.describe('loading (C5)', () => {
  test('says it couldn’t load in the cards’ place, with Try again', async ({ page }) => {
    await live(page);
    let refuse = true;
    await page.route('**/api/characters', (route) =>
      refuse
        ? route.fulfill({ status: 502, json: { error: 'Could not reach Convai.' } })
        : route.fulfill({ json: { characters: [...three, { id: 'mira-4', name: 'Mira' }] } }),
    );
    await openPicker(page);
    const failure = picker(page).getByRole('alert').filter({ hasText: 'Couldn’t load characters' });
    await expect(failure).toBeVisible();
    await expect(failure).toContainText('Check your connection.');
    await expect(picker(page).locator('.va-card')).toHaveCount(0);
    await expect(picker(page).locator('.va-face')).toHaveCount(0);
    await expect(picker(page).getByRole('searchbox')).toBeDisabled();
    const retry = failure.getByRole('button', { name: 'Try again' });
    await expect(retry).toBeFocused();
    expect((await retry.boundingBox())?.height).toBe(32);

    refuse = false;
    await retry.click();
    await expect(failure).toHaveCount(0);
    await expect(picker(page).locator('.va-card')).toHaveCount(4);
    await expect(picker(page).getByRole('searchbox')).toBeEnabled();
    // The focus goes back to the cards, not to the page.
    await expect(card(page, 'Kira')).toBeFocused();
  });
});

test.describe('portraits', () => {
  test('composes background and character art, falls back independently, and preserves full artwork in the preview', async ({
    page,
  }, testInfo) => {
    const background =
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#12394c"/><stop offset="1" stop-color="#9a715a"/></linearGradient></defs><path fill="url(#g)" d="M0 0h800v800H0z"/><circle cx="630" cy="160" r="95" fill="#e8c596"/><path d="M0 580 250 320 470 580 660 400 800 600v200H0" fill="#234450"/></svg>';
    const foreground =
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="700"><circle cx="200" cy="155" r="85" fill="#e3bfa5"/><path d="M100 160q0-155 100-130 115-10 95 150l-35-65-100 5-55 60" fill="#292633"/><path d="M70 700V370q0-130 130-130t130 130v330" fill="#ded7c9"/><path d="M130 280 200 390 270 280" fill="#44596a"/></svg>';
    await page.route('https://artwork.test/**', (route) =>
      route.request().url().includes('gone')
        ? route.fulfill({ status: 404 })
        : route.fulfill({
            contentType: 'image/svg+xml',
            body: route.request().url().includes('background') ? background : foreground,
          }),
    );
    await live(page, [
      {
        ...kira,
        portrait: 'https://artwork.test/square.svg',
        portraitFull: 'https://artwork.test/full.svg',
        background: 'https://artwork.test/background.svg',
      },
      {
        ...elena,
        portrait: 'https://artwork.test/square.svg',
        portraitFull: 'https://artwork.test/gone-full.svg',
        background: 'https://artwork.test/gone-bg.svg',
      },
      marcus,
    ]);
    await openPicker(page);
    await expect(card(page, 'Kira').locator('.va-artwork__background')).toHaveAttribute(
      'data-loaded',
      'true',
    );
    await expect(card(page, 'Kira').locator('.va-artwork__foreground')).toHaveAttribute(
      'data-loaded',
      'true',
    );
    await expect(card(page, 'Elena').locator('.va-artwork__background')).toHaveCount(0);
    await expect(card(page, 'Elena').locator('.va-artwork__foreground')).toHaveAttribute(
      'data-loaded',
      'true',
    );
    await expect(card(page, 'Kira').locator('.va-artwork__foreground')).toHaveCSS('opacity', '1');
    await page.screenshot({ path: testInfo.outputPath('artwork-gallery.png') });
    await card(page, 'Kira').click();
    const art = picker(page).locator('.va-artwork__foreground');
    await expect(art).toHaveAttribute('src', 'https://artwork.test/full.svg');
    await expect(art).toHaveAttribute('data-loaded', 'true');
    expect(await art.evaluate((el) => getComputedStyle(el).objectFit)).toBe('contain');
    await expect(art).toHaveCSS('opacity', '1');
    await page.screenshot({ path: testInfo.outputPath('artwork-preview.png') });
    await page.keyboard.press('ArrowRight');
    await expect(art).toHaveAttribute('src', 'https://artwork.test/square.svg');
    await expect(art).toHaveAttribute('data-loaded', 'true');
    await expect(picker(page).locator('.va-artwork__background')).toHaveCount(0);
    await page.setViewportSize({ width: 560, height: 720 });
    await expect(art).toHaveCSS('opacity', '1');
    await page.screenshot({ path: testInfo.outputPath('artwork-small.png') });
  });

  /** A 1 × 1 PNG, served for every address under portraits.test; `gone` answers 404. */
  async function routePortraits(page: Page) {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64',
    );
    await page.route('https://portraits.test/**', (route) =>
      route.request().url().includes('gone')
        ? route.fulfill({ status: 404 })
        : route.fulfill({ contentType: 'image/png', body: png }),
    );
  }

  test('shows each character’s picture, and the first letter where it has none or it fails', async ({
    page,
  }) => {
    await routePortraits(page);
    await live(page, [
      { ...kira, portrait: 'https://portraits.test/kira.png' },
      { ...elena, portrait: 'https://portraits.test/gone.png' },
      marcus,
    ]);
    // The bar's chip shows the picture too.
    await expect(chip(page).locator('img.va-portrait')).toHaveAttribute(
      'src',
      'https://portraits.test/kira.png',
    );
    await openPicker(page);
    await expect(card(page, 'Kira').locator('img.va-portrait')).toBeVisible();
    await expect(card(page, 'Kira').locator('.va-artwork__initial')).toHaveCount(0);
    // A picture that cannot load never shows broken: the letter stands in.
    await expect(card(page, 'Elena').locator('img')).toHaveCount(0);
    await expect(card(page, 'Elena').locator('.va-artwork__initial')).toHaveText('E');
    await expect(card(page, 'Marcus').locator('.va-artwork__initial')).toHaveText('M');

    await card(page, 'Kira').click();
    await expect(picker(page).locator('.va-character__picture img')).toBeVisible();
  });
});

test.describe('while the picker is open', () => {
  test('a pasted image is no source: the stage under the dialog takes nothing', async ({
    page,
  }) => {
    await live(page);
    await openPicker(page);
    const prevented = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      canvas.getContext('2d')?.fillRect(0, 0, 64, 64);
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/png');
      });
      if (!blob) throw new Error('No blob.');
      const data = new DataTransfer();
      data.items.add(new File([blob], 'mug.png', { type: 'image/png' }));
      const event = new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      });
      document.body.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(prevented).toBe(false);
    await page.waitForTimeout(800);
    expect((await fakeRecord(page)).visions).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.locator('.va-chip')).toContainText('Nothing shared');
  });
});

test.describe('layout and access', () => {
  test('passes axe in the gallery and on the stage', async ({ page }) => {
    await live(page);
    await openPicker(page);
    const gallery = await new AxeBuilder({ page }).include('dialog.va-picker').analyze();
    expect(gallery.violations).toEqual([]);
    await card(page, 'Elena').click();
    const stage = await new AxeBuilder({ page }).include('dialog.va-picker').analyze();
    expect(stage.violations).toEqual([]);
  });

  test('fits a 560 window with three cards a row and no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 560, height: 720 });
    await live(page, [...three, { id: 'mira-4', name: 'Mira' }]);
    await openPicker(page);
    const box = await picker(page).boundingBox();
    expect(box?.width).toBe(528);
    const tops = await picker(page)
      .locator('.va-card')
      .evaluateAll((cards) => cards.map((c) => Math.round(c.getBoundingClientRect().top)));
    // Three on the first row, the fourth below.
    expect(tops.filter((top) => top === tops[0])).toHaveLength(3);
    expect(tops[3]).toBeGreaterThan(tops[0] ?? 0);
    const overflow = await picker(page).evaluate((d) => d.scrollWidth - d.clientWidth);
    expect(overflow).toBe(0);
  });

  test('keeps four cards a row at 1440', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await live(page, [...three, { id: 'mira-4', name: 'Mira' }, { id: 'aria-5', name: 'Aria' }]);
    await openPicker(page);
    expect((await picker(page).boundingBox())?.width).toBe(880);
    const tops = await picker(page)
      .locator('.va-card')
      .evaluateAll((cards) => cards.map((c) => Math.round(c.getBoundingClientRect().top)));
    expect(tops.filter((top) => top === tops[0])).toHaveLength(4);
  });

  test('places the cards and the Recent faces where the frames draw them', async ({ page }) => {
    skipIn(page, ['firefox', 'webkit'], limits.scrollbar);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.setItem('va.recent-characters', JSON.stringify(['kira-1', 'elena-2']));
    });
    await live(page, [...three, { id: 'mira-4', name: 'Mira' }, { id: 'aria-5', name: 'Aria' }]);
    await openPicker(page);
    const dialog = await picker(page).boundingBox();
    if (!dialog) throw new Error('The picker is not laid out.');
    // The cards from 1 + 28 inside, four across 822 with 20 between: the scroll bar's gutter is
    // kept out of the right side whether the grid scrolls or not.
    const lefts = await picker(page)
      .locator('.va-card')
      .evaluateAll((cards) => cards.slice(0, 4).map((c) => c.getBoundingClientRect().left));
    expect(lefts.map((left) => Math.round(left - dialog.x))).toEqual([29, 240, 450, 661]);
    // Recent is a row of its own under the header, outside what scrolls: 24 in, 12 above the grid.
    const faces = picker(page).locator('.va-picker__faces');
    expect(await faces.evaluate((el) => el.parentElement?.tagName)).toBe('DIALOG');
    const label = await faces.locator('.va-picker__faces-label').boundingBox();
    expect(Math.round((label?.x ?? 0) - dialog.x)).toBe(1 + 24);
    // The search is the kit's field with a leading glyph: 12 at its sides, its words 14.
    const field = await picker(page)
      .locator('.va-search')
      .evaluate((el) => ({
        side: getComputedStyle(el).paddingLeft,
        size: getComputedStyle(el.querySelector('input') ?? el).fontSize,
      }));
    expect(field).toEqual({ side: '12px', size: '14px' });
    // Every portrait keeps the kit's 1 px edge inside it.
    for (const selector of ['.va-card__picture', '.va-face']) {
      expect(
        await picker(page)
          .locator(selector)
          .first()
          .evaluate((el) => getComputedStyle(el, '::after').boxShadow),
      ).toMatch(/ 0px 0px 0px 1px inset$/);
    }
    // A line of languages never starts with the dot: it keeps to the name before it.
    const nbsp = String.fromCharCode(160);
    // Read raw: toHaveText folds the no-break space into a plain one.
    expect(await card(page, 'Elena').locator('.va-card__line').textContent()).toBe(
      `English${nbsp}· Spanish`,
    );
  });

  test('draws the kit’s shapes: round Close and Back, a capsule Talk, the name 20 under Close', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await live(page);
    await openPicker(page);
    const look = (selector: string) =>
      picker(page)
        .locator(selector)
        .first()
        .evaluate((el) => {
          const style = getComputedStyle(el);
          const icon = el.querySelector('svg')?.getBoundingClientRect();
          return {
            radius: parseFloat(style.borderTopLeftRadius) >= el.getBoundingClientRect().height / 2,
            shadow: style.boxShadow,
            background: style.backgroundColor,
            icon: icon ? Math.round(icon.width) : null,
          };
        });
    expect(await look('.va-picker__close')).toMatchObject({
      radius: true,
      shadow: 'none',
      icon: 12,
    });

    await card(page, 'Elena').click();
    expect(await look('.va-picker__close')).toMatchObject({
      radius: true,
      shadow: 'none',
      icon: 12,
    });
    const island = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--convai-surface-island'),
    );
    const back = await look('.va-character__back');
    expect(back).toMatchObject({ radius: true, shadow: 'none', icon: 14 });
    expect(back.background).toBe(
      await page.evaluate((color) => {
        const probe = document.createElement('span');
        probe.style.color = color;
        document.body.append(probe);
        const rgb = getComputedStyle(probe).color;
        probe.remove();
        return rgb;
      }, island.trim()),
    );
    expect((await look('.va-character__talk')).radius).toBe(true);

    expect((await picker(page).locator('.va-character__portrait').boundingBox())?.width).toBe(420);
    const close = await picker(page).locator('.va-character__close').boundingBox();
    const name = await picker(page).getByRole('heading', { name: 'Elena', level: 2 }).boundingBox();
    expect(Math.round((name?.y ?? 0) - ((close?.y ?? 0) + (close?.height ?? 0)))).toBe(20);
  });
});
