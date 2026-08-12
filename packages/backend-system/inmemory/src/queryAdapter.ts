/**
 * The in-memory QueryAdapter, shared by `createInMemoryBackend` (the standalone
 * playground/test backend) and `createInMemoryBackendPorts` (the full ports
 * bundle) — one definition so the two cannot drift.
 */
import {
  type AdapterCapabilities,
  irToFlatQuery,
  planQuery,
  type QueryAdapter,
  type QueryIR,
} from '@we/backend-shared';

// The in-memory backend consumes the flat `$query` dialect (run() re-compiles it via executeQueryIR),
// so its adapter lowers with the neutral `irToFlatQuery`. Capabilities mirror what that flat lowering
// expresses — relation filters / non-count aggregates / scope stay gaps (irToFlatQuery throws on them),
// which the renderer then falls back on. This is a real, AD4M-free QueryAdapter — it exercises the
// same renderer path the AD4M adapter does.
export const inMemoryCapabilities: AdapterCapabilities = {
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

export const inMemoryQueryAdapter: QueryAdapter = {
  capabilities: inMemoryCapabilities,
  plan: (ir: QueryIR) => planQuery(ir, inMemoryCapabilities),
  lower: (ir: QueryIR) => {
    const { entity: _entity, ...opts } = irToFlatQuery(ir);
    void _entity;
    return opts;
  },
};
