#!/usr/bin/env node
// Does every consumer of a source-shipping package know it has to?
//
// Some packages here ship raw TypeScript rather than a built `dist` — `@we/schema-kit`, the
// `@we/template-*` family, `@we/app-shell`'s shared entry — and their sources import each other with
// explicit `.ts` specifiers. TypeScript only accepts those under `allowImportingTsExtensions`, and
// that flag cannot be a workspace default because it requires `noEmit` or `emitDeclarationOnly` and
// half the workspace emits. So the requirement has to travel from a package to its consumers, and
// there is no mechanism in tsconfig that makes it travel.
//
// It did not travel. `@we/playground-portable-slice` consumed `@we/schema-kit` without the flag and
// produced 29 errors in a package whose own source was fine — a red `pnpm typecheck` that said
// nothing about the code anybody had written. This script is the mechanism: it fails the build with
// the name of the package to fix and the line to add, instead of leaving it to be discovered.
//
// Run: pnpm check:source-consumers

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

// tsconfig files are JSONC: line comments, block comments and trailing commas all appear in this
// repo. Strings are matched first so a `//` inside one is not mistaken for a comment.
const stripJsonc = (s) =>
  s
    .replace(/"(?:[^"\\]|\\.)*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => (m.startsWith('"') ? m : ''))
    .replace(/,(\s*[}\]])/g, '$1');
const readJson = (p) => JSON.parse(stripJsonc(readFileSync(p, 'utf8')));

const pkgFiles = execSync(
  `find packages apps -name package.json -not -path '*/node_modules/*' -not -path '*/target/*' -not -path '*/dist/*'`,
  { cwd: ROOT, encoding: 'utf8' },
)
  .trim()
  .split('\n')
  .map((p) => join(ROOT, p));

/** Every option in effect for a tsconfig, following `extends` to the root. */
function resolveOptions(tsconfigPath) {
  if (!existsSync(tsconfigPath)) return null;
  const cfg = readJson(tsconfigPath);
  const own = cfg.compilerOptions ?? {};
  if (!cfg.extends) return own;
  const parent = resolveOptions(resolve(dirname(tsconfigPath), cfg.extends));
  return { ...(parent ?? {}), ...own };
}

const packages = [];
for (const file of pkgFiles) {
  const pkg = readJson(file);
  if (!pkg.name) continue;
  const dir = dirname(file);
  packages.push({
    name: pkg.name,
    dir,
    pkg,
    deps: Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies }),
  });
}

const byName = new Map(packages.map((p) => [p.name, p]));

// A package ships source if any export target is a `.ts` file under src. Only these propagate the
// requirement: one that ships a built `dist` hides its own `.ts` specifiers behind `.d.ts`, so its
// consumers compile none of its source and need nothing.
const shipsSource = new Set();
const hasTsSpecifiers = new Set();
for (const p of packages) {
  const exportsBlob = JSON.stringify(p.pkg.exports ?? {});
  if (!/\.\/src\/[^"]*\.tsx?"/.test(exportsBlob)) continue;
  shipsSource.add(p.name);
  const hits = execSync(`grep -rhoE "from '[^']*\\.tsx?'" ${JSON.stringify(join(p.dir, 'src'))} 2>/dev/null | wc -l`, {
    encoding: 'utf8',
    shell: '/bin/bash',
  }).trim();
  if (Number(hits) > 0) hasTsSpecifiers.add(p.name);
}

// The requirement is transitive along source-shipping edges, which is exactly how the original
// failure escaped notice: the playground never named `@we/schema-kit` — it depended on `@we/editor`,
// whose own source (compiled as part of the playground's program) imports schema-kit with `.ts`
// specifiers. Checking direct dependencies alone reports that package as clean.
const requiresFlag = new Set(hasTsSpecifiers);
for (let changed = true; changed;) {
  changed = false;
  for (const name of shipsSource) {
    if (requiresFlag.has(name)) continue;
    const deps = byName.get(name)?.deps ?? [];
    if (deps.some((d) => requiresFlag.has(d))) {
      requiresFlag.add(name);
      changed = true;
    }
  }
}

const failures = [];
for (const p of packages) {
  const needed = p.deps.filter((d) => requiresFlag.has(d));
  if (!needed.length) continue;
  const opts = resolveOptions(join(p.dir, 'tsconfig.json'));
  if (opts === null) continue; // no tsconfig of its own; nothing typechecks it here
  if (opts.allowImportingTsExtensions === true) continue;
  failures.push({ name: p.name, dir: p.dir.replace(ROOT + '/', ''), needed });
}

if (failures.length) {
  console.error('\n✗ Packages consuming a source-shipping package without `allowImportingTsExtensions`:\n');
  for (const f of failures) {
    console.error(`  ${f.name}  (${f.dir}/tsconfig.json)`);
    console.error(`      depends on: ${f.needed.join(', ')}`);
  }
  console.error('\nEach of those packages ships raw .ts and imports with explicit .ts specifiers.');
  console.error("Add to the consumer's tsconfig.json compilerOptions:\n");
  console.error('      "allowImportingTsExtensions": true\n');
  console.error('(It requires "noEmit": true or "emitDeclarationOnly": true, which these already set.)\n');
  process.exit(1);
}

console.log(
  `✓ ${requiresFlag.size} package(s) propagate .ts specifiers; every consumer sets allowImportingTsExtensions`,
);
