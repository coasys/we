/**
 * Generate the AD4M-decorated classes from the authored manifest.
 *
 * The manifest under `src/manifest/` is the source of truth for the core vocabulary; the class
 * files under `src/entities/` and `src/blocks/` are its artifact — same paths and export names
 * they had when hand-written, so nothing that imports them notices the flip. Doc comments are
 * lifted from the manifest modules, where they are edited, into the emitted classes, where IDE
 * hovers read them.
 *
 *   node scripts/generateClasses.mjs   # then `pnpm exec prettier --write` runs on the output
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
const { CORE_DEFS } = await import(resolve(here, '../src/manifest/index.ts'));

const ENTITY_DIR = resolve(here, '../src/entities');
const BLOCK_DIR = resolve(here, '../src/blocks');
const MANIFEST_DIR = resolve(here, '../src/manifest');

const isBlockModule = (name) => {
  try {
    readFileSync(resolve(MANIFEST_DIR, 'blocks', `${name}.ts`));
    return true;
  } catch {
    return false;
  }
};

// ── Comments, lifted from the manifest module the definition was authored in ──────────────────

function extractDocs(name, kind) {
  const src = readFileSync(resolve(MANIFEST_DIR, kind, `${name}.ts`), 'utf8');
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

const TS_TYPE = { string: 'string', number: 'number', boolean: 'boolean', date: 'string', datetime: 'string', json: 'string' };

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
  const kind = isBlockModule(name) ? 'blocks' : 'entities';
  const { classDoc, memberDocs } = extractDocs(name, kind);
  const e = def.entity;

  const ad4mImports = new Set(['Model']);
  const relativeImports = new Map(); // path → names
  const addRelative = (path, what) => {
    if (!relativeImports.has(path)) relativeImports.set(path, new Set());
    relativeImports.get(path).add(what);
  };

  if (def.base === 'WeNode') addRelative('../WeNode', 'WeNode');
  else ad4mImports.add('Ad4mModel');
  if (e.flag) ad4mImports.add('Flag');
  if (Object.keys(e.properties).length) ad4mImports.add('Property');
  if (Object.values(e.properties).some((p) => p.format === 'file')) addRelative('../constants', 'FILE_STORAGE_LANGUAGE');
  if (Object.values(e.properties).some((p) => p.readAs === 'dataUri')) ad4mImports.add('fileToDataUri');

  const relations = Object.entries(e.relations);
  if (relations.some(([, r]) => r.cardinality === 'many')) ad4mImports.add('HasMany');
  if (relations.some(([, r]) => r.cardinality === 'one')) ad4mImports.add('HasOne');
  const manyMethods = (def.methodRelations ?? []).filter((r) => e.relations[r]?.cardinality === 'many');
  if (manyMethods.length) ad4mImports.add('HasManyMethods');

  const targetPath = (target) => {
    const targetKind = isBlockModule(target) ? 'blocks' : 'entities';
    return targetKind === kind ? `./${target}` : `../${targetKind}/${target}`;
  };
  for (const [, r] of relations) if (r.target) addRelative(targetPath(r.target), r.target);

  const L = [];
  L.push('/**');
  L.push(` * GENERATED from src/manifest/${kind}/${name}.ts — do not edit here.`);
  L.push(' *');
  L.push(' * The manifest module is the source of truth: its schema, hints and prose. Rebuild with');
  L.push(' * `pnpm --filter @we/models generate:classes` after changing it.');
  L.push(' */');
  const ci = [...ad4mImports].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  L.push(`import { ${ci.join(', ')} } from '@coasys/ad4m';`);
  L.push('');
  const rels = [...relativeImports.entries()].sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()));
  for (const [path, names] of rels) L.push(`import { ${[...names].join(', ')} } from '${path}';`);
  if (rels.length) L.push('');

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
      L.push(`  @HasOne(() => ${spec.target}, { through: ${q(spec.predicate)} })`);
      L.push(`  ${rname}?: ${spec.target};`);
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

  const setters = relations.filter(([, r]) => r.cardinality === 'one');
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

  for (const line of def.passthrough ?? []) {
    L.push('');
    L.push(line);
  }
  L.push('');

  const outDir = kind === 'blocks' ? BLOCK_DIR : ENTITY_DIR;
  writeFileSync(resolve(outDir, `${name}.ts`), L.join('\n'));
  return `${kind}/${name}.ts`;
}

const written = Object.entries(CORE_DEFS).map(([name, def]) => emitEntity(name, def));
console.log(`generated ${written.length} classes`);
try {
  execFileSync('pnpm', ['exec', 'prettier', '--write', ...written.map((f) => resolve(here, '../src', f))], {
    cwd: resolve(here, '..'),
    stdio: 'inherit',
  });
} catch {
  console.warn('prettier not available — emitted unformatted');
}
