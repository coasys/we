/**
 * The AD4M lane's model implementations — generated from `@we/models`' manifest, living where
 * they belong: in the adapter that registers them. Everything else in the application reaches
 * these only through the entity proxies on `@we/models`, which resolve to whatever this adapter
 * registered at connect time; importing from here is asking for one specific backend's
 * implementation by name, which only this package's own wiring and SDNA install have any
 * business doing.
 */
export * from './entities';
export * from './blocks';
export { WeNode } from './WeNode';

// Type-only, and load-bearing: importing the conformance assertions is what places them in every
// build graph that includes this barrel, so a class drifting from its neutral interface fails the
// build rather than waiting to be noticed.
export type { AssertClassesSatisfyContract } from './conformance';
