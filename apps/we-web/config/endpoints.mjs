import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The endpoints this build serves, from `config/<COASYS_ENV>.json`, as the JSON text a vite `define`
 * inlines. `staging` when it is unset: a developer's build and a pull request preview must never
 * point at production's identity or store. Anything but the two names stops the build rather than
 * falling back to one of them. Both web entries (`apps/we-web`, `apps/coasys`) read it here.
 */
export function endpointsDefine() {
  const env = process.env.COASYS_ENV ?? 'staging';
  if (env !== 'production' && env !== 'staging') {
    throw new Error(`COASYS_ENV must be "production" or "staging", got "${env}"`);
  }
  return readFileSync(path.resolve(import.meta.dirname, `${env}.json`), 'utf8');
}
