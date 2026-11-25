#!/usr/bin/env node
// Does anything that claims to be framework-neutral reach for Solid?
//
// Two places make that claim. `packages/app-shell/src/shared/` is the half of the shell that stores
// move into once they are written against `@we/reactivity`'s port instead of Solid, and a package
// whose package.json says `"we": { "neutral": true }` is one a host on another framework installs.
// A Solid import in either compiles, runs and passes every test under Solid, so nothing but a check
// notices — and the first to notice otherwise would be the second host.
//
// What counts as reaching for Solid, in an import, re-export, `import()` or `require`:
//
// - `solid-js` and its subpaths (`solid-js/store`, `solid-js/web`);
// - app-shell's `@solid/*` alias, and a relative path into a `frameworks/solid/` directory;
// - a workspace package that depends on solid-js (dependencies or peerDependencies), at its root or
//   any subpath, except the subpaths it lists in `"we": { "neutralExports": [...] }` — the way a
//   package with a neutral core and a Solid binding (`@we/design-utils` and its `/solid`) says which
//   is which.
//
// And a neutral package may not depend on solid-js, nor on a workspace package that depends on it
// without declaring which of its exports are neutral.
//
// Nothing is let through: every store and shared module was converted, so a Solid import under
// `shared/` now is a new one, and the binding it needs belongs in `frameworks/solid/` instead.
//
// Run: pnpm check:neutral-stores

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import ts from 'typescript';

const ROOT = resolve(import.meta.dirname, '..');
const SHARED = 'packages/app-shell/src/shared';
const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

const pkgFiles = execSync(
  `find packages apps -name package.json -not -path '*/node_modules/*' -not -path '*/target/*' -not -path '*/dist/*'`,
  { cwd: ROOT, encoding: 'utf8' },
)
  .trim()
  .split('\n');

const packages = new Map();
for (const file of pkgFiles) {
  const pkg = JSON.parse(readFileSync(join(ROOT, file), 'utf8'));
  if (!pkg.name) continue;
  const runtime = { ...pkg.dependencies, ...pkg.peerDependencies };
  packages.set(pkg.name, {
    name: pkg.name,
    dir: dirname(file),
    runtime: Object.keys(runtime),
    usesSolid: 'solid-js' in runtime,
    neutral: pkg.we?.neutral === true,
    neutralExports: new Set(pkg.we?.neutralExports ?? []),
  });
}

/** Why `specifier`, imported from `file`, is Solid — or null when it is not. */
function solidReason(specifier, file) {
  if (/^solid-js(\/|$)/.test(specifier)) return 'solid-js';
  if (specifier.startsWith('@solid/')) return "app-shell's Solid half";
  if (specifier.startsWith('.')) {
    const target = relative(ROOT, resolve(ROOT, dirname(file), specifier));
    return /(^|\/)frameworks\/solid(\/|$)/.test(target) ? "app-shell's Solid half" : null;
  }
  const match = /^(@[^/]+\/[^/]+|[^@][^/]*)(\/.*)?$/.exec(specifier);
  const pkg = match && packages.get(match[1]);
  if (!pkg?.usesSolid) return null;
  const subpath = `.${match[2] ?? ''}`;
  return pkg.neutralExports.has(subpath) ? null : `${pkg.name} depends on solid-js`;
}

/**
 * Every module `file` names — imports, `import type`, re-exports, `import()` and `require` — as
 * TypeScript's own pre-processor reads them, so a comment or a string about Solid is not an import.
 */
function solidImports(file) {
  const { importedFiles } = ts.preProcessFile(readFileSync(join(ROOT, file), 'utf8'), true, true);
  const found = [];
  for (const { fileName: specifier } of importedFiles) {
    const reason = solidReason(specifier, file);
    if (reason) found.push(`'${specifier}' (${reason})`);
  }
  return found;
}

const listFiles = (dir) =>
  existsSync(join(ROOT, dir))
    ? execSync(`find ${JSON.stringify(dir)} -type f -not -path '*/node_modules/*' -not -path '*/dist/*'`, {
        cwd: ROOT,
        encoding: 'utf8',
      })
        .trim()
        .split('\n')
        .filter((f) => SOURCE.test(f))
        .sort()
    : [];

const problems = [];

for (const file of listFiles(SHARED)) {
  const found = solidImports(file);
  if (found.length > 0) {
    problems.push(`${file} imports ${found.join(', ')}. Take reactivity from the ReactivityPort instead.`);
  }
}

const neutral = [...packages.values()].filter((p) => p.neutral);
for (const pkg of neutral) {
  for (const dep of pkg.runtime) {
    const target = packages.get(dep);
    if (dep === 'solid-js') {
      problems.push(`${pkg.name} is marked neutral and depends on solid-js.`);
    } else if (target?.usesSolid && target.neutralExports.size === 0) {
      problems.push(`${pkg.name} is marked neutral and depends on ${dep}, which depends on solid-js.`);
    }
  }
  for (const file of listFiles(join(pkg.dir, 'src'))) {
    const found = solidImports(file);
    if (found.length > 0) problems.push(`${file} (${pkg.name}, marked neutral) imports ${found.join(', ')}.`);
  }
}

if (problems.length > 0) {
  console.error(`check:neutral-stores — ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`check:neutral-stores — ${SHARED}/ and ${neutral.length} neutral packages are free of Solid.`);
