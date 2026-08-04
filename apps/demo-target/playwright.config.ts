import { defineConfig, devices } from '@playwright/test';

const runLabel = process.env.PLAYWRIGHT_RUN_LABEL ?? 'run';
const targetPort = process.env.DEMO_TARGET_PORT ?? '3100';
const targetUrl = process.env.DEMO_TARGET_URL ?? `http://localhost:${targetPort}`;
const readinessUrl = `${targetUrl.replace(/\/+$/, '')}/api/flowpr-health`;
const executablePath = process.env.FLOWPR_PLAYWRIGHT_EXECUTABLE_PATH?.trim();

export default defineConfig({
  testDir: './tests',
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? `./test-results/${runLabel}-${process.pid}`,
  timeout: 30_000,
  use: {
    baseURL: targetUrl,
    trace: 'on',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
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
        command: `pnpm exec next dev --port ${targetPort}`,
        url: readinessUrl,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
