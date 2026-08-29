/**
 * Generate the AD4M-decorated classes from the authored manifest.
 *
 * The manifest under `src/manifest/` is the source of truth for the core vocabulary; the class
 * files under `src/entities/` are its artifact. Doc comments are lifted from the manifest modules,
 * where they are edited, into the emitted classes, where IDE hovers read them.
 *
 * Both sides are one flat directory. They used to be split `entities/` beside `blocks/`, which read
 * as two kinds of declaration when the manifest has only ever had one map — and which made
 * blockness a fact about a file's location that nothing could check. It is now
 * `EntitySchema.blockable`, and `validateManifest` enforces the `version` rule that goes with it.
 *
 *   node scripts/generateClasses.mjs   # then `pnpm exec prettier --write` runs on the output
 *
 * Also emits `src/manifest/types.ts` — the neutral per-entity interfaces that ARE the model
 * contract — and `src/manifest/conformance.ts`, whose type-level assertions hold the generated
 * AD4M classes to them at build time. A new backend implements the interfaces; the AD4M lane is
 * checked against them like any other.
 *
 * `coreManifest.test.ts` (backend-ad4m) holds the emitted classes and the manifest's runtime
 * compilation in exhaustive agreement — a codegen bug fails there rather than drifting.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Run via tsx (`pnpm generate:classes`), which resolves the manifest's TS modules directly.
const here = dirname(fileURLToPath(import.meta.url));
const { CORE_DEFS } = await import(resolve(here, '../../../entities/src/manifest/index.ts'));

const ENTITY_DIR = resolve(here, '../src/entities');
const MANIFEST_DIR = resolve(here, '../../../entities/src/manifest');

// ── Comments, lifted from the manifest module the definition was authored in ──────────────────

function extractDocs(name) {
  const src = readFileSync(resolve(MANIFEST_DIR, `${name}.ts`), 'utf8');
  const comment = /\/\*\*(?:[^*]|\*(?!\/))*\*\//y;
  const classDoc = src.match(new RegExp(String.raw`(\/\*\*(?:[^*]|\*(?!\/))*\*\/)\s*\nexport const ${name}`));
  const memberDocs = {};
  for (const m of src.matchAll(/(\/\*\*(?:[^*]|\*(?!\/))*\*\/)\s*\n\s*(\w+): \{/g)) {
    memberDocs[m[2]] = m[1];
  }
  void comment;
  return { classDoc: classDoc?.[1], memberDocs };
}

/** Re-indent a lifted jsdoc block to class-member depth. */
function indentDoc(doc, pad) {
  return doc
    .split('\n')
    .map((line, i) => (i === 0 ? pad + line.trim() : `${pad} ${line.trim()}`))
    .join('\n');
}

// ── Emission ───────────────────────────────────────────────────────────────────────────────────

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;

const TS_TYPE = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  date: 'string',
  datetime: 'string',
  json: 'string',
};

function propertyDecorator(spec) {
  const opts = [`through: ${q(spec.predicate)}`];
  if (spec.required) opts.push('required: true');
  if (spec.identity) opts.push('identity: true');
  if (spec.format === 'file') opts.push('resolveLanguage: FILE_STORAGE_LANGUAGE');
  if (spec.readAs === 'dataUri') opts.push('transform: fileToDataUri');
  if (spec.interpretationHint !== undefined) opts.push(`interpretationHint: ${q(spec.interpretationHint)}`);
  return `@Property({ ${opts.join(', ')} })`;
}

function fieldLine(name, spec, def) {
  const alias = def.unions?.[name]?.alias;
  const base = alias ?? TS_TYPE[spec.type];
  if (def.optional?.includes(name)) return `${name}?: ${base};`;
  if (spec.default === null) return `${name}: ${base} | null = null;`;
  const dflt = spec.default !== undefined ? spec.default : TS_TYPE[spec.type] === 'string' ? '' : undefined;
  if (dflt === undefined) return `${name}?: ${base};`;
  const literal = typeof dflt === 'string' ? q(dflt) : String(dflt);
  return `${name}: ${base} = ${literal};`;
}

const pascal = (s) => s[0].toUpperCase() + s.slice(1);

