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
// expresses — relation filters and non-count aggregates stay gaps (irToFlatQuery throws on them),
// which the renderer then falls back on. This is a real, AD4M-free QueryAdapter — it exercises the
// same renderer path the AD4M adapter does.
//
// `scope` is the exception, and is handled rather than declined: the shared engine has always been
// able to execute a drill-down (`scopeRows`), and only the *lowering* could not express one, because
// `irToFlatQuery` refuses a `scope` it cannot resolve to a backend predicate. This dialect needs no
// resolution — the re-compile on the other side carries `scope` straight back into the IR — so it is
// carried across the flat form instead of being lost. Declaring it unsupported cost the showcase
// templates every drill-down they have: a channel's messages, a board column's cards.
export const inMemoryCapabilities: AdapterCapabilities = {
  // `startsWith`/`endsWith` are declared because `matchesFilter` in the shared engine has always
  // executed them — this adapter *is* that engine, so anything it can evaluate is native here by
  // definition. They were missing only because nothing could reach them from a flat where clause
  // until the compiler learned to translate them.
  operators: ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'nin', 'contains', 'startsWith', 'endsWith', 'exists'],
  booleanCombinators: true,
  // Declared for the same reason `startsWith`/`endsWith` are: `matchesFilter` in the shared engine
  // has always evaluated `{ rel, some/none }`, and this adapter *is* that engine. It read `false`
  // only because nothing could reach the operator from a flat where clause until the compiler
  // learned to translate it — so the profile was describing the dialect's gap, not this backend's.
  relationFilters: true,
  scope: true,
  // All four, because in memory they are a filter and a loop — and the reference implementation
  // earns its keep precisely by answering what the real backend answers, so a store's tests are
  // about the store rather than about which backend is underneath.
  boundedTraversal: { multiAnchor: true, transitive: true, inbound: true, perAnchorLimit: true },
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
    // Lowered around `irToFlatQuery` rather than through it: it throws on `scope` by design, since
    // resolving `via` to a predicate is adapter work it cannot do. Here there is nothing to resolve.
    const { scope, ...rest } = ir;
    const { entity: _entity, ...opts } = irToFlatQuery(rest as QueryIR);
    void _entity;
    return scope ? { ...opts, scope } : opts;
  },
};
