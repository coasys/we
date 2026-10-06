/**
 * The data seam — WE's renderer ↔ backend contract, made explicit.
 *
 * The renderer never imports a backend. It reaches the data layer entirely through the small set of
 * functions the host injects into the `stores` bag, and through the duck-typed model handles those
 * return. Historically that contract lived only as `as`-casts inside `SchemaRenderer`; these types
 * declare it, so what the renderer depends on is a readable list rather than something recovered
 * by grepping for casts.
 *
 * `QueryOptions` is the flat query dialect a model handle consumes, forwarded verbatim. Every
 * `$query` is lifted to the IR (`queryIR.ts`), planned, and lowered back to this shape by the
 * adapter; the shape of the seam — dataset handle + model handle with `query`/`findAll` — is what
 * the renderer depends on.
 */
import type { EphemeralPort } from './ephemeral';
import type { AdapterCapabilities, QueryPlan } from './queryCapabilities';
import type { QueryIR } from './queryIR';

/**
 * A handle to the bounded dataset a query runs against — whatever the backend's own object for one
 * is.
 *
 * **Genuinely opaque: the renderer never looks inside one.** It obtains a handle from
 * `$currentDataset` (or a `dataset:` path), checks it is present, and hands it back to the host via
 * `EntityClass.query` / `findAll` and `$getEntityForDataset`. Only the host that minted a handle
 * ever interprets it.
 *
 * Typed `unknown` rather than a structural `{ id, uri }` on purpose. A structural shape would force
 * a backend to *destroy* its native handle and then reconstruct it on the way back — flatten a
 * live proxy to an id and re-resolve it through a lookup on every query — all to satisfy fields
 * nothing reads. The contract should state what the renderer actually requires, and
 * of a dataset it requires only that it round-trips.
 *
 * Anything a host needs *from* a handle (dataset-scoped model registries, subscription caches) it
 * derives itself, in the host, where the concrete type is known.
 */
export type DatasetHandle = unknown;

/**
 * Query options passed through to a model handle — the flat dialect (opaque `where`/`order`/
 * `include`), as the adapter's `lower` produces it from the IR.
 */
export interface QueryOptions {
  where?: Record<string, unknown>;
  order?: Record<string, 'asc' | 'desc'>;
  limit?: number;
  offset?: number;
  include?: Record<string, unknown>;
  [k: string]: unknown;
}

/** A live query subscription. `subscribe` resolves with the initial page and re-invokes `cb` on change. */
export interface QuerySubscription<T = unknown> {
  subscribe(cb: (rows: T[]) => void): Promise<T[]>;
  dispose(): void;
}

/**
 * A queryable model handle — what `$getEntity(name)` returns. The two methods are the entire read
 * contract the renderer depends on.
 */
export interface EntityClass<T = unknown> {
  query(dataset: DatasetHandle, opts: QueryOptions): QuerySubscription<T>;
  findAll(dataset: DatasetHandle, opts: QueryOptions, ctl?: { signal?: AbortSignal }): Promise<T[]>;
}

/** Mutation surface (L2) — what `stores.model` exposes for create/update/delete. */
export interface MutationApi {
  create(model: string, data?: Record<string, unknown>, opts?: Record<string, unknown>): Promise<{ id: string }>;
  update(model: string, id: string, data: Record<string, unknown>, opts?: Record<string, unknown>): Promise<unknown>;
  delete(model: string, id: string, opts?: Record<string, unknown>): Promise<void>;
}

/**
 * The formal backend contract an adapter implements. A host wires these into the `stores` bag via
 * {@link RendererDataBindings}.
 */
export interface DataSource {
  currentDataset(): DatasetHandle | null;
  getEntity(name: string): EntityClass;
  getEntityForDataset?(name: string, datasetId?: string): EntityClass | undefined;
  mutations?: MutationApi;
}

/**
 * The query-execution port an adapter implements to run a `QueryIR` on its backend.
 *
 * `compileQuery` (DSL→IR), `irToFlatQuery` (IR→flat options), and `executeQueryIR` (the reference
 * engine) are shared building blocks in this package. A `QueryAdapter` *composes* them with its
 * backend's capability profile and quirks, so the renderer routes every query through the port and
 * never hardcodes a backend.
 */
export interface QueryAdapter {
  /** What this backend does natively — drives {@link QueryAdapter.plan}. */
  capabilities: AdapterCapabilities;
  /**
   * Classify an IR for this backend: which features push down natively vs need the compute-up
   * fallback. Beyond `planQuery(ir, capabilities)`, an adapter folds in its own conditional
   * degradations — a sort that only pushes down beside a `limit`, say — that no capability
   * boolean can express.
   */
  plan(ir: QueryIR): QueryPlan;
  /** Lower a fully-native IR to the flat query options this backend's {@link EntityClass} consumes. */
  lower(ir: QueryIR): QueryOptions;
}

