/**
 * The portable tier's own invariant, tested by the package it is about.
 *
 * This lived in `@we/template-kit`'s suite — a package testing its neighbour's contract — and
 * `@we/schema-kit` declared `vitest` in its devDependencies and had no `test` script, so the
 * dependency was never run and the audit counted this package as untested. Both facts had the same
 * cause: the one thing worth asserting about this package was asserted somewhere else.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The tier is a package boundary now, so it is checked against the package rather than the fixtures.
 *
 * The walk below tests *expansions*, which only covers fragments a fixture exists for — and when the
 * portable tier moved to `@we/schema-kit`, four collection fragments went with it that filter on
 * `spaceStore.mutedDids`, because none of them had one. They were store-namers sitting in the package
 * whose whole claim is that it names none, and nothing failed.
 *
 * Reading the source catches what no fixture set can promise to. Comments are stripped first: half
 * these files discuss `$store` in prose, and a test that cannot tell an explanation from a dependency
 * would be answered by rewording rather than by moving the fragment.
 */
describe('@we/schema-kit names no store, as a package', () => {
  const SRC = import.meta.dirname;

  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = resolve(dir, entry.name);
      return entry.isDirectory() ? sources(path) : entry.name.endsWith('.ts') ? [path] : [];
    });

  const withoutComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  /*
    What a store reference actually looks like now.

    The checks below it are `/\$store\s*:/` — a token #169 deleted — and `'$agent'`, so between them
    they matched nothing a fragment would write today and this walk passed for everything. Live
    evidence: `lists/kanbanBoard.ts` hard-coded `$action: 'spaceStore.moveChild'` inside the package
    whose one promise is that it names no store, in the file the README points at as the example,
    and the guard was green.

    Two spellings reach a store now: an expression whose reference starts at one
    (`{ $: 'spaceStore.x' }`) and an action naming one (`$action: 'spaceStore.y'`). Matched against
    the `…Store.` *shape* rather than a list of names, so a store added later is covered without
    this file being told about it.

    `modules.<id>.…` is deliberately not matched: a module namespace is optional by construction and
    resolves to nothing when the module is absent, which is degradation this tier is allowed.
  */
  const STORE_REFERENCE = /\$(?::|action:)?\s*['"`][a-z][A-Za-z]*Store\./;

  for (const file of sources(SRC)) {
    it(file.slice(SRC.length + 1), () => {
      const code = withoutComments(readFileSync(file, 'utf-8'));
      expect(code).not.toMatch(/\$store\s*:/);
      expect(code).not.toMatch(/'\$agent'/);
      expect(code, `${file} names a store — the portable tier takes one from its caller`).not.toMatch(STORE_REFERENCE);
    });
  }
});
