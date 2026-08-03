import { defineConfig, devices } from '@playwright/test';

// When E2E_BASE_URL is set (e.g. the containerized stack from
// `npm run e2e:container`), target it and don't boot a dev server.
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/globalSetup.ts',
  // Removes ONLY the storage-quota fillers globalSetup seeds — see that file's
  // header for why those specifically can't be left behind.
  globalTeardown: './e2e/globalTeardown.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL,
    storageState: './e2e/.auth/storageState.json',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        // The dev server's first cold route compile can exceed Playwright's default
        // 60s webServer boot window in CI; give it longer so cold starts don't flake.
        timeout: 180_000,
      },
});
