/**
 * The generated classes carry the manifest's prose.
 *
 * The equivalence suite (backend-ad4m's coreManifest.test.ts) holds the *semantics* of the
 * generated classes and the manifest in agreement, but prose is invisible to it: a doc comment
 * edited in a manifest module without rerunning `generate:classes` would silently leave the class
 * file — where IDE hovers read it — telling the old story. This asserts every jsdoc block in every
 * manifest module appears in its generated class, whitespace-normalised, so a stale generation
 * fails loudly with the command that fixes it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const MANIFEST = resolve(__dirname, '../../../entities/src/manifest');
const SRC = resolve(__dirname, '../src/entities');

const REGENERATE = 'Generated classes are stale: run `pnpm --filter @we/backend-ad4m generate:classes`.';

const normalise = (doc: string) =>
  doc
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The doc blocks the codegen lifts — the class doc and each member's — mirroring its own
 * extraction. Deliberately not every comment in the module: prose that belongs to the manifest
 * alone (the docs on SpacePreference's sentinel constants, say) stays there on purpose.
 */
function liftedDocs(name: string, source: string): string[] {
  const out: string[] = [];
  const classDoc = source.match(new RegExp(String.raw`(\/\*\*(?:[^*]|\*(?!\/))*\*\/)\s*\nexport const ${name}`));
  if (classDoc) out.push(normalise(classDoc[1].slice(3, -2)));
  for (const m of source.matchAll(/(\/\*\*(?:[^*]|\*(?!\/))*\*\/)\s*\n\s*(\w+): \{/g)) {
    out.push(normalise(m[1].slice(3, -2)));
  }
  return out;
}

/** Every jsdoc body in the generated class, normalised the same way. */
function docBodies(source: string): string[] {
  return [...source.matchAll(/\/\*\*((?:[^*]|\*(?!\/))*)\*\//g)].map((m) => normalise(m[1]));
}

// Every authored entity module, less the shared machinery that declares no entity of its own.
const SUPPORT = new Set(['base.ts', 'defs.ts', 'index.ts', 'shared.ts', 'types.ts']);
const cases = readdirSync(MANIFEST)
  .filter((file) => file.endsWith('.ts') && !SUPPORT.has(file))
  .map((file) => ({ name: file.replace('.ts', '') }));

describe('the barrel exports every generated class', () => {
  /*
    The half the prose check could not see, and the one that actually bit.

    `generate:classes` wrote the class and updated `conformance.ts`, and left `index.ts` alone —
    which is a hand-maintained file whose own docblock said it was generated from the manifest. So
    adding an entity produced a conformance assertion referencing an export that did not exist, and
    the only symptom was a DTS build failing several steps later on a name nobody had typed. The
    prose test passed throughout: the class was there and its docs were right.

    The barrel is generated now, so this asserts the property rather than the practice — if it is
    ever un-generated, the failure names the missing entity instead of the build naming a type.
  */
  const barrel = readFileSync(resolve(SRC, 'index.ts'), 'utf8');

  it.each(cases)('$name', ({ name }) => {
    expect(barrel, `${name} is not exported from entities/index.ts.\n${REGENERATE}`).toContain(
      `export * from './${name}';`,
    );
  });

  it('and exports nothing the manifest does not declare', () => {
    // The other direction: a class left behind after its manifest entry was removed still exports,
    // and its conformance assertion is gone, so nothing else would say so.
    const exported = [...barrel.matchAll(/export \* from '\.\/([A-Za-z]+)';/g)].map((m) => m[1]);
    expect([...exported].sort()).toEqual(cases.map(({ name }) => name).sort());
  });
});

describe('generated classes carry the manifest prose', () => {
  it.each(cases)('$name', ({ name }) => {
    const manifestSrc = readFileSync(resolve(MANIFEST, `${name}.ts`), 'utf8');
    const classNormalised = docBodies(readFileSync(resolve(SRC, `${name}.ts`), 'utf8')).join('\n');
    for (const body of liftedDocs(name, manifestSrc)) {
      expect(classNormalised, `${name}: missing doc "${body.slice(0, 60)}…"\n${REGENERATE}`).toContain(body);
    }
  });
});
