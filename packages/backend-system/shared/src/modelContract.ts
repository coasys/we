/**
 * The neutral model contract — what "a model" means, independent of any backend.
 *
 * The query IR in this package has always been neutral at runtime (`queryEngine.ts` is the proof:
 * the inmemory backend runs the whole application on it). This file is its **type-level
 * companion**: the instance base every record satisfies, the static surface every entity class
 * presents, and the typed-query generics that make `findAll(p, { include: { $likeCount: … } })`
 * return rows whose `$likeCount` is a `number` — for every backend, keyed off the neutral
 * interfaces `@we/models` generates from its manifest rather than off any one backend's
 * decorator metadata.
 *
 * The generics deliberately mirror the AD4M ORM's typed-query machinery, which is fully
 * structural — the shapes were proven there, and keeping them recognisable is what makes the AD4M
 * classes satisfy this contract without adaptation. Where this contract is *looser* (dataset
 * handles are `unknown`, write values tolerate backend-specific representations), that is the
 * neutrality: those are exactly the points where backends legitimately differ.
 */

// ── Instance base ──────────────────────────────────────────────────────────────────────────────

/**
 * What a consumer may rely on about any record, whatever holds it. Mutation is assign-then-`save()`
 * on instances; bulk update is the static `update` below. `createdAt`/`updatedAt` are `unknown`
 * because their representation (epoch, ISO, something else) is a backend's choice — committing to
 * one here would turn every consumer's comparison code into a silent porting hazard.
 */
export interface ModelInstance {
  readonly id: string;
  author: string;
  createdAt: unknown;
  updatedAt: unknown;
  /**
   * `batch` is an opaque write-group token from {@link runModelTransaction}-style runners: writes
   * carrying the same token commit together where the backend supports atomicity, and a backend
   * without it ignores the token. Opaque here because its shape is the backend's own.
   */
  save(batch?: string): Promise<unknown>;
  delete(batch?: string): Promise<unknown>;
}

// ── Field classification (structural, over the neutral interfaces) ─────────────────────────────

/** T's data fields: everything that is not the base contract and not a method. */
export type ModelDataKeys<T extends ModelInstance> = {
  [K in keyof T]: K extends keyof ModelInstance ? never : T[K] extends (...args: never[]) => unknown ? never : K;
}[keyof T];

/** Keys usable in `where`/`order` — scalars and scalar arrays, not model references. */
export type PropertyKeysOf<T extends ModelInstance> = {
  [K in keyof T]: K extends ModelDataKeys<T>
    ? NonNullable<T[K]> extends ModelInstance
      ? never
      : NonNullable<T[K]> extends ModelInstance[]
        ? never
        : K
    : never;
}[keyof T];

/**
 * Keys usable in `include` — typed model references and `string[]` URI bags (the untyped-relation
 * pattern, where the stored field is link targets and hydration is a runtime affair).
 */
export type RelationKeysOf<T extends ModelInstance> = {
  [K in keyof T]: K extends ModelDataKeys<T>
    ? NonNullable<T[K]> extends ModelInstance
      ? K
      : NonNullable<T[K]> extends ModelInstance[]
        ? K
        : NonNullable<T[K]> extends string[]
          ? K
          : never
    : never;
}[keyof T];

/** The model a relation field points at; `ModelInstance` (loose) for URI bags. */
export type RelatedModel<T extends ModelInstance, K extends RelationKeysOf<T>> =
  NonNullable<T[K]> extends (infer U)[]
    ? U extends ModelInstance
      ? U
      : ModelInstance
    : NonNullable<T[K]> extends ModelInstance
      ? NonNullable<T[K]>
      : ModelInstance;

// ── Where / order ──────────────────────────────────────────────────────────────────────────────

export interface StringWhereOps {
  not?: string | string[];
  contains?: string;
  exists?: boolean;
}

export interface NumericWhereOps {
  not?: number | number[];
  exists?: boolean;
  lt?: number;
  lte?: number;
  gt?: number;
  gte?: number;
  between?: [number, number];
}

/** The untyped fallback condition — what a dynamic (schema-driven) query passes. */
export type LooseWhereCondition = string | number | boolean | string[] | number[] | Record<string, unknown>;

export type WhereConditionFor<V> = V extends string
  ? string | string[] | StringWhereOps
  : V extends number
    ? number | number[] | NumericWhereOps
    : V extends boolean
      ? boolean | { exists?: boolean }
      : V extends Array<infer U>
        ? U extends string
          ? string | string[] | StringWhereOps
          : U extends number
            ? number | number[] | NumericWhereOps
            : LooseWhereCondition
        : LooseWhereCondition;

/** Link metadata every backend can filter on, whatever else it stores. */
interface MetaWhere {
  id?: string | string[] | StringWhereOps;
  author?: string | string[] | StringWhereOps;
  timestamp?: LooseWhereCondition;
  createdAt?: LooseWhereCondition;
  updatedAt?: LooseWhereCondition;
}

export type TypedWhere<T extends ModelInstance> = { [K in PropertyKeysOf<T>]?: WhereConditionFor<T[K]> } & MetaWhere & {
    OR?: TypedWhere<T>[];
    AND?: TypedWhere<T>[];
    NOT?: TypedWhere<T>;
  };

