/**
 * The neutral model contract — what "a model" means, independent of any backend.
 *
 * The query IR in this package has always been neutral at runtime (`queryEngine.ts` is the proof:
 * the inmemory backend runs the whole application on it). This file is its **type-level
 * companion**: the instance base every record satisfies, the static surface every entity class
 * presents, and the typed-query generics that make `findAll(p, { include: { $likeCount: … } })`
 * return rows whose `$likeCount` is a `number` — for every backend, keyed off the neutral
 * interfaces `@we/entities` generates from its manifest rather than off any one backend's
 * decorator metadata.
 *
 * The generics are fully structural, so a backend's own model classes satisfy this contract
 * without adaptation wherever their statics have the same shape. Where the contract is *looser*
 * than any one implementation (dataset handles are `unknown`, write values tolerate
 * backend-specific representations), those are exactly the points where backends legitimately
 * differ.
 */

import type { QuerySubscription } from './dataSource';

// ── Instance base ──────────────────────────────────────────────────────────────────────────────

/**
 * What a consumer may rely on about any record, whatever holds it. Mutation is assign-then-`save()`
 * on instances; bulk update is the static `update` below. `createdAt`/`updatedAt` are `unknown`
 * because their representation (epoch, ISO, something else) is a backend's choice — committing to
 * one here would turn every consumer's comparison code into a silent porting hazard.
 */
export interface RecordInstance {
  readonly id: string;
  author: string;
  createdAt: unknown;
  updatedAt: unknown;
  /**
   * `batch` is an opaque write-group token from `runEntityTransaction` in `@we/entities`: writes
   * carrying the same token commit together where the backend supports atomicity, and a backend
   * without it ignores the token. Opaque here because its shape is the backend's own.
   *
   * A write in a group is staged, not made: no read sees it until the group commits, the group's
   * own reads included. A read inside a transaction answers with committed state, so a later
   * write that needs an earlier one's record names it by the id the earlier write returned (or the
   * id the caller chose for it) rather than finding it.
   */
  save(batch?: string): Promise<unknown>;
  delete(batch?: string): Promise<unknown>;
}

/**
 * The key a record read through a polymorphic relation carries its concrete entity name under.
 *
 * A heterogeneous relation hands back records of several kinds at once, and a consumer that has to
 * do anything with one — draw it, address it, pick a display for it — needs to know which kind it
 * got. The declared relation cannot say, because saying is the thing it gave up by being untyped.
 *
 * A contract rather than a convenience, and worth stating plainly because the value is not this
 * repo's to choose: the production backend writes this exact string, so what is written here is a
 * *record* of somebody else's wire format, and any backend answering a polymorphic read has to
 * match it. The
 * failure mode if one does not is quiet — records arrive with no type and every consumer falls back
 * to whatever it does for an unknown row, which looks the same as a relation that hydrated nothing.
 *
 * The **key** is the production backend's; the **value** is the contract's: an entity name, as a
 * template compares it with `'TaskBlock'`. A backend that names a class some other way — by a full
 * class IRI, say, so that two apps can each have a class of one name — maps the value back to the
 * entity name at its own edge, on every row path to the renderer.
 *
 * Named here rather than in an adapter so that the shared layers reading it — the graph
 * engine, anything picking a display per row — are not reaching into a `__`-prefixed literal they
 * would have to know an adapter's internals to justify.
 */
export const RECORD_TYPE_KEY = '__subjectClass';

/** The concrete entity name of a record read polymorphically, or undefined if it carries none. */
export function recordTypeOf(row: unknown): string | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const value = (row as Record<string, unknown>)[RECORD_TYPE_KEY];
  return typeof value === 'string' && value ? value : undefined;
}

// ── Field classification (structural, over the neutral interfaces) ─────────────────────────────

/** T's data fields: everything that is not the base contract and not a method. */
export type RecordDataKeys<T extends RecordInstance> = {
  [K in keyof T]: K extends keyof RecordInstance ? never : T[K] extends (...args: never[]) => unknown ? never : K;
}[keyof T];

