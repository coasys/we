import type { ModelEntry, ModelFieldEntry, ModelRelationEntry } from '../types.js';

/**
 * Build the model documentation from the manifest itself.
 *
 * This used to parse the AD4M-decorated class sources with ts-morph — reasonable when the classes
 * were the source of truth, and backwards once they became artifacts of `@we/models`' manifest.
 * Deriving the docs from `CORE_DEFS` closes the arrow: what CLAUDE.md says a model is, is what the
 * manifest declares, definitionally — and a backend that never generates classes at all still
 * documents identically.
 *
 * Async because the manifest is imported at run time rather than parsed off disk; the `modelsDir`
 * parameter is kept for signature stability and ignored.
 */
export async function extractModels(_modelsDir?: string): Promise<ModelEntry[]> {
  const { CORE_DEFS, WE_NODE_ENTITY } = (await import('@we/models/manifest')) as unknown as {
    CORE_DEFS: Record<string, CoreDefLike>;
    WE_NODE_ENTITY: EntityLike;
  };

  const entries: ModelEntry[] = Object.entries(CORE_DEFS).map(([name, def]) => ({
    name,
    className: name,
    extends: def.base,
    fields: fieldEntries(def),
    relations: relationEntries(def.entity.relations ?? {}),
  }));

  // WeNode itself: the base whose shared relations every WeNode-based entity inherits. Documented
  // once, as before, rather than repeated onto every subclass.
  entries.push({
    name: 'WeNode',
    className: 'WeNode',
    extends: 'Ad4mModel',
    fields: [],
    relations: relationEntries(WE_NODE_ENTITY.relations ?? {}),
  });

  return entries;
}

interface PropertyLike {
  type: string;
  predicate: string;
  required?: boolean;
  default?: unknown;
}
interface RelationLike {
  target?: string;
  cardinality: 'one' | 'many';
  predicate: string;
}
interface EntityLike {
  properties?: Record<string, PropertyLike>;
  relations?: Record<string, RelationLike>;
}
interface CoreDefLike {
  base: string;
  unions?: Record<string, { alias: string }>;
  entity: EntityLike;
}

function fieldEntries(def: CoreDefLike): ModelFieldEntry[] {
  return Object.entries(def.entity.properties ?? {}).map(([name, spec]) => ({
    name,
    // The union alias where one is declared — `mode: SignalMode` reads better than `mode: string`
    // and is what the generated class declares too.
    type: def.unions?.[name]?.alias ?? spec.type,
    predicate: spec.predicate,
    required: spec.required ?? false,
    default: formatDefault(spec.default),
  }));
}

/** Empty strings and zeroes are omitted — a field defaulting to nothing is the unremarkable case. */
function formatDefault(value: unknown): string | undefined {
  if (value === undefined || value === '' || value === 0) return undefined;
  if (value === null) return 'null';
  return typeof value === 'string' ? `'${value}'` : String(value);
}

function relationEntries(relations: Record<string, RelationLike>): ModelRelationEntry[] {
  return Object.entries(relations).map(([name, spec]) => ({
    name,
    kind: spec.cardinality === 'one' ? ('HasOne' as const) : ('HasMany' as const),
    predicate: spec.predicate,
    ...(spec.target ? { target: spec.target } : {}),
  }));
}
