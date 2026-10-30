import type {
  LaunchOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
  WorkerFixture,
} from '@playwright/test';

export function launchFor(
  browserName: string,
  { tabTitle, scrollbars = false }: { tabTitle?: string; scrollbars?: boolean } = {},
): LaunchOptions {
  if (browserName === 'firefox') {
    return {
      firefoxUserPrefs: {
        'media.navigator.streams.fake': true,
        'media.navigator.permission.disabled': true,
      },
    };
  }
  if (browserName !== 'chromium') return {};
  return {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      ...(tabTitle ? [`--auto-select-tab-capture-source-by-title=${tabTitle}`] : []),
    ],
    // Playwright hides Chromium's scrollbars; a test of a scroller's gutter must show what a person sees.
    ...(scrollbars ? { ignoreDefaultArgs: ['--hide-scrollbars'] } : {}),
  };
}

/** `launchFor` as a spec's `test.use({ launchOptions })`, which replaces the project's launch whole. */
export function launchOptions(
  options: Parameters<typeof launchFor>[1] = {},
): [
  WorkerFixture<LaunchOptions, PlaywrightWorkerArgs & PlaywrightWorkerOptions>,
  { scope: 'worker' },
] {
  return [
    async ({ browserName }, use) => {
      await use(launchFor(browserName, options));
    },
    { scope: 'worker' },
  ];
}