/** Keys usable in `where`/`order` — scalars and scalar arrays, not model references. */
export type PropertyKeysOf<T extends RecordInstance> = {
  [K in keyof T]: K extends RecordDataKeys<T>
    ? NonNullable<T[K]> extends RecordInstance
      ? never
      : NonNullable<T[K]> extends RecordInstance[]
        ? never
        : K
    : never;
}[keyof T];

/**
 * Keys usable in `include` — typed model references and `string[]` URI bags (the untyped-relation
 * pattern, where the stored field is link targets and hydration is a runtime affair).
 */
export type RelationKeysOf<T extends RecordInstance> = {
  [K in keyof T]: K extends RecordDataKeys<T>
    ? NonNullable<T[K]> extends RecordInstance
      ? K
      : NonNullable<T[K]> extends RecordInstance[]
        ? K
        : NonNullable<T[K]> extends string[]
          ? K
          : never
    : never;
}[keyof T];

/** The model a relation field points at; `RecordInstance` (loose) for URI bags. */
export type RelatedEntity<T extends RecordInstance, K extends RelationKeysOf<T>> =
  NonNullable<T[K]> extends (infer U)[]
    ? U extends RecordInstance
      ? U
      : RecordInstance
    : NonNullable<T[K]> extends RecordInstance
      ? NonNullable<T[K]>
      : RecordInstance;

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

export type TypedWhere<T extends RecordInstance> = {
  [K in PropertyKeysOf<T>]?: WhereConditionFor<T[K]>;
} & MetaWhere & {
    OR?: TypedWhere<T>[];
    AND?: TypedWhere<T>[];
    NOT?: TypedWhere<T>;
  };

export type TypedOrder<T extends RecordInstance> = {
  [K in PropertyKeysOf<T> | 'timestamp' | 'author' | 'createdAt' | 'updatedAt']?: 'ASC' | 'DESC' | 'asc' | 'desc';
} & {
  // $-prefixed projection keys — declared at the include level, sortable here.
  [K in `$${string}`]?: 'ASC' | 'DESC' | 'asc' | 'desc';
} & {
  // dotted relation.property paths — validated at runtime, not expressible as a mapped key.
  [key: `${string}.${string}`]: 'ASC' | 'DESC' | 'asc' | 'desc' | undefined;
};

// ── Include and projections ────────────────────────────────────────────────────────────────────