function emitEntity(name, def) {
  const { classDoc, memberDocs } = extractDocs(name);
  const e = def.entity;

  const ad4mImports = new Set(['Model']);
  const relativeImports = new Map(); // path → names
  const addRelative = (path, what) => {
    if (!relativeImports.has(path)) relativeImports.set(path, new Set());
    relativeImports.get(path).add(what);
  };

  if (def.base === 'WeNode') addRelative('./WeNode', 'WeNode');
  else ad4mImports.add('Ad4mModel');
  if (e.flag) ad4mImports.add('Flag');
  if (Object.keys(e.properties).length) ad4mImports.add('Property');
  if (Object.values(e.properties).some((p) => p.format === 'file'))
    addRelative('@we/entities', 'FILE_STORAGE_LANGUAGE');
  if (Object.values(e.properties).some((p) => p.readAs === 'dataUri')) ad4mImports.add('fileToDataUri');

  const relations = Object.entries(e.relations);
  if (relations.some(([, r]) => r.cardinality === 'many')) ad4mImports.add('HasMany');
  if (relations.some(([, r]) => r.cardinality === 'one')) ad4mImports.add('HasOne');
  const manyMethods = (def.methodRelations ?? []).filter((r) => e.relations[r]?.cardinality === 'many');
  if (manyMethods.length) ad4mImports.add('HasManyMethods');

  for (const [, r] of relations) if (r.target) addRelative(`./${r.target}`, r.target);

  const L = [];
  L.push('/**');
  L.push(` * GENERATED from src/manifest/${name}.ts — do not edit here.`);
  L.push(' *');
  L.push(' * The manifest module is the source of truth: its schema, hints and prose. Rebuild with');
  L.push(' * `pnpm --filter @we/entities generate:classes` after changing it.');
  L.push(' */');
  // One package-import group (the sorter keeps @coasys and @we lines adjacent), a blank line,
  // then the relative imports — so the file lints clean exactly as generated.
  const ci = [...ad4mImports].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const rels = [...relativeImports.entries()].sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const pkgRels = rels.filter(([path]) => !path.startsWith('.'));
  const localRels = rels.filter(([path]) => path.startsWith('.'));
  L.push(`import { ${ci.join(', ')} } from '@coasys/ad4m';`);
  for (const [path, names] of pkgRels) L.push(`import { ${[...names].join(', ')} } from '${path}';`);
  L.push('');
  for (const [path, names] of localRels) L.push(`import { ${[...names].join(', ')} } from '${path}';`);
  if (localRels.length) L.push('');

  for (const [field, u] of Object.entries(def.unions ?? {})) {
    void field;
    L.push(`export type ${u.alias} = ${u.values.map(q).join(' | ')};`);
  }
  if (def.unions) L.push('');

  if (classDoc) L.push(classDoc);
  const modelOpts = [`name: ${q(name)}`];
  if (e.interpretationHint !== undefined) modelOpts.push(`interpretationHint: ${q(e.interpretationHint)}`);
  L.push(`@Model({ ${modelOpts.join(', ')} })`);
  L.push(`export class ${name} extends ${def.base === 'WeNode' ? 'WeNode' : 'Ad4mModel'} {`);

  if (e.flag) {
    L.push(`  @Flag({ through: ${q(e.flag.predicate)}, value: ${q(e.flag.value)} })`);
    L.push(`  flag: string = '';`);
    L.push('');
  }

  for (const [pname, spec] of Object.entries(e.properties)) {
    if (memberDocs[pname]) L.push(indentDoc(memberDocs[pname], '  '));
    L.push(`  ${propertyDecorator(spec)}`);
    L.push(`  ${fieldLine(pname, spec, def)}`);
    L.push('');
  }

  for (const [rname, spec] of Object.entries(e.relations)) {
    if (memberDocs[rname]) L.push(indentDoc(memberDocs[rname], '  '));
    if (spec.cardinality === 'one') {
      // An untyped to-one — a reference to whatever, the counterpart of the untyped to-many below.
      // It holds a URI rather than an instance, since there is no class to hydrate it into, and it
      // gets no `set<Name>` companion for the same reason: the accessor's whole signature is its
      // target type.
      const decorator = spec.target
        ? `@HasOne(() => ${spec.target}, { through: ${q(spec.predicate)} })`
        : `@HasOne({ through: ${q(spec.predicate)} })`;
      L.push(`  ${decorator}`);
      L.push(`  ${rname}?: ${spec.target ? spec.target : 'string'};`);
    } else {
      const decorator = spec.target
        ? `@HasMany(() => ${spec.target}, { through: ${q(spec.predicate)} })`
        : `@HasMany({ through: ${q(spec.predicate)} })`;
      const fieldType = def.typedArrays?.includes(rname) ? `${spec.target}[]` : 'string[]';
      L.push(`  ${decorator}`);
      L.push(`  ${rname}: ${fieldType} = [];`);
    }
    L.push('');
  }
  while (L[L.length - 1] === '') L.pop();
  L.push('}');

  // Typed to-ones only: `set<Name>(value: T)` has no signature to declare without a target class.
  const setters = relations.filter(([, r]) => r.cardinality === 'one' && r.target);
  if (manyMethods.length || setters.length) {
    L.push('');
    if (manyMethods.length) {
      L.push(`export interface ${name} extends HasManyMethods<${manyMethods.map((m) => q(m)).join(' | ')}> {}`);
    } else {
      L.push(`export interface ${name} {`);
      for (const [rname, r] of setters) {
        L.push(`  /** Generated by @HasOne — links a new ${r.target} as this ${name.toLowerCase()}'s ${rname}. */`);
        L.push(`  set${pascal(rname)}(value: ${r.target}): Promise<void>;`);
      }
      L.push('}');
    }
  }

  L.push('');

  writeFileSync(resolve(ENTITY_DIR, `${name}.ts`), L.join('\n'));
  return `entities/${name}.ts`;
}

