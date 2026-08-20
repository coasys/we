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

const MANIFEST = resolve(__dirname, '../../../models/src/manifest');
const SRC = resolve(__dirname, '../src/models');

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

const cases: { name: string; kind: 'entities' | 'blocks' }[] = [];
for (const kind of ['entities', 'blocks'] as const) {
  for (const file of readdirSync(resolve(MANIFEST, kind))) {
    cases.push({ name: file.replace('.ts', ''), kind });
  }
}

describe('generated classes carry the manifest prose', () => {
  it.each(cases)('$kind/$name', ({ name, kind }) => {
    const manifestSrc = readFileSync(resolve(MANIFEST, kind, `${name}.ts`), 'utf8');
    const classNormalised = docBodies(readFileSync(resolve(SRC, kind, `${name}.ts`), 'utf8')).join('\n');
    for (const body of liftedDocs(name, manifestSrc)) {
      expect(classNormalised, `${name}: missing doc "${body.slice(0, 60)}…"\n${REGENERATE}`).toContain(body);
    }
  });
});