export interface RelationSubQueryFor<U extends RecordInstance> {
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
export type TypedIncludeProjection<T extends RecordInstance> = {
  [K in RelationKeysOf<T>]:
    | { from: K; count: true; where?: TypedWhere<RelatedEntity<T, K>> }
    | { from: K; limit: 1; where?: TypedWhere<RelatedEntity<T, K>>; order?: TypedOrder<RelatedEntity<T, K>> }
    | { from: K; limit?: number; where?: TypedWhere<RelatedEntity<T, K>>; order?: TypedOrder<RelatedEntity<T, K>> };
}[RelationKeysOf<T>];

export type TypedIncludeMap<T extends RecordInstance> = {
  [K in RelationKeysOf<T>]?: boolean | RelationSubQueryFor<RelatedEntity<T, K>>;
} & { [K in `$${string}`]?: TypedIncludeProjection<T> };

/**
 * The extra fields an `include` literal's `$`-keys contribute to each returned row. `unknown`
 * (intersection-neutral) when there are none, so `T & IncludeExtras<T, I>` collapses back to `T`.
 */
export type IncludeExtras<T extends RecordInstance, I> =
  I extends Record<string, unknown>
    ? Extract<keyof I, `$${string}`> extends never
      ? unknown
      : {
          [K in Extract<keyof I, `$${string}`>]: I[K] extends { count: true }
            ? number
            : I[K] extends { from: infer R; limit: 1 }
              ? R extends RelationKeysOf<T>
                ? RelatedEntity<T, R> | null
                : never
              : I[K] extends { from: infer R }
                ? R extends RelationKeysOf<T>
                  ? RelatedEntity<T, R>[]
                  : never
                : unknown;
        }
    : unknown;

// ── Where a record is attached ────────────────────────────────────────────────────────────────────

/**
 * A record to attach under, and the relation of that record's it joins — by **name**, as the parent's
 * entity declares it: `{ id: post.id, relation: 'children' }`, `{ id: task.id, relation: 'responses' }`.
 *
 * Never by how the relation is stored. A predicate is one backend's address for a relation, and a
 * contract that took one made every caller spell that backend's storage, and every other backend map
 * it back to a relation by searching for it. `entity` names the parent's entity where the name alone
 * does not decide — two entities declaring a relation of the same name stored differently — and is
 * otherwise left out.
 */
export interface ParentRef {
  id: string;
  relation: string;
  entity?: string;
}

/** What a write may say besides its fields: where it goes, the batch it belongs to, and its id. */
export interface CreateOptions {
  parent?: ParentRef;
  /**
   * The write group this create belongs to — see {@link RecordInstance.save} for the token, and
   * `runEntityTransaction` in `@we/entities` for what a group promises.
   */
  batchId?: string;
  /**
   * The id the new record is to have, chosen by the caller rather than minted by the backend.
   *
   * For an id the caller derived deterministically — from an invocation and the step that writes,
   * say — so that running the same write twice names the same record, and a later step can address
   * a record an earlier one is about to create without reading it back. A URI is safe on every
   * backend; a backend may refuse a form it cannot store.
   *
   * A create onto an id some record already holds is refused with {@link RecordExistsError}, never
   * an overwrite: two writers deriving the same id is the case the check exists for, and the second
   * silently replacing the first is the failure it prevents. Where the backend judges that against
   * is its own to say, and where it is weaker than "every write that has landed, including earlier
   * ones in this batch" the backend's implementation says so.
   *
   * `id` is never a field in the create's properties: a record's id is not one of its values.
   */
  id?: string;
  [option: string]: unknown;
}

/**
 * A create was refused because a record already holds the id it asked for.
 *
 * A type of its own because what follows differs from any other refusal: the caller asked for this
 * exact record, and somebody — perhaps an earlier run of the same write — has made it already.
 */
export class RecordExistsError extends Error {
  constructor(readonly id: string) {
    super(`A record with the id "${id}" already exists; a create never overwrites one`);
    this.name = 'RecordExistsError';
  }
}

/** By name as well as by class, so a second copy of this package in a bundle still matches. */
export function isRecordExists(err: unknown): err is RecordExistsError {
  return err instanceof RecordExistsError || (err instanceof Error && err.name === 'RecordExistsError');
}

// ── Query and statics ──────────────────────────────────────────────────────────────────────────

export interface TypedEntityQuery<T extends RecordInstance> {
  where?: TypedWhere<T>;
  order?: TypedOrder<T>;
  include?: TypedIncludeMap<T>;
  includeAll?: boolean;
  /**
   * The fields each row carries. Record metadata may be named too: whether a backend returns it
   * unasked differs between backends, so a read that needs `author` or `createdAt` says so.
   */
  properties?: (PropertyKeysOf<T> | 'author' | 'createdAt' | 'updatedAt')[];
  limit?: number;
  offset?: number;
  count?: boolean;
  /** Only records held under this one, through this relation — see {@link ParentRef}. */
  parent?: ParentRef;
  deepQuery?: boolean;
}

export type IncludeOf<Q> = Q extends { include?: infer I } ? I : undefined;

/**
 * Values a write accepts for one field. Looser than the read type on purpose: relations are
 * written as ids/URIs however the instance types them, and backends may accept their own
 * representations — the field *names* stay checked, which is where typos live.
 *
 * ## `json` properties
 *
 * A property declared `type: 'json'` holds a structured value — a list, an object, a number or a
 * boolean — and reads back as that value, on every backend. Nobody parses or serialises it on the
 * way in or out: how it is stored is the backend's business. Its interface type is `unknown`,
 * because a value written by another agent is whatever they wrote, so a reader narrows it.
 *
 * - **Absent stays absent.** A write of `''`, `null` or nothing clears it, as for any scalar, and
 *   an unwritten one reads as absent: a `json` property has no declared default. An empty list or
 *   object is a value, not an absence — `[]` and unset can mean different things.
 * - **Text is JSON.** A string written to one is parsed, and refused when it does not parse. A value
 *   that is itself a string is refused too, since read back it could not be told from text that
 *   still needs parsing. See `writtenJsonValue`.
 * - **A stored value that does not parse reads as absent**, reported once per property and never
 *   thrown, so one bad value does not take its record out of every list. See `readJsonValue`.
 * - **The whole value is the unit.** A write replaces it, so two writers at once keep the later
 *   one. Something that needs concurrent edits to merge, or a part of it to be queried, is a record
 *   or a relation instead.
 */
export type WriteValue<V> =
  NonNullable<V> extends RecordInstance
    ? string | NonNullable<V>
    : NonNullable<V> extends RecordInstance[]
      ? string[] | NonNullable<V>
      : NonNullable<V> extends string
        ? // Storage fields read back as strings but accept richer content on write — a file
          // payload the backend stores through its blob strategy. Representation is its business.
          // `object` rather than an index signature: interfaces such as FileData carry no implicit
          // index signature and would be refused by one.
          V | object
        : V;

export type WriteProperties<T extends RecordInstance> = { [K in RecordDataKeys<T>]?: WriteValue<T[K]> } & {
  /** Backends may accept explicit stamps — a session "touched" time written by the app. */
  createdAt?: unknown;
  updatedAt?: unknown;
};

/**
 * A record as a **write** hands it back: its own fields, and none of its relations.
 *
 * A create answers with the thing it just wrote. The scalars are all there — a backend that stamps
 * `author` and `createdAt` from the write has them without being asked — but a relation is not a
 * field on the row, it is a separate read, and nothing asked for one. So a relation key on a create
 * return is whatever it held at the instant of the write, which for a record that did not exist a
 * moment ago is *empty by construction*, and it is never refreshed as the relation fills.
 *
 * Typed away rather than documented, because the failure is silent and reads as data loss. A
 * conversation's messages read back off the record the conversation was created from came back
 * empty, so returning to a chat showed nothing in it, and deleting one walked an empty list and left
 * every message behind with nothing pointing at it. Both cleared on reload, which is what kept it.
 *
 * It is also the right type for a **cache of records nobody reads relations off** — a list of
 * sessions, spaces or themes held only to name and address them. `T` is assignable to it, so a
 * loaded record and a created one are the same shape there, and the one thing the two genuinely
 * disagree about is the one thing it refuses.
 *
 * To get the relations, read the record: `findOne(dataset, { where: { id }, include: { … } })`.
 */
export type NewRecord<T extends RecordInstance> = Omit<T, RelationKeysOf<T>>;

/**
 * The static surface every entity presents — what the entity proxies in `@we/entities` are typed
 * as, and what a backend's registered implementations must answer to. Dataset handles are
 * `unknown`: which kind of handle "a dataset" is, is the backend's business (a live proxy, an
 * in-memory store, a connection).
 *
 * ## Why the relation writes below are statics
 *
 * Two reasons, and the first is the plain one: until they existed, the neutral write vocabulary was
 * `create`/`update`/`delete` over a flat field bag, which cannot express a relation at all. So every
 * relation write in the app went around the contract to a model instance's own accessors, and a
 * backend could satisfy this interface completely and still be unable to run a board — where a
 * column's cards, their order, and a board's columns are all relation writes and nothing else.
 *
 * The second is about *seeing* the write. `defineEntity` in `@we/entities` forwards statics to
 * whichever implementation is registered, and it says so plainly: instances come back from the real
 * implementation, so their methods are the implementation's own. A write spelled as an instance
 * method is therefore invisible to every neutral layer — nothing can count it, log it, batch it, or
 * stand in for it while it lands. Spelled as a static it passes through the one place that sees
 * every read already.
 *
 * ## Why they are not on `MutationApi`
 *
 * That is the surface templates reach through `record.create`/`update`/`delete`, and whether a
 * template may relink arbitrary relations is a capability question nobody has answered. These are
 * for stores, which are code that ships with the app.
 */
export interface EntityStatic<T extends RecordInstance> {
  /**
   * Write one record, and answer with it — see {@link NewRecord} for why that is less than a `T`.
   *
   * A backend is free to return more than this (the AD4M lane re-reads the row it just wrote, so its
   * instances carry relation keys holding whatever the relation held at that instant). The narrower
   * type is the promise every backend can keep, and the wider one was read as a guarantee.
   */
  create(dataset: unknown, properties: WriteProperties<T>, options?: CreateOptions): Promise<NewRecord<T>>;
  findAll<Q extends TypedEntityQuery<T>>(dataset: unknown, query?: Q): Promise<(T & IncludeExtras<T, IncludeOf<Q>>)[]>;
  findOne<Q extends TypedEntityQuery<T>>(
    dataset: unknown,
    query?: Q,
  ): Promise<(T & IncludeExtras<T, IncludeOf<Q>>) | null>;
  /** Null for an id nothing holds — an update is a statement about a record that must exist. */
  update(dataset: unknown, id: string, properties: WriteProperties<T>): Promise<T | null>;
  delete(dataset: unknown, id: string): Promise<unknown>;
  count(dataset: unknown, query?: TypedEntityQuery<T>): Promise<number>;

