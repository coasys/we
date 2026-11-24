/**
 * The guarantee suite every implementation of the port runs.
 *
 * The suite imports vitest, which is why this is a subpath of its own and vitest an optional peer.
 */
export { DEFAULT_HOSTS, describeReactivityGuarantees, type ReactivityHost } from './guarantees';
