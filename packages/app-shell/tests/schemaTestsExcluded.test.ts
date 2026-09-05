/**
 * The schema-test harness must stay reachable only through a dynamic `import()`.
 *
 * ~97KB of test schemas shipped to every user for as long as this was guarded by
 * `import.meta.env.DEV` alone. The lesson is worth stating precisely, because the guard looked
 * exactly like exclusion: a branch decides whether a *value is used*, while a bundler answers to
 * whether a *module is reachable*. A top-level import is reachability, so the schemas stayed in the
 * bundle behind a condition that could never be true in the build that carried them.
 *
 * What replaced it is a property of the import graph rather than a flag: exactly one module names
 * the harness, and the only reference to that module is a dynamic import. That is a real guarantee —
 * and it is also one line away from being lost, with nothing failing when it is. Re-export the
 * harness from a barrel, or import it at the top of a layout "just for the type", and the bundle
 * silently grows back while every test still passes.
 *
 * Hence this file. It asserts the shape of the import graph, which is the thing actually doing the
 * work; a size assertion on a built artefact would need a build, and a flag assertion would pin the
 * mechanism that failed.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import * as schemas from '@shared/schemas';
import { describe, expect, it } from 'vitest';

/** The one module allowed to name the harness — itself reached only by `import()`. */
const OWNER = join('frameworks', 'solid', 'layouts', 'schemaTestsView.ts');

/**
 * The harness's own files, which naturally reference each other.
 *
 * Deliberately the *files* rather than the directory holding them. Exempting all of
 * `shared/schemas/shell` would exempt its `index.ts` — the barrel that re-exported the harness in
 * the first place, and the single most likely place for this to regress.
 */
const isHarness = (path: string) =>
  path.includes(join('shell', 'tests') + '/') || path.endsWith('SchemaTests.schema.ts');

const SRC = join(import.meta.dirname, '..', 'src');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

describe('schema-test harness exclusion', () => {
  it('is not re-exported from the schemas barrel', () => {
    /*
      A barrel re-export is a static import for everything that touches the barrel — and half the
      app touches this one. This was how the harness got into the bundle in the first place, and
      putting it back would be a one-line change that breaks nothing visible.
    */
    expect(Object.keys(schemas)).not.toContain('schemaTestsTemplate');
    expect(Object.keys(schemas)).not.toContain('schemaMutationActions');
    expect(Object.keys(schemas)).not.toContain('createTestStore');
  });

  it('is named by exactly one module, imports and re-exports alike', () => {
    const offenders = sourceFiles(SRC)
      .filter((path) => !path.includes(OWNER) && !isHarness(path))
      .filter((path) => {
        const source = readFileSync(path, 'utf8');
        /*
          `import ... from` and `export ... from` both, because a re-export is exactly as much of a
          static edge as an import — that is what a barrel *is*, and matching only `import` would
          miss the precise regression this test was written for.

          A dynamic `import('...')` is the sanctioned route and must not be flagged, which is why
          the match is anchored to a statement-leading keyword followed by `from`.
        */
        return /^(?:import|export)\s[^;]*\bfrom\s+['"][^'"]*(SchemaTests\.schema|shell\/tests\/)/m.test(source);
      })
      .map((path) => path.slice(SRC.length + 1));

    expect(offenders, 'only schemaTestsView.ts may name the harness — see its header').toEqual([]);
  });

  it('reaches its one owner through a dynamic import', () => {
    // The other half of the property: the owner being alone is worth nothing if something imports
    // *it* statically, which would simply move the boundary without removing it.
    const registry = readFileSync(join(SRC, 'frameworks', 'solid', 'layouts', 'shellViews.ts'), 'utf8');
    expect(registry).toMatch(/import\(['"]\.\/schemaTestsView['"]\)/);

    const staticImporters = sourceFiles(SRC)
      .filter((path) => !path.includes(OWNER))
      .filter((path) =>
        /^(?:import|export)\s[^;]*\bfrom\s+['"][^'"]*schemaTestsView['"]/m.test(readFileSync(path, 'utf8')),
      )
      .map((path) => path.slice(SRC.length + 1));

    expect(staticImporters, 'schemaTestsView must only ever be reached by import()').toEqual([]);
  });
});
