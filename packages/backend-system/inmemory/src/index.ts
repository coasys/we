/**
 * In-memory, AD4M-free backend — now a thin adapter over the shared QueryIR engine.
 *
 * The renderer passes the (legacy AD4M-flavored) query opts unchanged; this translates them to
 * QueryIR (the shim) and executes via executeQueryIR. So the harness proves the full chain live —
 * template `$query` → shim → QueryIR → engine → render — over a non-AD4M backend, with ZERO changes
 * to the shared renderer. No `@coasys/ad4m` anywhere in this app's dependency graph.
 */
import { compileQuery, executeQueryIR, type InMemoryDataset, type Row } from '@we/backend-shared';

import { inMemoryQueryAdapter } from './queryAdapter';

export type { Row } from '@we/backend-shared';

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

export function createInMemoryBackend(config: BackendConfig) {
  const subscribers = new Set<() => void>();
  const notify = () => subscribers.forEach((fn) => fn());
  // Shares config.tables by reference, so mutate() updates flow straight into the engine.
  const dataset: InMemoryDataset = { tables: config.tables, relations: toEngineRelations(config.relations) };

  function run(entity: string, opts: QueryOpts): Row[] {
    const { ir } = compileQuery({ entity, ...opts });
    return executeQueryIR(ir, dataset) as Row[];
  }

  function getEntity(name: string) {
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
    $getEntity: (name: string) => getEntity(name),
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

export { compileEntities, type EntityClassLike, type EntityRuntime } from './entities';
export {
  createInMemoryAgentSession,
  createInMemoryBackendPorts,
  createInMemoryLifecycle,
  createInMemoryProfileDirectory,
  createInMemorySchemaPort,
  type InMemoryAgentOptions,
  type InMemoryBackendPortsOptions,
  type InMemoryDatasetSeed,
  type InMemoryLifecycle,
  type SeededPeer,
} from './lifecycle';
export { inMemoryCapabilities, inMemoryQueryAdapter } from './queryAdapter';
