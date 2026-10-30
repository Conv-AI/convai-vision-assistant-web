import { expect, test, type Page } from '@playwright/test';
import { emit, fakeRecord, openApp } from './fakeConvai';
import { fakePicker } from './fakeDisplay';
import { launchOptions } from './launch';
import { limits } from './engines';

test.use({ launchOptions: launchOptions({ tabTitle: 'Vision Assistant e2e share fixture' }) });

test.skip(({ browserName }) => browserName !== 'chromium', limits.cdp);

const capsule = (page: Page) => page.locator('.convai-capsule');
const chip = (page: Page) => page.locator('.va-chip');
const menu = (page: Page) => page.getByRole('menu', { name: 'What Kira sees' });
const row = (page: Page, name: string | RegExp) => menu(page).getByRole('menuitemradio', { name });

interface Calls {
  /** Every call into a canvas that is not on the page, by name: what a region or image draws. */
  offscreen: Record<string, number>;
  /** How long each `drawImage` into such a canvas took, in milliseconds. */
  drawTimes: number[];
  /** When each `drawImage` into such a canvas began, in the page's own time (`performance.now()`). */
  drawAt: number[];
}

declare global {
  interface Window {
    canvasCalls?: Calls;
  }
}

/** Counts and times the calls into canvases that are not on the page. */
function watchOffscreenCanvases() {
  const calls: Calls = { offscreen: {}, drawTimes: [], drawAt: [] };
  window.canvasCalls = calls;
  const proto = CanvasRenderingContext2D.prototype as unknown as Record<
    string,
    (...args: unknown[]) => unknown
  >;
  for (const name of ['drawImage', 'putImageData', 'getImageData', 'fillRect']) {
    const original = proto[name];
    if (!original) continue;
    proto[name] = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
      const start = performance.now();
      const result = original.apply(this, args);
      const now = window.canvasCalls;
      if (now && !this.canvas.isConnected) {
        now.offscreen[name] = (now.offscreen[name] ?? 0) + 1;
        if (name === 'drawImage') {
          now.drawTimes.push(performance.now() - start);
          now.drawAt.push(start);
        }
      }
      return result;
    };
  }
}

async function live(page: Page) {
  await fakePicker(page, ['browser'], { width: 1920, height: 1080 });
  await page.addInitScript(() => {
    window.localStorage.setItem('va.share-card-shown', '2');
  });
  await page.addInitScript(watchOffscreenCanvases);
  await openApp(page);
  await expect(capsule(page)).toHaveAttribute('data-state', 'ready');
}

interface Cost {
  /** Main-thread task time per second, in milliseconds (CDP `TaskDuration`). */
  taskPerSecond: number;
  /** The calls into offscreen canvases while it was measured, by name. */
  calls: Record<string, number>;
  /** Mean time of one `drawImage` into an offscreen canvas, in milliseconds. */
  drawMean: number;
  /**
   * The mean gap from one `drawImage` into an offscreen canvas to the next, in the page's own time, in
   * milliseconds. A loaded page holds some ticks back and runs them together after: the gaps spread,
   * their mean stays the tick.
   */
  drawGap: number;
  /** Frames the published track gave per second. */
  framesPerSecond: number;
  /** The most frames a second the published track is let give (its capture's own setting). */
  trackRate: number;
}

/** Measures `seconds` of the page as it stands, then counts the published track's frames apart. */
async function measure(page: Page, seconds = 4): Promise<Cost> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const task = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics');
    return metrics.find((m) => m.name === 'TaskDuration')?.value ?? 0;
  };
  await page.evaluate(() => {
    window.canvasCalls = { offscreen: {}, drawTimes: [], drawAt: [] };
  });
  // The page's own time, with nothing of the test's playing.
  const before = await task();
  await page.waitForTimeout(seconds * 1000);
  const after = await task();
  const calls = await page.evaluate(
    () => window.canvasCalls ?? { offscreen: {}, drawTimes: [], drawAt: [] },
  );
  await cdp.detach();
  const trackRate = await page.evaluate(
    () => window.fakeConvai?.tracks.at(-1)?.getSettings().frameRate ?? 0,
  );
  // The frames come off the track itself, as the encoder takes them. A player on the page counts only
  // the frames it gets to put on screen, which a loaded machine thins out while the draws keep time.
  const frames = await page.evaluate(async (ms) => {
    const track = window.fakeConvai?.tracks.at(-1)?.clone();
    if (!track) return 0;
    const { MediaStreamTrackProcessor: Processor } = window as unknown as {
      MediaStreamTrackProcessor: new (init: { track: MediaStreamTrack }) => {
        readable: ReadableStream<VideoFrame>;
      };
    };
    const reader = new Processor({ track }).readable.getReader();
    const stop = setTimeout(() => void reader.cancel(), ms);
    let count = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      value.close();
      count++;
    }
    clearTimeout(stop);
    track.stop();
    return count;
  }, seconds * 1000);
  const sum = calls.drawTimes.reduce((a, b) => a + b, 0);
  const first = calls.drawAt[0] ?? 0;
  const last = calls.drawAt.at(-1) ?? 0;
  return {
    taskPerSecond: ((after - before) * 1000) / seconds,
    calls: calls.offscreen,
    drawMean: calls.drawTimes.length ? sum / calls.drawTimes.length : 0,
    drawGap: calls.drawAt.length > 1 ? (last - first) / (calls.drawAt.length - 1) : 0,
    framesPerSecond: frames / seconds,
    trackRate,
  };
}

