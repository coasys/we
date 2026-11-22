import { readFileSync } from 'node:fs';
import path from 'node:path';

const ENVS = ['production', 'staging', 'e2e'];

/**
 * The endpoints this build serves: `config/<COASYS_ENV>.json`, `staging` when unset (a developer's
 * build must never point at production). The store's head key is deployment data, not source:
 * `COASYS_STORE_KEY` supplies it for `production` and `staging`; `e2e` carries its own. Each value
 * is one place: the auth domain, the platform, the store, the Pages project and branch.
 */
export function endpoints(env = process.env.COASYS_ENV ?? 'staging', storeKey = process.env.COASYS_STORE_KEY) {
  if (!ENVS.includes(env)) throw new Error(`COASYS_ENV must be one of ${ENVS.join(', ')}, got "${env}"`);
  const file = JSON.parse(readFileSync(path.resolve(import.meta.dirname, `${env}.json`), 'utf8'));
  const result = { connectExtra: [], ...file, env, storeKey: file.storeKey ?? storeKey };
  if (!result.storeKey?.startsWith('did:key:')) {
    throw new Error("COASYS_STORE_KEY must name the store's head key as a did:key");
  }
  return result;
}
