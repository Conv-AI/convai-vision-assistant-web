import { test, type Page } from '@playwright/test';

// What a test cannot do in an engine, and why. Each is a limit of the engine or of Playwright there,
// never of the app: where the app could not do something it shows it as absent, and a test says so.

export type Engine = 'chromium' | 'firefox' | 'webkit';

export const limits = {
  cdp: 'measured through the Chrome DevTools Protocol, which only Chromium has',
  paste:
    'Firefox hands a script-made paste to the page with an empty clipboardData, and a real paste cannot be driven from Playwright',
  ended:
    'Firefox runs no track listener for a script-made "ended", and its own Stop sharing cannot be driven from Playwright',
  forcedColors:
    'outside Chromium, Playwright emulates forced colors by the media query alone: the system colors keep the engine’s ordinary palette',
  scrollbar:
    'the reference viewport’ geometry has Chromium’s 10 px scrollbar gutter; other engines draw their own thin scrollbar (src/kit/scroll.css), overlaid here',
  flatCamera: 'Firefox’s fake camera shows one flat colour at a time',
  oneMicrophone: 'Firefox’s fake media lists one microphone',
  clipboard: 'Playwright cannot let Firefox or WebKit read the clipboard back',
  noPlayback:
    'Playwright’s WebKit gives a stream played in a video no frame (smoke.spec "plays a canvas stream")',
  noMicrophone: 'Playwright’s WebKit refuses its microphone even when it is granted',
  testPlayback:
    'headless Firefox on CI ends the microphone Test failed after recording: it cannot always play the recording back',
  noPip:
    'WebKit has no Document Picture-in-Picture: the app leaves Compact and Where Kira stays out there (compact.spec “no floating windows”)',
  subpixel:
    'Firefox lays the crop’s picture out a fraction of a pixel from Chromium, so a drag to the same fractions reads 1 px apart',
} as const;

/** The engine the page runs in. */
export function engineOf(page: Page): Engine {
  return (page.context().browser()?.browserType().name() ?? 'chromium') as Engine;
}

/** Skips the running test in these engines, saying why (one of `limits`). */
export function skipIn(page: Page, engines: readonly Engine[], reason: string): void {
  test.skip(engines.includes(engineOf(page)), reason);
}
