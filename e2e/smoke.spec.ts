import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { engineOf } from './engines';
import { openApp } from './fakeConvai';

test('the app loads with its main heading', async ({ page }) => {
  await openApp(page);

  await expect(page).toHaveTitle('Convai Vision Assistant');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Convai Vision Assistant' }),
  ).toBeVisible();
});

test('the page has no accessibility violations', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('.convai-capsule')).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();

  expect(results.violations).toEqual([]);
});

test('the browser hands out fake camera and microphone tracks', async ({ page }) => {
  await openApp(page);

  const kinds = await page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const live = stream
      .getTracks()
      .filter((track) => track.readyState === 'live')
      .map((track) => track.kind)
      .sort();
    for (const track of stream.getTracks()) track.stop();
    return live;
  });

  expect(kinds).toEqual(['audio', 'video']);
});

// Every picture the app shows (the preview, a region's crop, a Moment's still) is a stream played in
// a video: an engine that gives such a video no frame cannot run those tests. Playwright's WebKit is
// one (limits.noPlayback): this says so, and fails the day it plays one.
test('the browser plays a canvas stream in a video', async ({ page }) => {
  await openApp(page);

  const width = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 48;
    const context = canvas.getContext('2d');
    const timer = setInterval(() => context?.fillRect(0, 0, Math.random() * 64, 48), 50);
    const video = document.createElement('video');
    video.muted = true;
    video.srcObject = canvas.captureStream(15);
    // WebKit's play() never settles here: given 2 s like the frame below.
    void video.play().catch(() => undefined);
    for (let i = 0; i < 40 && video.videoWidth === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    clearInterval(timer);
    return video.videoWidth;
  });

  expect(width).toBe(engineOf(page) === 'webkit' ? 0 : 64);
});
