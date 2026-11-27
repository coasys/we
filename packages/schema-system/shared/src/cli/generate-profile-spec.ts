#!/usr/bin/env node
/**
 * Writes the capability profiles' language-neutral listing into `docs/spec/profiles/`.
 *
 * Run by the package build, so a profile edited without regenerating leaves the build changing a
 * tracked file, which CI refuses. Run it by hand with `pnpm --filter @we/schema-shared
 * generate:profiles`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderProfileSpec } from '../profiles/spec';

const specDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../docs/spec/profiles');
const { json, markdown } = renderProfileSpec();

mkdirSync(specDir, { recursive: true });
writeFileSync(resolve(specDir, 'profiles.json'), json, 'utf-8');
writeFileSync(resolve(specDir, 'members.md'), markdown, 'utf-8');
console.log(`Wrote the capability profiles to ${specDir}`);