  /**
   * A live read: resolves with the result now, and calls `onChange` with the whole result again
   * whenever it may have changed. `dispose` ends it.
   *
   * Treat a push as "here is the result now", never as "something changed": backends differ on
   * exactly that. The in-memory one re-runs on any write to the dataset and also calls `onChange`
   * with the first result; AD4M calls it only for later results that differ from the last one.
   * A caller that needs to know what changed compares rows itself.
   */
  query<Q extends TypedEntityQuery<T>>(
    dataset: unknown,
    query?: Q,
  ): QuerySubscription<T & IncludeExtras<T, IncludeOf<Q>>>;

  /**
   * Replace a relation's whole membership, in the order given.
   *
   * The write a drag makes: a board column's cards after somebody rearranged them, a board's columns
   * after somebody moved one. `targetIds` is the list as it should now read, and a backend whose
   * relation is declared `ordered` is expected to preserve that order on the way back — where the
   * ordering is *held* is its business (a backend that keeps position hints beside the membership
   * links and merges them lets two people dragging at once converge rather than one write
   * discarding the other).
   *
   * Nothing here indexes, renumbers or breaks a tie. Handing over the whole list and letting the
   * backend diff it is what makes that possible: a backend that can merge has everything it needs,
   * and one that cannot can still write the list.
   *
   * Ids the relation does not already hold join it; ids it holds that the list omits leave it.
   *
   * **To-many relations only, for now.** A to-one link is a different write — "point this at that",
   * not "your membership is this list" — and the two are told apart by the manifest rather than by
   * anything a record carries at runtime, so a backend cannot reliably decide which it was handed.
   * Writing one stays an instance call until there is a reason to settle that, and an implementation
   * is expected to refuse a to-one here rather than guess.
   */
  setRelation(
    dataset: unknown,
    id: string,
    relation: string,
    targetIds: readonly string[],
    batch?: string,
  ): Promise<void>;

  /**
   * Put one record into a relation, leaving the rest alone.
   *
   * Not sugar for {@link EntityStatic.setRelation} with the current list plus one. That spelling
   * needs a read first, and between the read and the write somebody else's addition is lost — which
   * is the whole failure an unordered relation should be immune to. Where the relation is ordered,
   * an addition with no position lands at the end.
   */
  addRelation(dataset: unknown, id: string, relation: string, targetId: string, batch?: string): Promise<void>;

  /**
   * Take one record out of a relation.
   *
   * The counterpart, and the same argument: expressing it as a `set` of everything-but-one turns a
   * removal into a claim about every other member. Removing something the relation does not hold is
   * not an error — it is the state the caller asked for.
   */
  removeRelation(dataset: unknown, id: string, relation: string, targetId: string, batch?: string): Promise<void>;
}
