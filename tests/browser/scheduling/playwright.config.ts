import { defineConfig } from '@playwright/test';

// Scheduling browser harness. Not run by `npm run test:browser`: every spec here skips unless the orchestrator
// (scripts/tests/verify-scheduling-browser-local.mjs) has started the disposable environment and exported its origin.
// Run it with `npm run test:scheduling:browser`.
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [['line']],
  // Never write test output inside the repository: the Next dev server watches it and rebuilds mid-test, which corrupts its
  // manifests ("Unexpected end of JSON input") and fails unrelated requests.
  outputDir: process.env.SCHED_BROWSER_OUTPUT_DIR ?? `${process.env.TEMP ?? process.env.TMPDIR ?? '/tmp'}/sched-browser-results`,
  globalSetup: './globalSetup.ts',
  use: {
    baseURL: process.env.SCHED_BROWSER_ORIGIN,
    browserName: 'chromium',
    headless: true,
    ignoreHTTPSErrors: true, // the harness serves a self-signed loopback certificate
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    navigationTimeout: 120_000,
    actionTimeout: 30_000,
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'tablet', use: { viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
