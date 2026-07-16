/**
 * The data seam — WE's renderer ↔ backend contract, made explicit.
 *
 * The renderer never imports AD4M. It reaches the data layer entirely through the small set of
 * functions the host injects into the `stores` bag, and through the duck-typed model handles those
 * return. Historically that contract lived only as `as`-casts inside `SchemaRenderer`; these types
 * declare it so a non-AD4M host (in-memory, NextGraph, GraphQL, …) knows exactly what to implement.
 *
 * `QueryOptions` is deliberately the *current* contract — an AD4M-flavored query-option pass-through,
 * forwarded verbatim. It is expected to be superseded by a specified, backend-neutral query IR; the
 * shape of the seam — dataset handle + model handle with `query`/`findAll` — stays either way.
 */

/**
 * An opaque handle to the bounded dataset a query runs against — the backend-neutral replacement
 * for AD4M's `PerspectiveProxy`.
 *
 * Two ids on purpose (a lesson from AD4M, whose per-agent perspective `uuid`s forced shared data to
 * be addressed by `neighbourhood://` URI):
 * - `id`  — stable LOCAL identity for this client session; what the renderer keys on (dataset-scoped
 *           model registry, subscription cache, reconciliation). Always present.
 * - `uri` — stable GLOBAL identity, present only when the dataset is shared/addressable; for
 *           references that leave the client (sharing, links, persistence).
 */
export interface DatasetHandle {
  id: string;
  uri?: string;
}

/**
 * Query options passed through to a model handle. Currently the AD4M-flavored shape (opaque
 * `where`/`order`/`include`), forwarded verbatim. Superseded by `QueryIR` in a later phase.
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
 * A queryable model handle — what `$getModel(name)` returns. The two methods are the entire read
 * contract the renderer depends on.
 */
export interface ModelClass<T = unknown> {
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
 * The formal backend contract an adapter implements (AD4M today; NextGraph/GraphQL/in-memory next).
 * A host wires these into the `stores` bag via {@link RendererDataBindings}.
 */
export interface DataSource {
  currentDataset(): DatasetHandle | null;
  getModel(name: string): ModelClass;
  getModelForDataset?(name: string, datasetId?: string): ModelClass | undefined;
  mutations?: MutationApi;
}

/**
 * The exact keys the renderer reads off the injected `stores` bag — the empirical data contract as
 * surfaced by the in-memory reference host. A host provides these (plus any `$store` namespaces its templates
 * reference). All optional so a presentation-only (L0) host can omit the data ones entirely.
 */
export interface RendererDataBindings {
  /** Current dataset handle. Preferred over the legacy `adamStore.currentPerspective`. */
  $currentDataset?: () => DatasetHandle | null;
  /** Resolve a model name to its queryable handle. */
  $getModel?: (name: string) => ModelClass;
  /** Dataset-scoped model resolution (for backends with per-dataset dynamic model classes). */
  $getModelForPerspective?: (name: string, datasetId?: string) => ModelClass | undefined;
  /** Surface a data-layer error to the host UI. */
  $onError?: (message: string) => void;
  /** Mutation surface for `model.create` / `update` / `delete` actions. */
  model?: MutationApi;
}
