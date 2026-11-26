/**
 * Entities over plain rows — the in-memory half of what a declared manifest means.
 *
 * The production adapter compiles a manifest into model classes that write links against minted
 * predicates. This compiles the *same manifest* into classes that write objects into arrays, and
 * the difference is invisible to a caller: `Space.findAll(dataset, { where, include })`,
 * `space.save()`, `settings.addInstalledTemplates(t)` all mean what they always meant.
 *
 * That equivalence is the point. Stores and the boot sequence can then be tested against real
 * entity behaviour instead of hand-written fakes — and a fake is exactly what stops being true
 * first, since nothing forces it to keep matching the thing it stands in for.
 *
 * Reads run through the shared query engine (`compileQuery` → `QueryIR` → `executeQueryIR`), so
 * filtering, ordering, paging, relation hydration and count projections are the engine's semantics
 * rather than a second implementation of them.
 */
import type {
  EntityStatic,
  IncludeExtras,
  IncludeOf,
  LivePage as Page,
  LiveQuery,
  ParentRef,
  ParentScope,
  RecordInstance,
  TypedEntityQuery,
} from '@we/backend-shared';
import {
  compileQuery,
  createLiveQuery,
  type CreateOptions,
  type EntityManifest,
  type EntitySchema,
  executeQueryIR,
  type InMemoryDataset,
  type InMemoryRelation,
  readJsonValue,
  RecordExistsError,
  type Row,
  writtenJsonValue,
} from '@we/backend-shared';
import { checkEntityWrite, getEntityForDataset } from '@we/entities';
import { CORE_MANIFEST } from '@we/entities/manifest';

/** The dataset handle the in-memory lifecycle mints — its `tables` are the store. */
interface DatasetEntry {
  id: string;
  tables: Record<string, unknown[]>;
}

export interface EntityRuntime {
  /** The acting agent, recorded as each row's author — the ownership checks templates rely on. */
  selfId(): string | undefined;
}

type AnyRow = Row & Record<string, unknown>;

/** Compiled relation shape, resolved once per manifest rather than per query. */
interface RelationInfo {
  name: string;
  target: string;
  cardinality: 'one' | 'many';
  /** Where the link is stored: on this row for `one`, on the target rows for `many`. */
  foreignKey: string;
}

const manyForeignKey = (entity: string, relation: string) => `__${entity}_${relation}`;

/**
 * One field written to an existing row — where `''` and `null` clear it, as they do in production.
 *
 * Production removes a cleared property rather than storing an empty one, so the record then has no
 * value for it: it still reads back as its declared default, and no query matches it — not
 * `{ field: '' }`, not `{ field: { not: x } }`. This backend used to keep the `''`, so a cleared field
 * went on matching a `not` here and dropped out of the same query in production. Creation follows the
 * same rule: an empty value is not written, whether the caller gave it or it is the declared default,
 * so a record created with `''` and one cleared to `''` are the same record.
 */
/** The ids in a relation value — a list of ids or records — or null when it is not one. '' clears. */
function idsIn(value: unknown): string[] | null {
  if (value === '' || value === null || value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  for (const entry of value as unknown[]) {
    const id = typeof entry === 'string' ? entry : (entry as { id?: unknown } | null)?.id;
    if (typeof id === 'string' && id) ids.push(id);
  }
  return ids;
}

/**
 * The one id a to-one relation is written as: an id, or a record standing for its id. A list is
 * refused rather than read as its first entry — it is a to-many's value, and a caller writing one to
 * a to-one has the relation's cardinality wrong, which no guess fixes for them.
 */
function toOneId(entity: string, relation: string, value: unknown): string | undefined {
  if (Array.isArray(value)) {
    throw new Error(
      `${entity}.${relation} is a to-one relation: write the one record's id, not a list (a list is a to-many's value)`,
    );
  }
  const id = typeof value === 'string' ? value : (value as { id?: unknown } | null | undefined)?.id;
  return typeof id === 'string' && id ? id : undefined;
}

function writeField(row: Record<string, unknown>, key: string, value: unknown): void {
  if (value === '' || value === null) delete row[key];
  else row[key] = value;
}

/** Writes notify per dataset, so a live query re-runs exactly when its dataset changed. */
const listeners = new WeakMap<object, Set<() => void>>();

/**
 * Datasets a transaction is committing into, and whether anything was written to each meanwhile. A
 * live query hears a commit once, after it, rather than once per write inside it — which would hand
 * it every state in between, the thing a transaction exists to hide.
 */
const holding = new Map<DatasetEntry, boolean>();

function notify(dataset: DatasetEntry): void {
  if (holding.has(dataset)) {
    holding.set(dataset, true);
    return;
  }
  for (const listener of listeners.get(dataset) ?? []) listener();
}

// ── Transactions ────────────────────────────────────────────────────────────────────────────────

/** One write a transaction has staged: made at commit, in the order it was asked for. */
interface StagedWrite {
  dataset: DatasetEntry;
  apply(): Promise<void>;
}

/** The write groups open now, by the token their writes carry. */
const openTransactions = new Map<string, StagedWrite[]>();

/** The staged writes of the group `batch` names — undefined for no batch, or one not open here. */
function stagedIn(batch: unknown): StagedWrite[] | undefined {
  return typeof batch === 'string' ? openTransactions.get(batch) : undefined;
}

/** Make `write` now, or stage it in `batch`'s group when that is open. */
async function writeIn(batch: unknown, dataset: DatasetEntry, write: () => Promise<void>): Promise<void> {
  const staged = stagedIn(batch);
  if (staged) staged.push({ dataset, apply: write });
  else await write();
}

type Tables = Record<string, unknown[]>;

/** Every table's rows as they stand, copied deep enough that a write to a row cannot reach the copy. */
function snapshotTables(dataset: DatasetEntry): Tables {
  const copy: Tables = {};
  for (const [entity, rows] of Object.entries(dataset.tables)) {
    copy[entity] = (rows as AnyRow[]).map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, Array.isArray(value) ? [...(value as unknown[])] : value]),
      ),
    );
  }
  return copy;
}

