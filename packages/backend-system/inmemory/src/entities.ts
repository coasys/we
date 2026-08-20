/**
 * Entities over plain rows — the in-memory half of what a declared manifest means.
 *
 * The AD4M adapter compiles a manifest into decorated model classes that write triples against
 * minted predicates. This compiles the *same manifest* into classes that write objects into
 * arrays, and the difference is invisible to a caller: `Space.findAll(dataset, { where, include })`,
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
import type { IncludeExtras, IncludeOf, ModelInstance, ModelStatic, TypedModelQuery } from '@we/backend-shared';
import {
  compileQuery,
  type EntitySchema,
  executeQueryIR,
  type InMemoryDataset,
  type InMemoryRelation,
  type ModelManifest,
  type Row,
} from '@we/backend-shared';

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

/** Writes notify per dataset, so a live query re-runs exactly when its dataset changed. */
const listeners = new WeakMap<object, Set<() => void>>();

function notify(dataset: DatasetEntry): void {
  for (const listener of listeners.get(dataset) ?? []) listener();
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
export type InMemoryInstance = ModelInstance & Record<string, unknown>;

/**
 * A query as this backend takes it: the contract's typed shape, or the untyped record a dynamic
 * caller (the schema renderer, a space-defined entity) passes. The union rather than only the
 * record because `TypedModelQuery` is an interface — it carries no implicit index signature, so it
 * is not assignable *to* a record type, and the contract's callers must be accepted as they come.
 */
type AnyQuery = Record<string, unknown> | TypedModelQuery<ModelInstance>;

export interface EntityClassLike {
  new (): Record<string, unknown>;
  entityName: string;
  findAll<Q extends TypedModelQuery<ModelInstance>>(
    dataset: unknown,
    query?: Q | AnyQuery,
  ): Promise<(InMemoryInstance & IncludeExtras<ModelInstance, IncludeOf<Q>>)[]>;
  findOne<Q extends TypedModelQuery<ModelInstance>>(
    dataset: unknown,
    query?: Q | AnyQuery,
  ): Promise<(InMemoryInstance & IncludeExtras<ModelInstance, IncludeOf<Q>>) | null>;
  create(dataset: unknown, data?: Record<string, unknown>): Promise<InMemoryInstance>;
  update(dataset: unknown, id: string, data: Record<string, unknown>): Promise<InMemoryInstance | null>;
  delete(dataset: unknown, id: string): Promise<unknown>;
  count(dataset: unknown, query?: AnyQuery): Promise<number>;
  query(
    dataset: unknown,
    q?: Record<string, unknown>,
  ): { subscribe(cb: (rows: unknown[]) => void): Promise<unknown[]>; dispose(): void };
}

/**
 * The contract, checked: this backend's compiled entities present the same static surface the
 * entity proxies are typed as — which is what makes it a second *conforming* implementation
 * rather than a lookalike. (The AD4M lane cannot make this assertion structurally — its statics
 * are `this`-polymorphic — so this is also the one place the contract is compiler-verified
 * end to end.)
 */
type Satisfies<A extends B, B> = A;
export type AssertEntityClassSatisfiesContract = Satisfies<EntityClassLike, ModelStatic<ModelInstance>>;

/**
 * Compile a manifest into entity classes backed by in-memory rows.
 *
 * Predicates are ignored on purpose: they are how *this* storage model identifies a field, and a
 * table-shaped backend identifies it by column name. A manifest that only made sense as triples
 * would not be a declaration, it would be a dialect.
 */
export function compileEntities(manifest: ModelManifest, runtime: EntityRuntime): Record<string, EntityClassLike> {
  const classes: Record<string, EntityClassLike> = {};

  /** Everything an entity declares, including whatever it inherits. */
  const resolved = (name: string): EntitySchema => {
    const entity = manifest.entities[name];
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
      // The cost is that an `include` over an untyped relation now resolves to `[]` rather than
      // being absent. That case is already documented as unsupported (a relation with no declared
      // target cannot say which table to read), and both spellings render as nothing.
      engineRelations[name][relName] = {
        target: info.target,
        cardinality,
        foreignKey: info.foreignKey,
      } satisfies InMemoryRelation;
    }
    relationsByEntity[name] = infos;
  }

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

    /** Declared starting values — the manifest's `default`, and nothing invented on top. */
    const defaults = (): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [prop, spec] of Object.entries(entity.properties)) {
        if (spec.default !== undefined) out[prop] = spec.default;
      }
      for (const relation of relations) if (relation.cardinality === 'many') out[relation.name] = [];
      return out;
    };

    /** Instances remember where they came from, so `save()` and `delete()` need no argument. */
    const homes = new WeakMap<object, DatasetEntry>();

    class Entity {
      static entityName = name;

      constructor() {
        Object.assign(this, defaults());
      }

      /** Copy the persisted columns back over the row this instance came from. */
      async save(): Promise<void> {
        const dataset = homes.get(this);
        if (!dataset) throw new Error(`${name}.save(): this instance was never loaded from a dataset`);
        const row = tableOf(dataset, name).find((r) => r.id === (this as unknown as AnyRow).id);
        if (!row) throw new Error(`${name}.save(): row ${(this as unknown as AnyRow).id} no longer exists`);
        for (const [key, value] of Object.entries(this as unknown as Record<string, unknown>)) {
          if (typeof value === 'function' || key.startsWith('$')) continue;
          row[key] = value;
        }
        notify(dataset);
      }

      async delete(): Promise<void> {
        const dataset = homes.get(this);
        if (!dataset) throw new Error(`${name}.delete(): this instance was never loaded from a dataset`);
        const rows = tableOf(dataset, name);
        const index = rows.findIndex((r) => r.id === (this as unknown as AnyRow).id);
        if (index >= 0) rows.splice(index, 1);
        notify(dataset);
      }

      static hydrate(dataset: DatasetEntry, row: AnyRow): Entity {
        const instance = new Entity() as Entity & Record<string, unknown>;
        homes.set(instance, dataset);
        for (const [key, value] of Object.entries(row)) {
          if (key.startsWith('__')) continue;
          const relation = relations.find((r) => r.name === key);
          const target = relation?.target ? classes[relation.target] : undefined;
          // A hydrated relation comes back as rows; give the caller instances, so a related
          // model behaves like one rather than like a plain object that happens to have fields.
          if (relation && target && value && typeof value === 'object') {
            const asEntity = target as unknown as typeof Entity;
            instance[key] = Array.isArray(value)
              ? value.map((r) => asEntity.hydrate(dataset, r as AnyRow))
              : asEntity.hydrate(dataset, value as AnyRow);
            continue;
          }
          instance[key] = value;
        }
        return instance;
      }

      static rowsFor(dataset: DatasetEntry, query: Record<string, unknown> = {}): AnyRow[] {
        const { where, order, limit, offset, include, scope, ...rest } = query;
        void rest;
        const { ir, unsupported } = compileQuery({
          entity: name,
          ...(where ? { where: where as Record<string, unknown> } : {}),
          ...(normalizeOrder(order) ? { order: normalizeOrder(order) } : {}),
          ...(typeof limit === 'number' ? { limit } : {}),
          ...(typeof offset === 'number' ? { offset } : {}),
          ...(include ? { include: include as Record<string, unknown> } : {}),
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
        return executeQueryIR(ir, data) as AnyRow[];
      }

      static async findAll(handle: unknown, query: Record<string, unknown> = {}): Promise<Entity[]> {
        const dataset = datasetOf(handle);
        return Entity.rowsFor(dataset, query).map((row) => Entity.hydrate(dataset, row));
      }

      static async findOne(handle: unknown, query: Record<string, unknown> = {}): Promise<Entity | null> {
        const found = await Entity.findAll(handle, { ...query, limit: 1 });
        return found[0] ?? null;
      }

      static async create(handle: unknown, data: Record<string, unknown> = {}): Promise<Entity> {
        const dataset = datasetOf(handle);
        const now = new Date().toISOString();
        const row: AnyRow = {
          id: (data.id as string) ?? crypto.randomUUID(),
          author: runtime.selfId() ?? '',
          timestamp: now,
          createdAt: now,
          updatedAt: now,
          ...defaults(),
        };
        for (const [key, value] of Object.entries(data)) {
          if (relationNames.has(key)) continue;
          row[key] = value;
        }
        tableOf(dataset, name).push(row);
        notify(dataset);
        return Entity.hydrate(dataset, row);
      }

      static async update(handle: unknown, id: string, data: Record<string, unknown>): Promise<Entity | null> {
        const dataset = datasetOf(handle);
        const row = tableOf(dataset, name).find((r) => r.id === id);
        if (!row) return null;
        for (const [key, value] of Object.entries(data)) {
          if (relationNames.has(key)) continue;
          row[key] = value;
        }
        row.updatedAt = new Date().toISOString();
        notify(dataset);
        return Entity.hydrate(dataset, row);
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
        if (index >= 0) rows.splice(index, 1);
        notify(dataset);
      }

      static async count(handle: unknown, query: Record<string, unknown> = {}): Promise<number> {
        return (await Entity.findAll(handle, query)).length;
      }

      /**
       * A live query: the callback fires once with current results, then on every write to this
       * dataset. Push semantics, matching the lifecycle port's change handlers.
       */
      static query(handle: unknown, q: Record<string, unknown> = {}) {
        const dataset = datasetOf(handle);
        let stop: (() => void) | undefined;
        return {
          async subscribe(callback: (rows: unknown[]) => void) {
            const run = () => {
              const rows = Entity.rowsFor(dataset, q).map((row) => Entity.hydrate(dataset, row));
              callback(rows);
              return rows;
            };
            stop = watch(dataset, () => void run());
            return run();
          },
          dispose() {
            stop?.();
            stop = undefined;
          },
        };
      }
    }

    Object.defineProperty(Entity, 'name', { value: name });

    // Relation helpers, named after the relation the way the ORM names them: `screenshots` →
    // `addScreenshots` / `getScreenshots` / `removeScreenshots`.
    for (const relation of relations) {
      const suffix = relation.name.charAt(0).toUpperCase() + relation.name.slice(1);
      const proto = Entity.prototype as unknown as Record<string, unknown>;

      proto[`add${suffix}`] = async function (this: AnyRow, related: unknown): Promise<void> {
        const dataset = homes.get(this);
        if (!dataset) throw new Error(`${name}.add${suffix}(): this instance was never loaded from a dataset`);
        const relatedId = typeof related === 'string' ? related : (related as AnyRow)?.id;
        if (!relatedId) throw new Error(`${name}.add${suffix}(): expected a related instance or its id`);

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
          if (targetRow) targetRow[relation.foreignKey] = this.id;
          const current = Array.isArray(this[relation.name]) ? (this[relation.name] as unknown[]) : [];
          if (!current.includes(relatedId)) this[relation.name] = [...current, relatedId];
          const row = tableOf(dataset, name).find((r) => r.id === this.id);
          if (row) row[relation.name] = this[relation.name];
        }
        notify(dataset);
      };

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

      proto[`remove${suffix}`] = async function (this: AnyRow, related: unknown): Promise<void> {
        const dataset = homes.get(this);
        if (!dataset) return;
        const relatedId = typeof related === 'string' ? related : (related as AnyRow)?.id;
        const row = tableOf(dataset, name).find((r) => r.id === this.id);

        if (relation.cardinality === 'one') {
          if (row) row[relation.foreignKey] = '';
          this[relation.name] = '';
        } else {
          const targetRow = relation.target
            ? tableOf(dataset, relation.target).find((r) => r.id === relatedId)
            : undefined;
          if (targetRow) delete targetRow[relation.foreignKey];
          const current = Array.isArray(this[relation.name]) ? (this[relation.name] as unknown[]) : [];
          this[relation.name] = current.filter((id) => id !== relatedId);
          if (row) row[relation.name] = this[relation.name];
        }
        notify(dataset);
      };
    }

    classes[name] = Entity as unknown as EntityClassLike;
  }

  return classes;
}
