import { defineConfig, devices } from '@playwright/test';
import { launchFor } from './e2e/launch';

// VA_E2E_PORT gives each checkout its own preview server: two worktrees on one port would test one
// build twice, since a local run reuses a server already listening there.
const port = Number(process.env.VA_E2E_PORT ?? 4173);
const baseURL = `http://localhost:${String(port)}`;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: 0,
  reporter: isCI
    ? [
        ['github'],
        ['html', { open: 'never' }],
        ['json', { outputFile: 'playwright-report/results.json' }],
      ]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: launchFor('chromium') },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], launchOptions: launchFor('firefox') },
    },
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
        launchOptions: launchFor('webkit'),
        permissions: ['camera', 'microphone'],
      },
    },
  ],
  webServer: {
    command: `pnpm build --mode e2e && pnpm preview --port ${String(port)} --strictPort`,
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
