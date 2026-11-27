#!/usr/bin/env node
// Does anything that claims to be framework-neutral reach for Solid — or, for the stores, for the
// browser?
//
// Two places make the first claim. `packages/app-shell/src/shared/` is the half of the shell that
// stores move into once they are written against `@we/reactivity`'s port instead of Solid, and a
// package whose package.json says `"we": { "neutral": true }` is one a host on another framework
// installs. A Solid import in either compiles, runs and passes every test under Solid, so nothing but
// a check notices — and the first to notice otherwise would be the second host.
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
// The second claim is the stores' and the kernels' (`shared/stores/`, `shared/kernels/`): they run
// wherever the platform port is implemented, so they read no browser global — `window`, `document`,
// storage, `navigator`, the address and history, media queries, animation frames, DOM constructors.
// A store reading one runs in a browser and under jsdom, so again only a check notices. What counts
// is a reference to the global in a value position (`typeof window` included, a type annotation
// not), and `globalThis.<name>`; a name the file declares itself (a local `document`) is its own.
// Timers and `performance` are left alone: every JavaScript runtime has them. The rest of `shared/`
// is not held to this: its browser modules (safe mode, the boot snapshot) are the platform's side.
//
// Run: pnpm check:neutral-stores

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import ts from 'typescript';

const ROOT = resolve(import.meta.dirname, '..');
const SHARED = 'packages/app-shell/src/shared';
/** Where no browser global may be read: what the platform port is for. */
const PLATFORM_NEUTRAL = [`${SHARED}/stores`, `${SHARED}/kernels`];
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

/** The browser's globals a store or kernel reaches through the platform port instead. */
const BROWSER_GLOBALS = new Set([
  'window',
  'self',
  'document',
  'localStorage',
  'sessionStorage',
  'navigator',
  'location',
  'history',
  'screen',
  'innerWidth',
  'innerHeight',
  'matchMedia',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'getComputedStyle',
  'CSS',
  'addEventListener',
  'removeEventListener',
  'dispatchEvent',
  'alert',
  'confirm',
  'ResizeObserver',
  'MutationObserver',
  'IntersectionObserver',
  'DOMParser',
  'FileReader',
  'Image',
  'Node',
  'Element',
  'HTMLElement',
  'Event',
  'CustomEvent',
  'KeyboardEvent',
  'MouseEvent',
  'PointerEvent',
  'PopStateEvent',
]);

/** Whether `id` names something rather than reads it: a declaration, a property, an import's name. */
function isName(id) {
  const parent = id.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === id) return true;
  if (ts.isQualifiedName(parent) && parent.right === id) return true;
  if (ts.isBindingElement(parent) && parent.propertyName === id) return true;
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return true;
  return (
    'name' in parent &&
    parent.name === id &&
    !ts.isShorthandPropertyAssignment(parent) &&
    !ts.isPropertyAccessExpression(parent)
  );
}

/** Whether `node` sits in a type, where a browser type (`KeyboardEvent`) costs nothing at run time. */
function inType(node) {
  for (let at = node.parent; at && !ts.isSourceFile(at); at = at.parent) {
    // A type query (`ReturnType<typeof setTimeout>`) is a type node too; `typeof x` in code is not.
    if (ts.isTypeNode(at)) return true;
    if (ts.isInterfaceDeclaration(at) || ts.isTypeAliasDeclaration(at)) return true;
    if (ts.isHeritageClause(at) && at.token === ts.SyntaxKind.ImplementsKeyword) return true;
  }
  return false;
}

/** Every name the file declares — a local `document`, a parameter named `history` — which are its own. */
function declaredNames(source) {
  const names = new Set();
  const bind = (name) => {
    if (ts.isIdentifier(name)) names.add(name.text);
    else for (const element of name.elements) if (!ts.isOmittedExpression(element)) bind(element.name);
  };
  const visit = (node) => {
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) &&
      node.name &&
      !ts.isBindingElement(node)
    )
      bind(node.name);
    else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) names.add(node.name.text);
    else if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) names.add(node.name.text);
    else if (ts.isImportClause(node) && node.name) names.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

/** Where `file` reads a browser global, as `line: name`. */
function browserGlobals(file) {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const own = declaredNames(source);
  const found = [];
  const report = (node, name) =>
    found.push(`${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${name}`);
  const visit = (node) => {
    if (
      ts.isIdentifier(node) &&
      BROWSER_GLOBALS.has(node.text) &&
      !own.has(node.text) &&
      !isName(node) &&
      !inType(node)
    )
      report(node, node.text);
    else if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'globalThis' &&
      BROWSER_GLOBALS.has(node.name.text)
    )
      report(node, `globalThis.${node.name.text}`);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const problems = [];

for (const file of listFiles(SHARED)) {
  const found = solidImports(file);
  if (found.length > 0) {
    problems.push(`${file} imports ${found.join(', ')}. Take reactivity from the ReactivityPort instead.`);
  }
}

let platformFiles = 0;
for (const dir of PLATFORM_NEUTRAL) {
  for (const file of listFiles(dir)) {
    platformFiles++;
    const found = browserGlobals(file);
    if (found.length > 0) {
      problems.push(
        `${file} reads the browser's ${found.join(', ')}. Take it from the platform port (\`platform\`) instead.`,
      );
    }
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
console.log(
  `check:neutral-stores — ${SHARED}/ and ${neutral.length} neutral packages are free of Solid, and ${platformFiles} files under ${PLATFORM_NEUTRAL.join(', ')} read no browser global.`,
);
