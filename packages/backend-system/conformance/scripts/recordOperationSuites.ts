/**
 * Record the operation suites that need no backend — the static checks, the effect summary, the id
 * derivation and the RDF reading — into `vectors/operations/`, from the reference implementation.
 *
 * Run after changing a case or the reference: `pnpm --filter @we/backend-conformance record:suites`.
 * Each file's test re-records it and compares, so a change to a vector is a change to the contract
 * and its diff is what a reviewer reads.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { format, resolveConfig } from 'prettier';

import { recordEffects } from '../src/suites/effects';
import { recordIds } from '../src/suites/ids';
import { recordRdf } from '../src/suites/rdf';
import { recordStaticChecks } from '../src/suites/staticChecks';

const write = async (name: string, data: unknown) => {
  const path = fileURLToPath(new URL(`../vectors/operations/${name}`, import.meta.url));
  const options = (await resolveConfig(path)) ?? {};
  writeFileSync(path, await format(JSON.stringify(data), { ...options, filepath: path }));
  console.info(`wrote vectors/operations/${name}`);
};

await write('static-checks.json', recordStaticChecks());
await write('effects.json', recordEffects());
await write('ids.json', await recordIds());
await write('rdf.json', await recordRdf());
