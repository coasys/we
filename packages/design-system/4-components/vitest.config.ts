import solidPlugin from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

/**
 * This package had `--passWithNoTests` and no tests at all, which is how eight defects in it stayed
 * open across three audits — every one of them a behaviour a unit test would have pinned.
 *
 * `jsdom` and the Solid transform, because half of what is worth testing here is a component
 * rendering: a signal that stops following its prop, a timer that outlives its scope, a snapshot
 * taken outside a reactive scope. The rest — the toast service — is plain logic and needs neither,
 * but one project is simpler than two for a suite this size.
 */
export default defineConfig({
  plugins: [solidPlugin()],
  resolve: {
    // One solid-js instance across transformed source and any prebuilt dist a test pulls in.
    dedupe: ['solid-js', 'solid-js/web', 'solid-js/store'],
    conditions: ['development', 'browser'],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
