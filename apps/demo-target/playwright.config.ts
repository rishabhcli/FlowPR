import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  use: {
    baseURL: process.env.DEMO_TARGET_URL ?? 'http://localhost:3100',
    trace: 'on',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  webServer: process.env.DEMO_TARGET_URL
    ? undefined
    : {
        command: 'pnpm dev',
        url: 'http://localhost:3100',
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
