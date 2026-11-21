import init from '@coasys/identity-wasm';

let started: Promise<unknown> | undefined;

/**
 * Loads `@coasys/identity-wasm` once. Every module that calls an export awaits this first; a second
 * call returns the same promise, and a module the page already initialised is not loaded again.
 */
export const ready = (): Promise<unknown> => (started ??= init());