/** Put the tables back as `snapshot` held them, in place, since the lifecycle shares the object. */
function restoreTables(dataset: DatasetEntry, snapshot: Tables): void {
  for (const entity of Object.keys(dataset.tables)) if (!(entity in snapshot)) delete dataset.tables[entity];
  for (const [entity, rows] of Object.entries(snapshot)) {
    const table = dataset.tables[entity];
    if (table) table.splice(0, table.length, ...rows);
    else dataset.tables[entity] = rows;
  }
}

/** Commits run one at a time, so two of them can never be holding, or restoring, the same tables. */
let committing: Promise<unknown> = Promise.resolve();

/**
 * Make a group's staged writes, all of them or none.
 *
 * Each write runs as it would have outside a group — its write check, its relation links — but
 * against the tables as the writes before it left them, so a write can name a record an earlier one
 * created. If any of them throws, the tables go back to how they stood before the first, and nobody
 * is told anything changed, because nothing did.
 *
 * What it cannot hold off is a write made outside any group while the commit is between two of its
 * own: that one lands, and a rollback takes it away again. The window is a commit's write checks,
 * which in this backend is as long as a microtask or two.
 */
function commit(staged: StagedWrite[]): Promise<void> {
  const run = async () => {
    const datasets = [...new Set(staged.map((write) => write.dataset))];
    const before = new Map(datasets.map((dataset) => [dataset, snapshotTables(dataset)]));
    for (const dataset of datasets) holding.set(dataset, false);
    try {
      for (const write of staged) await write.apply();
    } catch (error) {
      for (const [dataset, snapshot] of before) restoreTables(dataset, snapshot);
      for (const dataset of datasets) holding.delete(dataset);
      throw error;
    }
    const written = datasets.filter((dataset) => holding.get(dataset));
    for (const dataset of datasets) holding.delete(dataset);
    for (const dataset of written) notify(dataset);
  };
  const done = committing.then(run, run);
  committing = done.catch(() => {});
  return done;
}

/**
 * This backend's transaction runner, registered by its ports.
 *
 * The writes `run` makes with the token it is handed are staged rather than made, and made together
 * once it resolves; if it throws, none are made and its error is rethrown. Reads inside `run` see
 * committed state only, which is the contract's rule, and here it falls out of staging: nothing
 * staged is in a table until the commit.
 *
 * Instances a write handed back describe what it will write: a failed group leaves them describing
 * records that were never made.
 */
export async function runInMemoryTransaction<R>(
  _dataset: unknown,
  run: (tx: { batchId?: string }) => Promise<R>,
): Promise<R> {
  const batchId = `batch:${crypto.randomUUID()}`;
  const staged: StagedWrite[] = [];
  openTransactions.set(batchId, staged);
  let result: R;
  try {
    result = await run({ batchId });
  } finally {
    // Closed before the commit, so a write that arrives late with this token is made on its own
    // rather than staged into a group that has already been decided.
    openTransactions.delete(batchId);
  }
  await commit(staged);
  return result;
}

/** The id `create` refuses: one some record in this dataset already holds, whichever entity's. */
function refuseExisting(dataset: DatasetEntry, id: string): void {
  for (const rows of Object.values(dataset.tables)) {
    if ((rows as AnyRow[]).some((row) => row.id === id)) throw new RecordExistsError(id);
  }
}

function watch(dataset: DatasetEntry, listener: () => void): () => void {
  const set = listeners.get(dataset) ?? new Set();
  listeners.set(dataset, set);
  set.add(listener);
  return () => set.delete(listener);
}

function tableOf(dataset: DatasetEntry, entity: string): AnyRow[] {
  dataset.tables[entity] ??= [];
  return dataset.tables[entity] as AnyRow[];
}

/**
 * `order` arrives in two dialects — the ORM's `ASC`/`DESC` and the flat `$query` dialect's
 * lowercase — because the same entity API serves both callers. Normalizing here keeps that
 * detail out of every store.
 */
function normalizeOrder(order: unknown): Record<string, 'asc' | 'desc'> | undefined {
  if (!order || typeof order !== 'object') return undefined;
  const out: Record<string, 'asc' | 'desc'> = {};
  for (const [key, dir] of Object.entries(order as Record<string, unknown>)) {
    out[key] = String(dir).toLowerCase() === 'desc' ? 'desc' : 'asc';
  }
  return out;
}

/**
 * An instance this backend hands out: the neutral base contract, honestly — every row is stamped
 * with id/author/createdAt/updatedAt at creation and hydration attaches save/delete — plus the
 * manifest-declared fields, which are dynamic here and so typed as the open remainder.
 */
export type InMemoryInstance = RecordInstance & Record<string, unknown>;

/**
 * A query as this backend takes it: the contract's typed shape, or the untyped record a dynamic
 * caller (the schema renderer, a space-defined entity) passes. The union rather than only the
 * record because `TypedEntityQuery` is an interface — it carries no implicit index signature, so it
 * is not assignable *to* a record type, and the contract's callers must be accepted as they come.
 */
type AnyQuery = Record<string, unknown> | TypedEntityQuery<RecordInstance>;

export interface EntityClassLike {
  new (): Record<string, unknown>;
  entityName: string;
  findAll<Q extends TypedEntityQuery<RecordInstance>>(
    dataset: unknown,
    query?: Q | AnyQuery,
  ): Promise<(InMemoryInstance & IncludeExtras<RecordInstance, IncludeOf<Q>>)[]>;
  findOne<Q extends TypedEntityQuery<RecordInstance>>(
    dataset: unknown,
    query?: Q | AnyQuery,
  ): Promise<(InMemoryInstance & IncludeExtras<RecordInstance, IncludeOf<Q>>) | null>;
  create(dataset: unknown, data?: Record<string, unknown>, options?: CreateOptions): Promise<InMemoryInstance>;
  update(dataset: unknown, id: string, data: Record<string, unknown>): Promise<InMemoryInstance | null>;
  delete(dataset: unknown, id: string): Promise<unknown>;
  count(dataset: unknown, query?: AnyQuery): Promise<number>;
  setRelation(
    dataset: unknown,
    id: string,
    relation: string,
    targetIds: readonly string[],
    batch?: string,
  ): Promise<void>;
  addRelation(dataset: unknown, id: string, relation: string, targetId: string, batch?: string): Promise<void>;
  removeRelation(dataset: unknown, id: string, relation: string, targetId: string, batch?: string): Promise<void>;
  query<Q extends TypedEntityQuery<RecordInstance>>(
    dataset: unknown,
    query?: Q | AnyQuery,
  ): LiveQuery<Page<InMemoryInstance & IncludeExtras<RecordInstance, IncludeOf<Q>>>>;
}