/**
 * The exact keys the renderer reads off the injected `stores` bag — the empirical data contract as
 * surfaced by the in-memory reference host. A host provides these (plus any store namespaces its templates
 * reference). All optional so a presentation-only (L0) host can omit the data ones entirely.
 */
export interface RendererDataBindings {
  /** The dataset queries run against unless a `dataset:` path overrides it. Opaque to the renderer. */
  $currentDataset?: () => DatasetHandle | null;
  /** Resolve a model name to its queryable handle. */
  $getEntity?: (name: string) => EntityClass;
  /**
   * Dataset-scoped model resolution, for backends whose model classes are per-dataset (synthesised
   * from a schema the dataset itself carries). Receives the dataset **handle**, not an id
   * extracted from it — deriving a key is the host's job, since only the host knows the concrete
   * type. This is what lets the renderer treat a handle as fully opaque.
   */
  $getEntityForDataset?: (name: string, dataset?: DatasetHandle) => EntityClass | undefined;
  /** Surface a data-layer error to the host UI. */
  $onError?: (message: string) => void;
  /** Mutation surface for `record.create` / `update` / `delete` actions. */
  model?: MutationApi;
  /**
   * Query-execution adapter — routes a neutral `QueryIR` to this backend (plan + lower).
   *
   * **Any host that runs queries must supply this.** Every `$query` is compiled to the IR and lowered
   * through it, and there is no path around it: a host without one has queries that refuse, not
   * queries that take a different route. There used to be such a route — the raw dialect, handed
   * straight to the backend behind `seed.features.useQueryIR` — and it worked only because the
   * dialect and the backend's native query happened to coincide, so it hid capability gaps rather
   * than reporting them.
   *
   * Optional here only because a presentation-only (L0) host supplies none of these bindings and has
   * no queries for it to be required by. Omitting it while issuing queries is reported at the first
   * one, naming this binding.
   */
  $queryAdapter?: QueryAdapter;
  /**
   * Identity directory backing the `$agent` block: look up a profile by id, and ask the host to
   * fetch one it hasn't cached. Every backend has some version of this (agents addressed by DID,
   * another host's users), so the renderer names the capability and the host binds whatever it has.
   *
   * `get` must read reactively — the `$agent` effect re-runs on its dependencies, so a profile that
   * arrives after `fetch` shows up without further prompting.
   */
  $identities?: {
    get: (id: string) => Record<string, unknown> | undefined;
    fetch: (id: string) => void;
  };
  /**
   * Ephemeral agent-to-agent transport — see `ephemeral.ts`. Absent on a host with no such
   * capability; consumers must degrade rather than throw.
   *
   * **Why this is in the contract at all**, given the host's own stores could just construct one:
   * because *distributable* code needs it. A feature module from the marketplace — the WebRTC call
   * module, a live-cursor overlay — cannot import a host's backend adapter, and cannot know the name
   * of a host store to call. Naming the capability here is what lets third-party code use it on any
   * host. (Contrast template/theme persistence, deliberately *not* a port: only the host itself ever
   * needs it, so it can stay a host store.)
   */
  $ephemeral?: EphemeralPort;
  /**
   * Named functions a schema may compute values from — the host-function registry an expression calls into.
   *
   * The escape hatch in the form the rest of WE already uses: the authoring surface is JSON, so
   * anything genuinely computational is reachable *from* JSON by name, exactly as the graph does
   * for expanders, layouts and seed sources. It exists because a month of days cannot be written as
   * data — the operator set has no arithmetic, no date maths and no way to generate a sequence — so
   * without this, every sequence-shaped view (a calendar grid, a set of time slots, a recurring
   * series, a page range) has to be a bespoke component, and everything inside it stops being
   * template-owned.
   *
   * **Synchronous and pure**, and that constraint is what keeps a host source from becoming a second
   * data layer. Anything that fetches is a `$query`; anything that holds state is a store. Because
   * a source is a pure function of its options, resolving one is a memo rather than a subscription
   * — which is why a host source works in props, conditions *and* children, where `$query` cannot.
   *
   * Rows are the motivating case and not the only one: a month grid needs its days *and* a label for
   * the month and a way to step to the next. A second token for computed scalars would be a worse
   * answer than letting this one return whatever it computes.
   *
   * Registered by the host alongside components, so a deployment decides what its templates can
   * reach and a module can contribute its own.
   */
  $sources?: Record<string, (options: Record<string, unknown>) => unknown>;
}

/**
 * The `stores` bag as the renderer sees it: the declared data bindings above, plus whatever
 * namespaces a host's templates reach by dot-path (`someStore.field`). The index
 * signature is what keeps it open — the contract is a floor, not a closed set.
 *
 * Declared as an extending interface rather than `RendererDataBindings & Record<string, unknown>`:
 * intersecting with an index signature widens the declared members, losing exactly the typing this
 * exists to provide.
 */
export interface RendererStores extends RendererDataBindings {
  [key: string]: unknown;
}
