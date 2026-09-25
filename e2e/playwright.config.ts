import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests for the WE application against a live AD4M executor.
 *
 * Prerequisites:
 *   1. AD4M executor running (port 12000, admin credential "test123")
 *   2. WE served (port 3000 — `pnpm run serve` or `vite preview`)
 *
 * Both are started by the ad4m-devtools launch scripts:
 *   ad4m-flux-launch.sh --ad4m ../ad4m --flux . --no-flux
 *   pnpm run serve  (or vite preview --port 3000)
 *
 * Override with env vars:
 *   AD4M_PORT=12000  AD4M_ADMIN_CREDENTIAL=test123  WE_URL=http://localhost:3000
 */
export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 60_000,

  reporter: 'html',

  use: {
    baseURL: process.env.WE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'off', // managed explicitly in tests
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