function report(label: string, cost: Cost) {
  const line = `${label}: task ${cost.taskPerSecond.toFixed(1)} ms/s, drawImage ${cost.drawMean.toFixed(2)} ms, calls ${JSON.stringify(cost.calls)}, draws ${cost.drawGap.toFixed(1)} ms apart, ${cost.framesPerSecond.toFixed(1)} frames/s`;
  console.log(line);
  test.info().annotations.push({ type: 'cost', description: line });
}

/** A 1920 × 1080 PNG with a word on it, as a file's bytes. */
async function bigImage(page: Page): Promise<Buffer> {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No 2D context.');
    context.fillStyle = 'green';
    context.fillRect(0, 0, 1920, 1080);
    context.fillStyle = 'white';
    context.font = '600 160px sans-serif';
    context.fillText('PELICAN', 400, 600);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/png');
    });
    if (!blob) throw new Error('No blob.');
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  return Buffer.from(bytes);
}

// What the app holds to: one draw a tick, 15 a second (between 12 and 16), into a track let give 15.
// How many of those draws become frames follows how often the browser paints the page, which a loaded
// machine slows: that count is reported, never asserted.
function expectFramesKept(cost: Cost) {
  expect(cost.calls.drawImage ?? 0).toBeGreaterThan(1);
  expect(cost.drawGap).toBeGreaterThanOrEqual(1000 / 16);
  expect(cost.drawGap).toBeLessThanOrEqual(1000 / 12);
  expect(cost.trackRate).toBe(15);
  expect(cost.framesPerSecond).toBeGreaterThan(0);
}

test('a region of a 1920 × 1080 share draws once a tick and keeps the frame rate', async ({
  page,
}) => {
  await live(page);
  await chip(page).click();
  await row(page, 'Browser tab…').click();
  await expect.poll(async () => (await fakeRecord(page)).visions.at(-1)?.kind).toBe('screen_share');
  await page.waitForTimeout(1000);
  report('tab (the same share, whole)', await measure(page));

  await chip(page).click();
  await row(page, 'Region…').click();
  await page
    .getByRole('group', { name: 'Choose an area' })
    .getByRole('button', { name: 'Share area' })
    .click();
  await expect(chip(page).locator('.va-chip__slot')).toHaveAttribute('data-mark', 'live');
  await page.waitForTimeout(1000);
  const region = await measure(page);
  report('region (middle half)', region);
  expectFramesKept(region);
  // No pixels read back.
  expect(region.calls.getImageData ?? 0).toBe(0);
});

test('a 1920 × 1080 image keeps the frame rate without reading or putting pixels', async ({
  page,
}) => {
  await live(page);
  report('nothing shared', await measure(page));
  await chip(page).click();
  const chooser = page.waitForEvent('filechooser');
  await row(page, /^Image…/).click();
  await (
    await chooser
  ).setFiles({ name: 'big.png', mimeType: 'image/png', buffer: await bigImage(page) });
  await expect(chip(page)).toHaveAccessibleName('Image · big.png');
  await page.waitForTimeout(1000);
  const image = await measure(page);
  report('image', image);
  expectFramesKept(image);
  // Putting pixels makes the browser read the whole canvas back each frame.
  expect(image.calls.putImageData ?? 0).toBe(0);
  expect(image.calls.getImageData ?? 0).toBe(0);
});

/** Counts the capsule Lens's draws (each starts by clearing its canvas). */
function countLensDraws() {
  const proto = CanvasRenderingContext2D.prototype as unknown as Record<
    string,
    (...args: unknown[]) => unknown
  >;
  const clear = proto.clearRect;
  if (!clear) return;
  proto.clearRect = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
    if (this.canvas.closest('.convai-capsule')) window.lensDraws = (window.lensDraws ?? 0) + 1;
    return clear.apply(this, args);
  };
}

declare global {
  interface Window {
    lensDraws?: number;
  }
}

async function lensDrawsPerSecond(page: Page, seconds = 2): Promise<number> {
  await page.evaluate(() => {
    window.lensDraws = 0;
  });
  await page.waitForTimeout(seconds * 1000);
  return (await page.evaluate(() => window.lensDraws ?? 0)) / seconds;
}

test('a resting Lens draws 15 times a second and a speaking one on every frame', async ({
  page,
}) => {
  await page.addInitScript(countLensDraws);
  await live(page);
  await page.waitForTimeout(2000);
  const ready = await lensDrawsPerSecond(page);
  report('nothing shared, ready', await measure(page));
  await emit(page, { type: 'activity', activity: 'speaking' });
  await expect(capsule(page)).toHaveAttribute('data-state', 'speaking');
  await page.waitForTimeout(1000);
  const speaking = await lensDrawsPerSecond(page);
  console.log(`Lens draws: ready ${ready.toFixed(1)}/s, speaking ${speaking.toFixed(1)}/s`);
  // Not frozen; under load a few draws may come late.
  expect(ready).toBeGreaterThanOrEqual(5);
  expect(ready).toBeLessThanOrEqual(16);
  expect(speaking).toBeGreaterThan(2 * ready);
});