function emitConformance(defs) {
  const L = [];
  L.push('/**');
  L.push(' * GENERATED — the AD4M classes, held to the neutral contract.');
  L.push(' *');
  L.push(' * Type-level only: each assertion fails compilation when a generated class stops satisfying');
  L.push(' * its interface in types.ts, so the contract cannot drift from the one implementation that');
  L.push(' * ships. Reached from the manifest entry point as a type export, which is what places this');
  L.push(" * file in the build's type graph — an unimported assertion checks nothing.");
  L.push(' */');
  // One import group, no blank line — matching the repo's import sorter so the file lints clean
  // exactly as generated.
  L.push("import type * as M from '@we/entities/manifest';");
  L.push('');
  L.push("import type * as C from './index';");
  L.push('');
  L.push('type Satisfies<A extends B, B> = A;');
  L.push('');
  L.push('/** One entry per entity; the tuple exists so every assertion is referenced. */');
  L.push('export type AssertClassesSatisfyContract = [');
  for (const name of Object.keys(defs)) {
    L.push(`  Satisfies<InstanceType<typeof C.${name}>, M.${name}Record>,`);
  }
  L.push('];');
  L.push('');
  L.push('/*');
  L.push(' * The STATIC surface (EntityStatic, what the entity proxies are typed as) is deliberately not');
  L.push(' * asserted here: the AD4M statics are `this`-polymorphic generics — `this: typeof Ad4mModel &');
  L.push(' * (new (…) => T)` — and a detached method carrying that constraint satisfies no interface');
  L.push(' * member, however compatible the call actually is. The guarantee is held at runtime instead:');
  L.push(' * the proxy binds `this` at call time, and every store call in the test suite exercises the');
  L.push(' * statics through the same proxies production uses.');
  L.push(' */');
  L.push('');
  writeFileSync(resolve(here, '../src/entities/conformance.ts'), L.join('\n'));
}

const written = Object.entries(CORE_DEFS).map(([name, def]) => emitEntity(name, def));
emitConformance(CORE_DEFS);
written.push('entities/conformance.ts');
console.log(`generated ${written.length - 2} classes + the neutral type surface`);
try {
  execFileSync('pnpm', ['exec', 'prettier', '--write', ...written.map((f) => resolve(here, '../src', f))], {
    cwd: resolve(here, '..'),
    stdio: 'inherit',
  });
} catch {
  console.warn('prettier not available — emitted unformatted');
}
