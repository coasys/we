/**
 * Generate the neutral type surface from the manifest definitions.
 *
 * `src/manifest/types.ts` — one interface per entity over the contract base — is the model
 * contract itself: what the entity proxies are typed as, and what any backend's implementations
 * are held to (the AD4M lane's conformance assertions live beside its generated classes in
 * `@we/backend-ad4m`). Run via tsx: `pnpm --filter @we/models generate:types`.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const { CORE_DEFS } = await import(resolve(here, '../src/manifest/index.ts'));

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
const TS_TYPE = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  date: 'string',
  datetime: 'string',
  json: 'string',
};

/** The interface field for one property — same optional/default rules the class emission uses. */
function interfaceFieldLine(name, spec, def) {
  const union = def.unions?.[name];
  const base = union ? union.values.map(q).join(' | ') : TS_TYPE[spec.type];
  if (def.optional?.includes(name)) return `${name}?: ${base};`;
  if (spec.default === null) return `${name}: ${base} | null;`;
  const hasDefault = spec.default !== undefined || TS_TYPE[spec.type] === 'string';
  return hasDefault ? `${name}: ${base};` : `${name}?: ${base};`;
}

function emitTypes(defs) {
  const L = [];
  L.push('/**');
  L.push(' * GENERATED from the manifest definitions — do not edit here.');
  L.push(' *');
  L.push(' * The neutral model contract: one interface per core entity, defining the fields any backend');
  L.push(" * must present for it. The AD4M lane's generated classes are held to these by the conformance");
  L.push(" * assertions beside them (@we/backend-ad4m src/models/conformance.ts); another backend's");
  L.push(' * implementations (runtime-compiled like backend-inmemory, or generated) are what these');
  L.push(' * interfaces exist to type. Fields and the accessor methods consumers call — query sugar is');
  L.push(' * backend ergonomics, not contract.');
  L.push(' *');
  L.push(' * Rebuild with `pnpm --filter @we/models generate:types`.');
  L.push(' */');
  L.push("import type { ModelInstance, WeNodeModel } from './base';");
  L.push('');
  L.push('export type { ModelInstance, WeNodeModel };');
  L.push('');
  // Named aliases for the closed vocabularies, exported from the package root — consumers import
  // SignalMode from '@we/models' exactly as they did when the class file declared it.
  for (const def of Object.values(defs)) {
    for (const u of Object.values(def.unions ?? {})) {
      L.push(`export type ${u.alias} = ${u.values.map(q).join(' | ')};`);
    }
  }
  L.push('');
  for (const [name, def] of Object.entries(defs)) {
    const e = def.entity;
    L.push(`export interface ${name}Model extends ${def.base === 'WeNode' ? 'WeNodeModel' : 'ModelInstance'} {`);
    for (const [pname, spec] of Object.entries(e.properties)) {
      L.push(`  ${interfaceFieldLine(pname, spec, def)}`);
    }
    for (const [rname, spec] of Object.entries(e.relations)) {
      if (spec.cardinality === 'one') L.push(`  ${rname}?: ${spec.target}Model;`);
      else L.push(`  ${rname}: ${def.typedArrays?.includes(rname) ? `${spec.target}Model[]` : 'string[]'};`);
    }
    for (const [rname, spec] of Object.entries(e.relations)) {
      const cap = rname[0].toUpperCase() + rname.slice(1);
      if (spec.cardinality === 'one') {
        L.push(`  set${cap}(value: ${spec.target}Model): Promise<unknown>;`);
      } else if (def.methodRelations?.includes(rname)) {
        L.push(`  add${cap}(value: string | { id: string }, batch?: string): Promise<unknown>;`);
        L.push(`  remove${cap}(value: string | { id: string }, batch?: string): Promise<unknown>;`);
        L.push(`  set${cap}(values: (string | { id: string })[], batch?: string): Promise<unknown>;`);
      }
    }
    L.push('}');
    L.push('');
  }
  writeFileSync(resolve(here, '../src/manifest/types.ts'), L.join('\n'));
}

emitTypes(CORE_DEFS);
console.log('generated src/manifest/types.ts');