/**
 * The contract, checked: this backend's compiled entities present the same static surface the
 * entity proxies are typed as — which is what makes it a second *conforming* implementation
 * rather than a lookalike. (The production lane cannot make this assertion structurally — its
 * statics are `this`-polymorphic — so this is also the one place the contract is compiler-verified
 * end to end.)
 */
type Satisfies<A extends B, B> = A;
export type AssertEntityClassSatisfiesContract = Satisfies<EntityClassLike, EntityStatic<RecordInstance>>;

/**
 * Compile a manifest into entity classes backed by in-memory rows.
 *
 * Predicates are ignored on purpose: they are how *this* storage model identifies a field, and a
 * table-shaped backend identifies it by column name. A manifest that only made sense as triples
 * would not be a declaration, it would be a dialect.
 */
export function compileEntities(manifest: EntityManifest, runtime: EntityRuntime): Record<string, EntityClassLike> {
  const classes: Record<string, EntityClassLike> = {};

  /*
    A new record linked under a parent named by id and relation — `create(…, { parent })`.

    AD4M writes that link with the record, which is what lets a transcript block or a space's canvas
    be made inside its container with no window in which it is loose. The parent is found by id in
    whichever table holds it, and the relation by its name on that entity — which is all a table
    needs, and what the contract says.
  */
  /** Whether this compile can say what an entity declares — its own manifest's, or the core's. */
  const declaredHere = (name: string) => Boolean(manifest.entities[name] ?? CORE_MANIFEST.entities[name]);

  /**
   * The parent named by id and relation, as the entity and relation holding it — what both a write
   * under a parent and a read under one need. Null when no record has that id, or its entity declares
   * no such relation (or only reads it backwards).
   */
  const relationUnder = (
    dataset: DatasetEntry,
    parent: ParentRef,
  ): { entity: string; relation: string; row: AnyRow } | null => {
    // An abstract entity names no table of its own: `WeNode` as the parent means any record that
    // carries the relation, which is every entity built on it.
    const named = parent.entity
      ? (manifest.entities[parent.entity] ?? CORE_MANIFEST.entities[parent.entity])
      : undefined;
    const byName = parent.entity && !named?.abstract;
    // Every table, not only this manifest's: a module's block is made under a core post, whose
    // entity was compiled from another manifest.
    for (const entityName of byName ? [parent.entity!] : Object.keys(dataset.tables)) {
      const row = (dataset.tables[entityName] as AnyRow[] | undefined)?.find((r) => r.id === parent.id);
      if (!row) continue;
      const spec = declaredHere(entityName) ? resolved(entityName).relations[parent.relation] : undefined;
      return spec && !spec.reverseOf ? { entity: entityName, relation: parent.relation, row } : null;
    }
    return null;
  };

  /*
    Instances whose relation writes are part of a create rather than writes of their own: the new
    record's relations named in its data, and the link to its parent. The create was checked as a
    whole, which is what the production adapter does too — its parent link is written with the record.
  */
  const writingCreate = new WeakSet<object>();

  const linkUnder = async (dataset: DatasetEntry, parent: ParentRef, childId: string) => {
    const under = relationUnder(dataset, parent);
    if (!under) return;
    const parentClass = (classes[under.entity] ?? getEntityForDataset(under.entity, dataset)) as unknown as {
      hydrate(d: DatasetEntry, r: AnyRow): AnyRow;
    };
    const instance = parentClass.hydrate(dataset, under.row);
    const add = instance[`add${under.relation.charAt(0).toUpperCase()}${under.relation.slice(1)}`];
    if (typeof add !== 'function') return;
    writingCreate.add(instance);
    try {
      await (add as (id: string) => Promise<void>).call(instance, childId);
    } finally {
      writingCreate.delete(instance);
    }
  };

  /**
   * Everything an entity declares, including whatever it inherits — from the core vocabulary when
   * the parent is not in this manifest, which is the case for every space shape extending `WeNode`.
   */
  const resolved = (name: string): EntitySchema => {
    const entity = manifest.entities[name] ?? CORE_MANIFEST.entities[name];
    if (!entity) throw new Error(`manifest: "${name}" is not declared here or in the core vocabulary`);
    const parent = entity.extends ? resolved(entity.extends) : undefined;
    if (!parent) return entity;
    return {
      ...entity,
      properties: { ...parent.properties, ...entity.properties },
      relations: { ...parent.relations, ...entity.relations },
    };
  };

  /** The relation map the query engine needs, for every entity at once. */
  const engineRelations: NonNullable<InMemoryDataset['relations']> = {};
  const relationsByEntity: Record<string, RelationInfo[]> = {};

  for (const name of Object.keys(manifest.entities)) {
    const entity = resolved(name);
    const infos: RelationInfo[] = [];
    engineRelations[name] = {};
    for (const [relName, spec] of Object.entries(entity.relations)) {
      const cardinality = spec.cardinality === 'one' ? 'one' : 'many';
      const info: RelationInfo = {
        name: relName,
        target: spec.target || '',
        cardinality,
        foreignKey: cardinality === 'one' ? relName : manyForeignKey(name, relName),
      };
      infos.push(info);
      // Registered even when untyped (no declared target). It used to be omitted, on the grounds
      // that there is nothing to *hydrate* against — true, and it also took `scope` down with it,
      // because a drill-down needs only the foreign key and resolves through this same map. The
      // engine fails a drill-down closed, so an unregistered relation meant "this container has no
      // children" rather than an error, and `CollectionBlock.children` — untyped by design, since a
      // collection holds any block type — is the relation every showcase template drills through.
      //
      // An `include` over one reads every table, each member tagged with the entity it came from —
      // see `resolveRelation` in the shared query engine.
      engineRelations[name][relName] = {
        target: info.target,
        cardinality,
        foreignKey: info.foreignKey,
        // The write path already records the ids in the order they were assigned, on the parent row
        // under the relation's own name; without this the engine re-derived membership from the
        // foreign key and handed back whichever order the child table happened to be in.
        ...(spec.ordered ? { ordered: true } : {}),
      } satisfies InMemoryRelation;
    }
    relationsByEntity[name] = infos;
  }

  /*
    The reverse relations, by the forward relation they read back: `responses` → `respondsTo`.

    A reverse relation (`reverseOf`) is the same link read from the other end, so nothing writes it
    directly — and nothing here derived it either, so `respondsTo` was empty on every record. Every
    comment thread rebuilds its tree from it, and the feeds leave replies out with
    `respondsTo: { none: {} }`, so on this backend a reply showed up as a post of its own and a thread
    had no shape. The forward write now stamps the parent on the child under the reverse relation's
    name, which is where the query engine reads a to-one link from.
  */
  const reversesOf = new Map<string, string[]>();
  for (const name of Object.keys(manifest.entities)) {
    for (const [relName, spec] of Object.entries(resolved(name).relations)) {
      if (!spec.reverseOf) continue;
      const names = reversesOf.get(spec.reverseOf) ?? [];
      if (!names.includes(relName)) reversesOf.set(spec.reverseOf, [...names, relName]);
    }
  }
  const linkReverse = (forward: string, child: AnyRow, parentId: string, linked: boolean) => {
    for (const reverse of reversesOf.get(forward) ?? []) {
      if (linked) child[reverse] = parentId;
      // Only if it still points here: a child since linked under another parent keeps that one.
      else if (child[reverse] === parentId) delete child[reverse];
    }
  };

  /*
    A deleted record takes every link to it with it, as it does on AD4M — `Ad4mModel.delete` removes
    the incoming links as well as its own, so a parent's `children` never names a record that is
    gone. Here a link is a relation field on a row (a forward list, or a to-one under its own or its
    reverse name), so forgetting one is taking the id out of every relation field that holds it.
    Relation fields only: a property that happens to hold the id as text (`ReadMarker.nodeId`) is a
    value, not a link, and AD4M leaves it too.
  */
  const relationNames = new Map<string, string[]>();
  for (const name of Object.keys(manifest.entities)) {
    relationNames.set(name, Object.keys(resolved(name).relations));
  }
  const forgetLinksTo = (dataset: DatasetEntry, id: string) => {
    for (const [entity, rows] of Object.entries(dataset.tables)) {
      const names = relationNames.get(entity) ?? [];
      for (const row of rows as AnyRow[]) {
        for (const key of names) {
          const value = row[key];
          if (Array.isArray(value) && value.includes(id)) row[key] = value.filter((v) => v !== id);
          else if (value === id) delete row[key];
        }
      }
    }
  };

  const datasetOf = (handle: unknown): DatasetEntry => {
    const entry = handle as DatasetEntry | undefined;
    if (!entry || typeof entry !== 'object' || !('tables' in entry)) {
      throw new Error(
        'In-memory entities need the dataset handle the lifecycle port minted. ' +
          'Passing a DatasetRef (or nothing) reaches here instead — use `.handle`.',
      );
    }
    return entry;
  };

  for (const name of Object.keys(manifest.entities)) {
    const entity = resolved(name);
    const relations = relationsByEntity[name];
    const relationNames = new Set(relations.map((r) => r.name));
    const toOne = new Set(relations.filter((r) => r.cardinality === 'one').map((r) => r.name));
    const toMany = new Set(relations.filter((r) => r.cardinality === 'many').map((r) => r.name));

    /** Declared starting values — the manifest's `default`, and nothing invented on top. */
    const defaults = (): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [prop, spec] of Object.entries(entity.properties)) {
        if (spec.default !== undefined) out[prop] = spec.default;
      }
      for (const relation of relations) if (relation.cardinality === 'many') out[relation.name] = [];
      return out;
    };

    /*
      A `json` property holds a value, and a row keeps its own copy of it: the caller's object is
      never the stored one, and an instance hands out a copy, so changing a value in place changes
      nothing until it is saved. Text written to one is parsed, as on every backend; see
      `writtenJsonValue`.
    */
    const jsonProps = new Set(
      Object.entries(entity.properties)
        .filter(([, spec]) => spec.type === 'json')
        .map(([prop]) => prop),
    );
    const stored = (data: Record<string, unknown>): Record<string, unknown> =>
      jsonProps.size
        ? Object.fromEntries(
            Object.entries(data).map(([key, value]) => [
              key,
              jsonProps.has(key) ? (writtenJsonValue(`${name}.${key}`, value) ?? null) : value,
            ]),
          )
        : data;
    const readBack = (key: string, value: unknown): unknown => {
      const read = readJsonValue(`${name}.${key}`, value);
      return read !== null && typeof read === 'object' ? structuredClone(read) : read;
    };
    const sameJson = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

    /** Instances remember where they came from, so `save()` and `delete()` need no argument. */
    const homes = new WeakMap<object, DatasetEntry>();

    /** What each instance held when it was read, so `save()` writes only what the caller changed since. */
    const loaded = new WeakMap<object, Record<string, unknown>>();

    /** A required property is refused a `''` or `null` before anything is written, as the SDK refuses it. */
    const checkClearable = (changed: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(changed)) {
        if ((value === '' || value === null) && entity.properties[key]?.required) {
          throw new Error(`Property "${key}" is required and cannot be cleared`);
        }
      }
    };

    /** The row as it stands now, for a check to read — copied before the write changes it. */
    const copied = (row: AnyRow | null) => {
      const before = row ? { ...row } : null;
      return () => before;
    };

    const checkDelete = (dataset: DatasetEntry, row: AnyRow) =>
      checkEntityWrite({ dataset, entity: name, kind: 'delete', id: row.id as string, record: copied(row) });

    /** A relation write on `instance`, unless it is part of the create that made it. */
    const checkRelation = (dataset: DatasetEntry, instance: AnyRow, relation: string, kind: 'add' | 'remove') => {
      if (writingCreate.has(instance)) return;
      const row = tableOf(dataset, name).find((r) => r.id === instance.id);
      return checkEntityWrite({
        dataset,
        entity: name,
        kind,
        id: instance.id as string,
        relation,
        record: copied(row ?? null),
      });
    };

    class Entity {
      static entityName = name;

      constructor() {
        Object.assign(this, defaults());
      }

      /**
       * Copy the persisted columns back over the row this instance came from.
       *
       * In a transaction the fields are taken now and written at its commit, so what is saved is
       * the instance as it stood at this call, and a record created earlier in the same group is
       * there to be saved onto by then.
       */
      async save(batch?: string): Promise<void> {
        const dataset = homes.get(this);
        if (!dataset) throw new Error(`${name}.save(): this instance was never loaded from a dataset`);
        const fields = stored({ ...(this as unknown as Record<string, unknown>) });
        await writeIn(batch, dataset, async () => {
          const row = tableOf(dataset, name).find((r) => r.id === fields.id);
          if (!row) throw new Error(`${name}.save(): row ${String(fields.id)} no longer exists`);
          const changed: Record<string, unknown> = {};
          const lists: Record<string, string[]> = {};
          for (const [key, value] of Object.entries(fields)) {
            if (typeof value === 'function' || key.startsWith('$')) continue;
            /*
              A to-many relation written in an edit is the whole list, written as `set<Relation>`
              writes it — so each member's key and the reverse relation move with it, which a bare
              copy of the list onto the row left behind.
            */
            if (toMany.has(key)) {
              // Untouched since the read: the list as it was read is not a decision to write it back.
              if (loaded.get(this)?.[key] === value) continue;
              const ids = idsIn(value);
              const now = idsIn(row[key]);
              if (ids && (ids.length !== now?.length || ids.some((one, i) => one !== now[i]))) lists[key] = ids;
              continue;
            }
            if (jsonProps.has(key)) {
              if (!sameJson(row[key], value)) changed[key] = value;
              continue;
            }
            // A to-one relation written in an edit is stored as the one id it points at: an id, or a
            // record standing for its id. A create reads it the same way.
            if (toOne.has(key) && value !== '' && value !== null) {
              const id = toOneId(name, key, value);
              if (!id) continue;
              if (row[key] === id) continue;
              changed[key] = id;
              continue;
            }
            // Only what the caller changed since the read: a default standing in for a cleared field
            // is not a change, and must not write the field back.
            if (row[key] === value || loaded.get(this)?.[key] === value) continue;
            changed[key] = value;
          }
          if (!Object.keys(changed).length && !Object.keys(lists).length) return;
          if (Object.keys(changed).length) {
            checkClearable(changed);
            await checkEntityWrite({
              dataset: dataset,
              entity: name,
              kind: 'edit',
              id: row.id as string,
              data: changed,
              record: copied(row),
            });
            for (const [key, value] of Object.entries(changed)) writeField(row, key, value);
            row.updatedAt = new Date().toISOString();
          }
          for (const [key, ids] of Object.entries(lists)) {
            // A fresh instance of the row, so the accessor diffs against what is stored.
            const current = Entity.hydrate(dataset, row) as unknown as Record<string, unknown>;
            const set = current[`set${key.charAt(0).toUpperCase()}${key.slice(1)}`] as (ids: string[]) => Promise<void>;
            await set.call(current, ids);
          }
          // What was just saved is the new baseline, so changing a field back is a change again.
          loaded.set(this, fields);
          notify(dataset);
        });
      }

      async delete(batch?: string): Promise<void> {
        const dataset = homes.get(this);
        if (!dataset) throw new Error(`${name}.delete(): this instance was never loaded from a dataset`);
        const id = (this as unknown as AnyRow).id as string;
        await writeIn(batch, dataset, async () => {
          const rows = tableOf(dataset, name);
          const index = rows.findIndex((r) => r.id === id);
          if (index >= 0) {
            await checkDelete(dataset, rows[index]);
            rows.splice(index, 1);
          }
          forgetLinksTo(dataset, id);
          notify(dataset);
        });
      }

      static hydrate(dataset: DatasetEntry, row: AnyRow): Entity {
        const instance = new Entity() as Entity & Record<string, unknown>;
        homes.set(instance, dataset);
        for (const [key, value] of Object.entries(row)) {
          if (key.startsWith('__')) continue;
          const relation = relations.find((r) => r.name === key);
          const target = relation?.target ? classes[relation.target] : undefined;
          /*
            A hydrated relation comes back as rows; give the caller instances, so a related model
            behaves like one rather than like a plain object that happens to have fields.

            **An id is not a row.** A to-many relation that was not `include`d holds the ids it
            links, and a string handed to `hydrate` is spread character by character — so reading
            `column.arranges` without an include answered with a list of objects keyed `'0'`, `'1'`,
            `'2'`, each carrying one letter of an id. Nothing threw. `idsOf` in `arrangedBoard`
            tolerates ids or rows and takes `.id` from an object, which those do not have, so a board
            read this way simply had no cards in any column and no error anywhere.
          */
          if (jsonProps.has(key)) {
            instance[key] = readBack(key, value);
            continue;
          }
          if (relation && target && value && typeof value === 'object') {
            const asEntity = target as unknown as typeof Entity;
            const hydrateOne = (entry: unknown) =>
              entry && typeof entry === 'object' ? asEntity.hydrate(dataset, entry as AnyRow) : entry;
            instance[key] = Array.isArray(value) ? value.map(hydrateOne) : hydrateOne(value);
            continue;
          }
          instance[key] = value;
        }
        loaded.set(instance, { ...instance });
        return instance;
      }

      static rowsFor(dataset: DatasetEntry, query: Record<string, unknown> = {}): AnyRow[] {
        // `select` is the template dialect; `properties` is the record contract's name for the same list.
        const { where, order, limit, offset, include, select = query.properties, properties, parent, ...rest } = query;
        void properties;
        void rest;
        /*
          A parent named by id and relation — the ORM's `parent` — read as the drill-down it is. It
          used to fall into `rest` and be dropped, so "this call's lines" answered with every line in
          the space. A parent that holds nothing through that relation has no children.
        */
        let scope = query.scope;
        if (parent && typeof parent === 'object') {
          const named = parent as ParentScope;
          const under = relationUnder(dataset, named);
          if (!under) return [];
          // A walk below the parent, as `$query`'s scope takes one, rather than its own members only.
          scope = {
            anchor: under.entity,
            via: under.relation,
            anchorId: under.row.id,
            ...(named.levels ? { levels: named.levels } : {}),
            ...(named.transitive ? { transitive: true } : {}),
          };
        }
        const { ir, unsupported } = compileQuery({
          entity: name,
          ...(where ? { where: where as Record<string, unknown> } : {}),
          ...(normalizeOrder(order) ? { order: normalizeOrder(order) } : {}),
          ...(typeof limit === 'number' ? { limit } : {}),
          ...(typeof offset === 'number' ? { offset } : {}),
          ...(include ? { include: include as Record<string, unknown> } : {}),
          ...(Array.isArray(select) ? { select: select as string[] } : {}),
          // A drill-down the engine has always been able to execute (`scopeRows`) and this layer
          // silently dropped into `rest` — so a scoped query answered as if it were unscoped,
          // returning every row in the table rather than one container's children.
          ...(scope ? { scope: scope as Parameters<typeof compileQuery>[0]['scope'] } : {}),
        });
        if (unsupported.length) {
          throw new Error(
            `${name}: query uses ${unsupported.join(', ')}, which the neutral query IR does not carry. ` +
              'Surfacing it beats answering a different question than the one asked.',
          );
        }
        const data: InMemoryDataset = { tables: dataset.tables as Record<string, Row[]>, relations: engineRelations };
        return executeQueryIR(ir, data);
      }

      /**
       * Rows as instances. Under a field selection an instance carries only what was selected, as any
       * backend's does: the class's field defaults would otherwise stand in for fields the query never
       * asked for, and an empty title reads as a real one.
       */
      static read(dataset: DatasetEntry, query: Record<string, unknown>): Entity[] {
        const narrowed = Array.isArray(query.select ?? query.properties);
        return Entity.rowsFor(dataset, query).map((row) => {
          const instance = Entity.hydrate(dataset, row) as Entity & Record<string, unknown>;
          if (narrowed) for (const key of Object.keys(instance)) if (!(key in row)) delete instance[key];
          return instance;
        });
      }

      // eslint-disable-next-line @typescript-eslint/require-await -- Kept async so a handle the lifecycle port did not mint reaches the caller as a rejection, not a synchronous throw.
      static async findAll(handle: unknown, query: Record<string, unknown> = {}): Promise<Entity[]> {
        const dataset = datasetOf(handle);
        return Entity.read(dataset, query);
      }

      static async findOne(handle: unknown, query: Record<string, unknown> = {}): Promise<Entity | null> {
        const found = await Entity.findAll(handle, { ...query, limit: 1 });
        return found[0] ?? null;
      }

      /**
       * Write one record — now, or at the commit of the transaction `options.batchId` names.
       *
       * The row is built now either way, so the instance handed back carries its id at once and a
       * later write in the same group can name it. Everything else — the id check, the write check,
       * the row landing, its relations and its parent link — is the write, and waits for the commit
       * with the rest of the group. So a refused create in a group refuses the whole group, at its end.
       */
      static async create(
        handle: unknown,
        data: Record<string, unknown> = {},
        options?: CreateOptions,
      ): Promise<Entity> {
        const dataset = datasetOf(handle);
        // A record's id is not one of its values. Refused rather than honoured or dropped, so a caller
        // still writing it as a field finds out here rather than by getting a different id back.
        if ('id' in data) {
          throw new Error(`${name}.create(): "id" is not a field — pass the id a caller chose as the "id" option`);
        }
        // A to-one given as a list is refused before anything is written.
        for (const [key, value] of Object.entries(data)) if (toOne.has(key) && value != null) toOneId(name, key, value);
        const chosen = options?.id;
        if (chosen !== undefined && (typeof chosen !== 'string' || !chosen)) {
          throw new Error(`${name}.create(): the "id" option must be a non-empty string`);
        }
        const now = new Date().toISOString();
        const row: AnyRow = {
          id: chosen ?? crypto.randomUUID(),
          author: runtime.selfId() ?? '',
          timestamp: now,
          createdAt: now,
          updatedAt: now,
        };
        for (const [key, value] of Object.entries(defaults())) writeField(row, key, value);
        for (const [key, value] of Object.entries(stored(data))) {
          if (relationNames.has(key)) continue;
          writeField(row, key, value);
        }
        const instance = Entity.hydrate(dataset, row);
        await writeIn(options?.batchId, dataset, async () => {
          // Judged when the row would land, so an earlier create in the same group counts too.
          refuseExisting(dataset, row.id as string);
          await checkEntityWrite({ dataset: handle, entity: name, kind: 'create', data, record: () => null });
          tableOf(dataset, name).push(row);
          notify(dataset);
          writingCreate.add(instance);
          try {
            await Entity.linkNamedRelations(instance, data);
          } finally {
            writingCreate.delete(instance);
          }
          if (options?.parent) await linkUnder(dataset, options.parent, row.id as string);
        });
        return instance;
      }

      private static async linkNamedRelations(instance: Entity, data: Record<string, unknown>): Promise<void> {
        /*
          Relations named in the data are linked, not dropped.

          They used to be skipped, so `record.create('Loan', { item })` wrote a loan pointing at
          nothing — while AD4M's `save()` sets relations on a new instance, so the two backends
          disagreed and the preview, built on this one, showed a template broken that was not. Linked
          through the same accessors as `add<Relation>`, so this write and that one keep the foreign
          keys in step in one place. An id or an instance, one or a list.
        */
        for (const [key, value] of Object.entries(data)) {
          if (!relationNames.has(key) || value == null) continue;
          const add = (instance as unknown as Record<string, unknown>)[
            `add${key.charAt(0).toUpperCase()}${key.slice(1)}`
          ];
          if (typeof add !== 'function') continue;
          for (const one of Array.isArray(value) ? value : [value]) {
            const id = typeof one === 'string' ? one : (one as AnyRow | null)?.id;
            if (typeof id === 'string' && id) await (add as (target: string) => Promise<void>).call(instance, id);
          }
        }
      }

      /**
       * Edit one record by id: the record read, the fields set on it and saved — the instance's own
       * `save()`, as AD4M's static update is. One edit path, so a relation named in an edit is
       * written whichever way the edit was made; this used to drop relation fields while `save()`
       * wrote them, and a write that typechecked and ran moved nothing.
       */
      static async update(handle: unknown, id: string, data: Record<string, unknown>): Promise<Entity | null> {
        const dataset = datasetOf(handle);
        const row = tableOf(dataset, name).find((r) => r.id === id);
        if (!row) return null;
        const instance = Entity.hydrate(dataset, row);
        Object.assign(instance, data);
        await instance.save();
        return Entity.hydrate(dataset, row);
      }

      /**
       * The relation writes, by id — the contract's counterpart to the per-relation accessors the
       * prototype gets below.
       *
       * Dispatched to those rather than reimplemented: `setChildren` and `setRelation(…, 'children',
       * …)` must not be two pieces of code that can disagree about what writing a relation means, and
       * on this backend the accessors are where the foreign keys are kept in step.
       *
       * A relation this entity does not declare throws rather than writing nothing. The name arrives
       * as a string, so a typo is otherwise a write that silently does not happen — the failure that
       * is hardest to see from the call site and easiest to report from here.
       *
       * In a transaction the write waits for its commit, and finds the record then — so a record
       * created earlier in the same group can be written onto.
       */
      static async setRelation(
        handle: unknown,
        id: string,
        relation: string,
        targetIds: readonly string[],
        batch?: string,
      ) {
        await Entity.viaAccessor(handle, id, relation, 'set', [...targetIds], batch);
      }

      static async addRelation(handle: unknown, id: string, relation: string, targetId: string, batch?: string) {
        await Entity.viaAccessor(handle, id, relation, 'add', targetId, batch);
      }

      static async removeRelation(handle: unknown, id: string, relation: string, targetId: string, batch?: string) {
        await Entity.viaAccessor(handle, id, relation, 'remove', targetId, batch);
      }

      private static async viaAccessor(
        handle: unknown,
        id: string,
        relation: string,
        verb: 'set' | 'add' | 'remove',
        argument: unknown,
        batch?: string,
      ): Promise<void> {
        const info = relations.find((r) => r.name === relation);
        if (!info) {
          throw new Error(
            `${name}.${verb}Relation(): "${relation}" is not a relation of ${name}. ` +
              `It declares: ${[...relationNames].join(', ') || '(none)'}.`,
          );
        }
        // A to-one link is a different write — "point this at that", not "your membership is this
        // list" — and the contract says an implementation refuses rather than guesses. Refusing here
        // rather than in the caller is what makes the refusal the same on every backend.
        if (info.cardinality === 'one') {
          throw new Error(
            `${name}.${verb}Relation(): "${relation}" is a to-one relation. The relation writes are ` +
              'for to-many relations; set a single link through the record itself.',
          );
        }
        const dataset = datasetOf(handle);
        await writeIn(batch, dataset, async () => {
          const row = tableOf(dataset, name).find((r) => r.id === id);
          // Not an error: a record deleted between reading it and arranging it is the ordinary race,
          // and the caller's intent — "this record's relation should read like that" — is satisfied
          // by there being no such record.
          if (!row) return;
          const instance = Entity.hydrate(dataset, row) as unknown as Record<string, unknown>;
          const accessor = `${verb}${relation.charAt(0).toUpperCase()}${relation.slice(1)}`;
          await (instance[accessor] as (a: unknown) => Promise<void>).call(instance, argument);
        });
      }

      /**
       * Static delete by id — the contract's counterpart to the instance method, and a hole this
       * backend actually had: stores call `MutedAgent.delete(dataset, id)`, which resolved to
       * nothing here and threw. Deleting what does not exist is a no-op, as with instance delete.
       */
      static async delete(handle: unknown, id: string): Promise<void> {
        const dataset = datasetOf(handle);
        const rows = tableOf(dataset, name);
        const index = rows.findIndex((r) => r.id === id);
        if (index >= 0) {
          await checkDelete(dataset, rows[index]);
          rows.splice(index, 1);
        }
        forgetLinksTo(dataset, id);
        notify(dataset);
      }

      static async count(handle: unknown, query: Record<string, unknown> = {}): Promise<number> {
        return (await Entity.findAll(handle, query)).length;
      }

      /**
       * A live query: it opens on the current results, then reads again on every write to this
       * dataset and makes a new snapshot when the result differs.
       */
      static query(handle: unknown, q: Record<string, unknown> = {}) {
        const dataset = datasetOf(handle);
        return createLiveQuery({
          read: () => ({ results: Entity.read(dataset, q) }),
          watch: (onChange) => watch(dataset, onChange),
        });
      }
    }

    Object.defineProperty(Entity, 'name', { value: name });

    // Relation helpers, named after the relation the way the ORM names them: `screenshots` →
    // `addScreenshots` / `getScreenshots` / `removeScreenshots`.
    for (const relation of relations) {
      const suffix = relation.name.charAt(0).toUpperCase() + relation.name.slice(1);
      const proto = Entity.prototype as unknown as Record<string, unknown>;

      proto[`add${suffix}`] = async function (this: AnyRow, related: unknown, batch?: string): Promise<void> {
        const dataset = homes.get(this);
        if (!dataset) throw new Error(`${name}.add${suffix}(): this instance was never loaded from a dataset`);
        const relatedId = typeof related === 'string' ? related : (related as AnyRow)?.id;
        if (!relatedId) throw new Error(`${name}.add${suffix}(): expected a related instance or its id`);
        await writeIn(batch, dataset, async () => {
          await checkRelation(dataset, this, relation.name, 'add');

          if (relation.cardinality === 'one') {
            const row = tableOf(dataset, name).find((r) => r.id === this.id);
            if (row) row[relation.foreignKey] = relatedId;
            this[relation.name] = relatedId;
          } else {
            // An untyped relation does not say which table the child is in, so look in all of them.
            // Without this the link was never written at all: `addChildren` updated the in-memory
            // instance array and nothing else, so containment vanished on the next read.
            const targetRow = relation.target
              ? tableOf(dataset, relation.target).find((r) => r.id === relatedId)
              : Object.values(dataset.tables)
                  .flatMap((rows) => rows as AnyRow[])
                  .find((r) => r.id === relatedId);
            if (targetRow) {
              targetRow[relation.foreignKey] = this.id;
              linkReverse(relation.name, targetRow, this.id as string, true);
            }
            const current = Array.isArray(this[relation.name]) ? (this[relation.name] as unknown[]) : [];
            if (!current.includes(relatedId)) this[relation.name] = [...current, relatedId];
            const row = tableOf(dataset, name).find((r) => r.id === this.id);
            if (row) row[relation.name] = this[relation.name];
          }
          notify(dataset);
        });
      };

      // eslint-disable-next-line @typescript-eslint/require-await -- Kept async so a failure hydrating a related row reaches the caller as a rejection, as the ORM's would.
      proto[`get${suffix}`] = async function (this: AnyRow): Promise<unknown> {
        const dataset = homes.get(this);
        if (!dataset || !relation.target) return relation.cardinality === 'one' ? null : [];
        const target = classes[relation.target] as unknown as { hydrate(d: DatasetEntry, r: AnyRow): unknown };
        const rows = tableOf(dataset, relation.target);
        if (relation.cardinality === 'one') {
          const row = rows.find((r) => r.id === this[relation.name]);
          return row ? target.hydrate(dataset, row) : null;
        }
        return rows.filter((r) => r[relation.foreignKey] === this.id).map((r) => target.hydrate(dataset, r));
      };

      proto[`remove${suffix}`] = async function (this: AnyRow, related: unknown, batch?: string): Promise<void> {
        const dataset = homes.get(this);
        if (!dataset) return;
        await writeIn(batch, dataset, async () => {
          const relatedId = typeof related === 'string' ? related : (related as AnyRow)?.id;
          await checkRelation(dataset, this, relation.name, 'remove');
          const row = tableOf(dataset, name).find((r) => r.id === this.id);

          if (relation.cardinality === 'one') {
            if (row) row[relation.foreignKey] = '';
            this[relation.name] = '';
          } else {
            // Looked up across every table when the relation is untyped, as `add` does — otherwise
            // removing from an untyped relation left the child's key behind.
            const targetRow = relation.target
              ? tableOf(dataset, relation.target).find((r) => r.id === relatedId)
              : Object.values(dataset.tables)
                  .flatMap((rows) => rows as AnyRow[])
                  .find((r) => r.id === relatedId);
            // Only while the key still points here: a record since listed by another row keeps that one.
            if (targetRow) {
              if (targetRow[relation.foreignKey] === this.id) delete targetRow[relation.foreignKey];
              linkReverse(relation.name, targetRow, this.id as string, false);
            }
            const current = Array.isArray(this[relation.name]) ? (this[relation.name] as unknown[]) : [];
            this[relation.name] = current.filter((id) => id !== relatedId);
            if (row) row[relation.name] = this[relation.name];
          }
          notify(dataset);
        });
      };

      /*
        The whole list at once, in this order — the accessor an *ordered* relation is written through.
        A backend with concurrent writers diffs the list against what it holds and records only what
        moved; here the list simply becomes the row's, since nothing concurrent can happen to an
        in-memory table.
        Without it a consumer that arranges a relation — a board column — had no accessor on this
        backend at all, and the fixtures could only append.
      */
      if (relation.cardinality === 'many') {
        proto[`set${suffix}`] = async function (this: AnyRow, related: unknown[], batch?: string): Promise<void> {
          const dataset = homes.get(this);
          if (!dataset) throw new Error(`${name}.set${suffix}(): this instance was never loaded from a dataset`);
          await writeIn(batch, dataset, async () => {
            const next = (Array.isArray(related) ? related : [])
              .map((entry) => (typeof entry === 'string' ? entry : (entry as AnyRow)?.id))
              .filter((id): id is string => typeof id === 'string' && id.length > 0);
            const current = Array.isArray(this[relation.name]) ? (this[relation.name] as string[]) : [];
            // Setting the list adds what is new and removes what is gone, so it is checked as each.
            if (next.some((id) => !current.includes(id))) await checkRelation(dataset, this, relation.name, 'add');
            if (current.some((id) => !next.includes(id))) await checkRelation(dataset, this, relation.name, 'remove');
            const rowsOf = (id: string): AnyRow | undefined =>
              relation.target
                ? tableOf(dataset, relation.target).find((r) => r.id === id)
                : Object.values(dataset.tables)
                    .flatMap((rows) => rows as AnyRow[])
                    .find((r) => r.id === id);
            for (const id of current) {
              if (next.includes(id)) continue;
              const targetRow = rowsOf(id);
              if (targetRow) {
                if (targetRow[relation.foreignKey] === this.id) delete targetRow[relation.foreignKey];
                linkReverse(relation.name, targetRow, this.id as string, false);
              }
            }
            for (const id of next) {
              const targetRow = rowsOf(id);
              if (targetRow) {
                targetRow[relation.foreignKey] = this.id;
                linkReverse(relation.name, targetRow, this.id as string, true);
              }
            }
            this[relation.name] = next;
            const row = tableOf(dataset, name).find((r) => r.id === this.id);
            if (row) row[relation.name] = next;
            notify(dataset);
          });
        };
      } else {
        /*
          A to-one relation is pointed rather than listed, and AD4M's `@HasOne` offers `set<Name>` for
          it — `space.setBoard(board)`, `space.setRoot(collection)`. Without the same accessor here, a
          store written against that worked on one backend and threw on the other.
        */
        proto[`set${suffix}`] = proto[`add${suffix}`];
      }
    }

    classes[name] = Entity as unknown as EntityClassLike;
  }

  return classes;
}
