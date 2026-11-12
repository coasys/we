/**
 * `@we/e2e`: what WE's end-to-end tests stand on. Each layer is also its own entry
 * (`@we/e2e/executor`, `/app`, `/browser`, …), so a test that needs no browser loads none.
 * docs/testing/e2e.md says which kind of test uses which.
 */
export * from './app.mjs';
export * from './artifacts.mjs';
export * from './browser.mjs';
export * from './env.mjs';
export * from './executor.mjs';
export * from './mcp.mjs';
export * from './waits.mjs';