export type TypedOrder<T extends ModelInstance> = {
  [K in PropertyKeysOf<T> | 'timestamp' | 'author' | 'createdAt' | 'updatedAt']?: 'ASC' | 'DESC' | 'asc' | 'desc';
} & {
  // $-prefixed projection keys — declared at the include level, sortable here.
  [K in `$${string}`]?: 'ASC' | 'DESC' | 'asc' | 'desc';
} & {
  // dotted relation.property paths — validated at runtime, not expressible as a mapped key.
  [key: `${string}.${string}`]: 'ASC' | 'DESC' | 'asc' | 'desc' | undefined;
};

// ── Include and projections ────────────────────────────────────────────────────────────────────

export interface RelationSubQueryFor<U extends ModelInstance> {
  where?: TypedWhere<U>;
  order?: TypedOrder<U>;
  include?: TypedIncludeMap<U>;
  limit?: number;
  offset?: number;
}

/**
 * A `$`-projection — discriminated so the `count: true` and `limit: 1` literals narrow result
 * inference in {@link IncludeExtras} (count → number, limit-1 → scalar-or-null).
 */
export type TypedIncludeProjection<T extends ModelInstance> = {
  [K in RelationKeysOf<T>]:
    | { from: K; count: true; where?: TypedWhere<RelatedModel<T, K>> }
    | { from: K; limit: 1; where?: TypedWhere<RelatedModel<T, K>>; order?: TypedOrder<RelatedModel<T, K>> }
    | { from: K; limit?: number; where?: TypedWhere<RelatedModel<T, K>>; order?: TypedOrder<RelatedModel<T, K>> };
}[RelationKeysOf<T>];

export type TypedIncludeMap<T extends ModelInstance> = {
  [K in RelationKeysOf<T>]?: boolean | RelationSubQueryFor<RelatedModel<T, K>>;
} & { [K in `$${string}`]?: TypedIncludeProjection<T> };

/**
 * The extra fields an `include` literal's `$`-keys contribute to each returned row. `unknown`
 * (intersection-neutral) when there are none, so `T & IncludeExtras<T, I>` collapses back to `T`.
 */
export type IncludeExtras<T extends ModelInstance, I> =
  I extends Record<string, unknown>
    ? Extract<keyof I, `$${string}`> extends never
      ? unknown
      : {
          [K in Extract<keyof I, `$${string}`>]: I[K] extends { count: true }
            ? number
            : I[K] extends { from: infer R; limit: 1 }
              ? R extends RelationKeysOf<T>
                ? RelatedModel<T, R> | null
                : never
              : I[K] extends { from: infer R }
                ? R extends RelationKeysOf<T>
                  ? RelatedModel<T, R>[]
                  : never
                : unknown;
        }
    : unknown;

// ── Query and statics ──────────────────────────────────────────────────────────────────────────

export interface TypedModelQuery<T extends ModelInstance> {
  where?: TypedWhere<T>;
  order?: TypedOrder<T>;
  include?: TypedIncludeMap<T>;
  includeAll?: boolean;
  properties?: PropertyKeysOf<T>[];
  limit?: number;
  offset?: number;
  count?: boolean;
  /** Backend-specific parent/scope handle — resolved by the adapter, opaque here. */
  parent?: Record<string, unknown>;
  deepQuery?: boolean;
}

export type IncludeOf<Q> = Q extends { include?: infer I } ? I : undefined;

/**
 * Values a write accepts for one field. Looser than the read type on purpose: relations are
 * written as ids/URIs however the instance types them, and backends may accept their own
 * representations — the field *names* stay checked, which is where typos live.
 */
export type WriteValue<V> =
  NonNullable<V> extends ModelInstance
    ? string | NonNullable<V>
    : NonNullable<V> extends ModelInstance[]
      ? string[] | NonNullable<V>
      : NonNullable<V> extends string
        ? // Storage fields read back as strings but accept richer content on write — a file
          // payload the backend stores through its blob strategy. Representation is its business.
          // `object` rather than an index signature: interfaces such as FileData carry no implicit
          // index signature and would be refused by one.
          V | object
        : V;

export type WriteProperties<T extends ModelInstance> = { [K in ModelDataKeys<T>]?: WriteValue<T[K]> } & {
  /** Backends may accept explicit stamps — a session "touched" time written by the app. */
  createdAt?: unknown;
  updatedAt?: unknown;
};

/**
 * The static surface every entity presents — what the entity proxies in `@we/models` are typed
 * as, and what a backend's registered implementations must answer to. Dataset handles are
 * `unknown`: which kind of handle "a dataset" is, is the backend's business (an AD4M
 * `PerspectiveProxy`, an inmemory store, a connection).
 */
export interface ModelStatic<T extends ModelInstance> {
  create(dataset: unknown, properties: WriteProperties<T>, options?: Record<string, unknown>): Promise<T>;
  findAll<Q extends TypedModelQuery<T>>(dataset: unknown, query?: Q): Promise<(T & IncludeExtras<T, IncludeOf<Q>>)[]>;
  findOne<Q extends TypedModelQuery<T>>(
    dataset: unknown,
    query?: Q,
  ): Promise<(T & IncludeExtras<T, IncludeOf<Q>>) | null>;
  /** Null for an id nothing holds — an update is a statement about a record that must exist. */
  update(dataset: unknown, id: string, properties: WriteProperties<T>): Promise<T | null>;
  delete(dataset: unknown, id: string): Promise<unknown>;
  count(dataset: unknown, query?: TypedModelQuery<T>): Promise<number>;
}
