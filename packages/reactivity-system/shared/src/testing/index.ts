/**
 * What tests need from the port: a second implementation to run a store under, and the guarantee
 * suite every implementation runs.
 *
 * The suite imports vitest, which is why this is a subpath of its own and vitest an optional peer.
 */
export { createTestReactivity } from './port';
export { DEFAULT_HOSTS, describeReactivityGuarantees, type ReactivityHost } from './guarantees';
