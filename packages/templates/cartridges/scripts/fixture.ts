/**
 * Print a cartridge as a fixture, for `we-render --fixture-file`.
 *
 *   pnpm --filter @we/template-cartridges fixture field-guide > /tmp/field-guide.json
 *   we-render --fixture-file /tmp/field-guide.json
 */
import { pathToFileURL } from 'node:url';

import type { Cartridge } from '../src/index.ts';
import * as cartridges from '../src/index.ts';

/*
  Only when run, never when imported. The schema audits import every module under
  packages/templates to walk what it exports, and a script that acted on import read the audit's own
  arguments as a cartridge id and exited, failing the audit.
*/
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();

function main(): void {
  const id = process.argv[2];
  const all = Object.values(cartridges).filter((v): v is Cartridge => !!v && typeof v === 'object' && 'shell' in v);
  const cartridge = all.find((c) => c.id === id);
  if (!cartridge) {
    console.error(`no cartridge "${id}" — have: ${all.map((c) => c.id).join(', ')}`);
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(cartridges.toFixture(cartridge)));
}
