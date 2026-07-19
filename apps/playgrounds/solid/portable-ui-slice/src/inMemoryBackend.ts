/**
 * In-memory, AD4M-free backend — now a thin adapter over the shared QueryIR engine.
 *
 * The renderer passes the (legacy AD4M-flavored) query opts unchanged; this translates them to
 * QueryIR (the shim) and executes via executeQueryIR. So the harness proves the full chain live —
 * template `$query` → shim → QueryIR → engine → render — over a non-AD4M backend, with ZERO changes
 * to the shared renderer. No `@coasys/ad4m` anywhere in this app's dependency graph.
 */
import {
  type AdapterCapabilities,
  compileQuery,
  executeQueryIR,
  type InMemoryDataset,
  irToFlatQuery,
  planQuery,
  type QueryAdapter,
  type QueryIR,
  type Row,
} from '@we/schema-shared';

export type { Row } from '@we/schema-shared';

export interface RelationDef {
  type: 'hasOne' | 'hasMany';
  target: string;
  foreignKey: string;
}

export interface BackendConfig {
  id: string;
  tables: Record<string, Row[]>;
  relations?: Record<string, Record<string, RelationDef>>;
}

type QueryOpts = Record<string, unknown>;

function toEngineRelations(relations: BackendConfig['relations']): InMemoryDataset['relations'] {
  if (!relations) return undefined;
  const out: NonNullable<InMemoryDataset['relations']> = {};
  for (const [entity, rels] of Object.entries(relations)) {
    out[entity] = {};
    for (const [name, def] of Object.entries(rels)) {
      out[entity][name] = {
        target: def.target,
        cardinality: def.type === 'hasOne' ? 'one' : 'many',
        foreignKey: def.foreignKey,
      };
    }
  }
  return out;
}

// The in-memory backend consumes the flat `$query` dialect (run() re-compiles it via executeQueryIR),
// so its adapter lowers with the neutral `irToFlatQuery`. Capabilities mirror what that flat lowering
// expresses — relation filters / non-count aggregates / scope stay gaps (irToFlatQuery throws on them),
// which the renderer then falls back on. This is a real, AD4M-free QueryAdapter — it exercises the
// same renderer path the AD4M adapter does.
const inMemoryCapabilities: AdapterCapabilities = {
  operators: ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'nin', 'contains', 'exists'],
  booleanCombinators: true,
  relationFilters: false,
  scope: false,
  include: { supported: true },
  aggregate: ['count'],
  sort: { multiKey: true, byRelationPath: true, byAggregate: true },
  pagination: ['offset'],
  live: 'push',
};

const inMemoryQueryAdapter: QueryAdapter = {
  capabilities: inMemoryCapabilities,
  plan: (ir: QueryIR) => planQuery(ir, inMemoryCapabilities),
  lower: (ir: QueryIR) => {
    const { entity: _entity, ...opts } = irToFlatQuery(ir);
    void _entity;
    return opts;
  },
};

export function createInMemoryBackend(config: BackendConfig) {
  const subscribers = new Set<() => void>();
  const notify = () => subscribers.forEach((fn) => fn());
  // Shares config.tables by reference, so mutate() updates flow straight into the engine.
  const dataset: InMemoryDataset = { tables: config.tables, relations: toEngineRelations(config.relations) };

  function run(entity: string, opts: QueryOpts): Row[] {
    const { ir } = compileQuery({ entity, ...opts });
    return executeQueryIR(ir, dataset) as Row[];
  }

  function getModel(name: string) {
    return {
      query(_dataset: unknown, opts: QueryOpts) {
        let push: ((rows: Row[]) => void) | null = null;
        const notifier = () => push?.(run(name, opts));
        return {
          subscribe(cb: (rows: Row[]) => void) {
            push = cb;
            subscribers.add(notifier);
            queueMicrotask(() => cb(run(name, opts)));
            return Promise.resolve(run(name, opts));
          },
          dispose() {
            subscribers.delete(notifier);
          },
        };
      },
      findAll(_dataset: unknown, opts: QueryOpts) {
        return Promise.resolve(run(name, opts));
      },
    };
  }

  const stores = {
    $currentDataset: () => ({ id: config.id }),
    $getModel: (name: string) => getModel(name),
    $queryAdapter: inMemoryQueryAdapter,
  };

  return {
    stores,
    mutate(fn: (tables: Record<string, Row[]>) => void) {
      fn(config.tables);
      notify();
    },
  };
}
