import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { initSync } from '@coasys/identity-wasm';

/**
 * Starts `@coasys/identity-wasm` in Node from the package's own `.wasm`, for the tests and the fake
 * servers. The frame's `ready()` then finds it started and loads nothing.
 */
export function loadWasm(): void {
  initSync({ module: readFileSync(createRequire(import.meta.url).resolve('@coasys/identity-wasm/identity_bg.wasm')) });
}
