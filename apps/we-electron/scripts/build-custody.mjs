#!/usr/bin/env node
/**
 * Builds the custody sidecar (`we-custody`, from `crates/custody`) in release, where main.js looks
 * for it in development and `electron-builder.config.js` copies it from when packaging.
 *
 * Nothing on Windows: the crate has no Windows support, and the app starts there without identity.
 * `--soft` (development) reports a failed build and carries on, so the app still starts, with identity off.
 */
import { spawnSync } from 'child_process';
import { resolve } from 'path';

const CRATE = resolve(import.meta.dirname, '..', '..', '..', 'crates', 'custody');
const soft = process.argv.includes('--soft');

if (process.platform === 'win32') {
  console.log('[build-custody] Windows: no custody sidecar; identity is off.');
  process.exit(0);
}

// From the crate's folder, so rustup takes the toolchain its `rust-toolchain.toml` pins.
const result = spawnSync('cargo', ['build', '--release', '--bin', 'we-custody'], { cwd: CRATE, stdio: 'inherit' });
if (result.status === 0) process.exit(0);

const why = result.error ? result.error.message : `cargo exited with ${result.status}`;
if (soft) {
  console.warn(`[build-custody] The custody sidecar did not build (${why}); the app starts with identity off.`);
  process.exit(0);
}
console.error(`[build-custody] The custody sidecar did not build: ${why}`);
process.exit(1);
