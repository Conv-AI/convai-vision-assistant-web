import type { Page } from '@playwright/test';
import { limits, skipIn } from './engines';

/**
 * The browser's own picker for a tab, a window or a screen, faked in the page: no test ever reaches
 * the real `getDisplayMedia`. With Chromium's fake media UI and no working tab selector the real
 * call captures the real screen (it did, 23 October 2026, in the headless shell even with
 * `--auto-select-tab-capture-source-by-title`), so a share is a canvas whose track says it is the
 * surface the test chose. As Chrome does, the fake refuses a call made without the person's press.
 */

/** What the person does in the picker: chooses a surface, closes it, or the browser cannot share. */
export type PickerAnswer = 'browser' | 'window' | 'monitor' | 'cancel' | 'abort' | 'fail' | 'hang';

export interface PickerCall {
  /** The options the app asked with. */
  options: {
    video?: { displaySurface?: string; frameRate?: unknown };
    audio?: boolean;
    selfBrowserSurface?: string;
    monitorTypeSurfaces?: string;
    preferCurrentTab?: boolean;
  };
  /** The page had the person's press (transient activation) when it asked. */
  activated: boolean;
}

/**
 * What a share shows: its size, and whether it is four flat quarters (red, green, blue, yellow from
 * the top left), so a test can tell which part of it a region publishes.
 */
export interface FakeSurface {
  width: number;
  height: number;
  quarters?: boolean;
}

/** The quarters' colors, as a canvas reads them back. */
export const quarterColors = {
  topLeft: [220, 40, 40],
  topRight: [40, 180, 80],
  bottomLeft: [40, 80, 220],
  bottomRight: [230, 200, 40],
} as const;

declare global {
  interface Window {
    fakeDisplay?: {
      calls: PickerCall[];
      /** The answers to the next pickers, in order; the last one repeats. */
      answers: PickerAnswer[];
      tracks: MediaStreamTrack[];
      /** The browser's own "Stop sharing" bar: the last share ends. */
      stopFromBrowser: () => void;
    };
  }
}

function install({
  answers,
  surface: size,
  colors,
}: {
  answers: PickerAnswer[];
  surface: FakeSurface;
  colors: typeof quarterColors;
}) {
  const calls: PickerCall[] = [];
  const tracks: MediaStreamTrack[] = [];
  const next = () => (answers.length > 1 ? answers.shift() : answers[0]) ?? 'browser';

  const share = (surface: string): MediaStream => {
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    const rgb = (c: readonly number[]) => `rgb(${c.join(',')})`;
    // A picture that keeps changing, so frames keep coming, and says what it stands for.
    let frame = 0;
    const draw = () => {
      if (!context) return;
      if (size.quarters) {
        const w = canvas.width / 2;
        const h = canvas.height / 2;
        context.fillStyle = rgb(colors.topLeft);
        context.fillRect(0, 0, w, h);
        context.fillStyle = rgb(colors.topRight);
        context.fillRect(w, 0, w, h);
        context.fillStyle = rgb(colors.bottomLeft);
        context.fillRect(0, h, w, h);
        context.fillStyle = rgb(colors.bottomRight);
        context.fillRect(w, h, w, h);
        frame++;
        return;
      }
      context.fillStyle = '#2b4f9e';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#ffffff';
      context.font = '600 96px sans-serif';
      context.fillText(`FIXTURE ${surface.toUpperCase()}`, 80, 380);
      context.fillRect(80 + (frame++ % 60) * 10, 600, 40, 40);
    };
    draw();
    const timer = window.setInterval(draw, 66);
    const stream = canvas.captureStream(15);
    const track = stream.getVideoTracks()[0];
    if (track) {
      const settings = track.getSettings.bind(track);
      track.getSettings = () => ({ ...settings(), displaySurface: surface });
      track.addEventListener('ended', () => {
        window.clearInterval(timer);
      });
      tracks.push(track);
    }
    return stream;
  };

  window.fakeDisplay = {
    calls,
    answers,
    tracks,
    stopFromBrowser: () => {
      const track = tracks.at(-1);
      if (!track) throw new Error('Nothing is shared.');
      track.stop();
      track.dispatchEvent(new Event('ended'));
    },
  };

  navigator.mediaDevices.getDisplayMedia = (options?: DisplayMediaStreamOptions) => {
    const activated = navigator.userActivation.isActive;
    calls.push({
      options: JSON.parse(JSON.stringify(options ?? {})) as PickerCall['options'],
      activated,
    });
    if (!activated) {
      return Promise.reject(new DOMException('getDisplayMedia needs a press', 'InvalidStateError'));
    }
    const answer = next();
    switch (answer) {
      case 'cancel':
        return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
      case 'abort':
        return Promise.reject(new DOMException('Aborted', 'AbortError'));
      case 'fail':
        return Promise.reject(new DOMException('Could not start', 'NotReadableError'));
      case 'hang':
        return new Promise<MediaStream>(() => undefined);
      default:
        return Promise.resolve(share(answer));
    }
  };
}

/** Installs the fake picker before the app loads; call before `openApp`. */
export async function fakePicker(
  page: Page,
  answers: PickerAnswer[] = ['browser'],
  surface: FakeSurface = { width: 1280, height: 720 },
): Promise<void> {
  await page.addInitScript(install, { answers, surface, colors: quarterColors });
}

export async function pickerCalls(page: Page): Promise<PickerCall[]> {
  return page.evaluate(() => window.fakeDisplay?.calls ?? []);
}

/** Sets what the person does in the next pickers. */
export async function answerPickers(page: Page, answers: PickerAnswer[]): Promise<void> {
  await page.evaluate((list) => {
    if (!window.fakeDisplay) throw new Error('The fake picker is not installed.');
    window.fakeDisplay.answers.splice(0, Infinity, ...list);
  }, answers);
}

export async function stopFromBrowser(page: Page): Promise<void> {
  skipIn(page, ['firefox'], limits.ended);
  await page.evaluate(() => {
    window.fakeDisplay?.stopFromBrowser();
  });
}
