/**
 * The AD4M-decorated implementations, unwrapped.
 *
 * The package's main entry exports *stand-ins* that resolve through the registry (see
 * entityProxy.ts) — which is what lets consumers name an entity without naming a backend. The
 * backend adapter that registers implementations obviously cannot go through that indirection to
 * find them, and neither can SDNA install, which needs the real classes to generate schemas from.
 * Both import here instead.
 *
 * Consumers other than a backend adapter should not: importing from here is asking for one
 * specific backend's implementation by name.
 */
export * from './modelRegistry';
export * from './entities';
export * from './blocks';
export { WeNode } from './WeNode';
