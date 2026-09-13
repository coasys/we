/**
 * The contract's relation writes, on AD4M.
 *
 * `EntityStatic.setRelation` / `addRelation` / `removeRelation` say what a relation write means
 * without saying how one is performed; this is how AD4M performs one. The work itself is already
 * there — `@HasMany` generates `setChildren` / `addChildren` / `removeChildren` on the prototype, and
 * every one of them delegates to the same three generic methods — so this is a lookup and a call,
 * not a second implementation of writing a link.
 *
 * ## Why it installs on the base class
 *
 * Exactly the reasoning in `clearOnEmpty.ts`, which does the same thing one layer down: the model
 * classes are generated from the manifest, compiled from a manifest at runtime, or built from
 * foreign SHACL, and they all extend `Ad4mModel`. Installing here covers all three, **including
 * classes that do not exist yet** — a community defines a shape this afternoon and its relations are
 * writable through the contract with nothing further registered.
 *
 * The alternative was attaching the statics at each `registerEntity` call, of which there are three
 * in this package and no guarantee there will not be a fourth.
 *
 * ## Why it calls the named accessors rather than the generic methods behind them
 *
 * `addRelationValue` / `removeRelationValue` / `setRelationValues` are declared private. They are
 * reachable at runtime, and this package already reaches into AD4M internals where it must (see
 * `clearOnEmpty`'s `_perspective` / `_snapshot`), but there is no *need* here: the named accessors
 * are public API, they are what every existing call site in WE uses, and the name is derived the
 * same way AD4M derives it. Reaching past a public method that does the job would be borrowing a
 * maintenance risk for nothing.
 *
 * A relation declared without a `through` predicate — a getter-only relation — has no accessors at
 * all, and is read-only by construction. That is reported rather than silently skipped.
 *
 * ## The trap this file fell into once
 *
 * Everything here works off the **loaded record**, never off the class, and that is not an
 * incidental choice — see {@link accessorFor}. A call site holds the entity stand-in from
 * `@we/entities`, which forwards operations and cannot forward identity, so any class-level metadata
 * read through it answers for the wrong class. Nothing in the type system says so.
 */
import type { Ad4mModel } from '@coasys/ad4m';

/** Marker so a second call is a no-op — the adapter can be initialised more than once per process. */
const PATCHED = Symbol.for('we.ad4m.relationWrites');

type RelationAccessor = (arg: unknown, batchId?: string) => Promise<unknown>;

interface ModelStatic {
  findOne(dataset: unknown, query: { where: { id: string } }): Promise<Record<string, unknown> | null>;
}

const accessorName = (verb: string, relation: string) =>
  `${verb}${relation.charAt(0).toUpperCase()}${relation.slice(1)}`;

/**
 * The relations this record can actually be written through, read off the instance.
 *
 * Only for the error message, and only built when there is about to be one — it walks a prototype
 * chain, which is not something a write path should do on the way to succeeding.
 */
function writableRelations(record: object): string[] {
  const names = new Set<string>();
  for (let level = Object.getPrototypeOf(record); level && level !== Object.prototype;) {
    for (const key of Object.getOwnPropertyNames(level)) {
      const match = /^set([A-Z].*)$/.exec(key);
      if (match) names.add(match[1].charAt(0).toLowerCase() + match[1].slice(1));
    }
    level = Object.getPrototypeOf(level);
  }
  return [...names].sort();
}

/**
 * Load the record and hand back the accessor for this write, or explain why there is not one.
 *
 * ## Why it asks the record and never the class
 *
 * `CollectionBlock` at a call site is the **stand-in** from `@we/entities`, not the AD4M class, and
 * a proxy forwards operations but cannot forward identity — which `entityProxy.ts` says in as many
 * words, naming AD4M's decorator metadata as the thing that breaks. `getModelMetadata()` is exactly
 * that: called with `this` bound to the stand-in it finds no registry entry for it, walks up, and
 * answers with the *base* class's relations. So `CollectionBlock` reported that it declares
 * `comments, signals, participants, calls, mentions` — `WeNode`'s, every one — and refused every
 * board write as being for a relation that does not exist.
 *
 * A loaded record has no such problem: it is a real instance of the real class, its prototype chain
 * is the real one, and the generated accessors are on it. So the accessor's *presence* is the test,
 * which also collapses two questions into one — a relation that does not exist and a getter-only
 * relation with no predicate both arrive here as "no such method", and neither can be written.
 *
 * A record that is not there resolves to `null` rather than throwing: a record deleted between being
 * read and being arranged is the ordinary race, and the caller's intent — "this record's relation
 * should read like that" — is satisfied by there being no such record.
 */
async function accessorFor(
  entity: ModelStatic,
  dataset: unknown,
  id: string,
  relation: string,
  verb: 'set' | 'add' | 'remove',
  batch?: string,
): Promise<{ record: Record<string, unknown>; call: RelationAccessor } | null> {
  const record = await entity.findOne(dataset, { where: { id } });
  if (!record) {
    /*
      Said out loud when there is a batch, because then the ordinary race is not the likely reason.

      The executor stages a batch's writes out of every read until it commits, so a record created
      earlier in the same batch is not there to be found — and this write does nothing. That is how
      every board came to be made with no columns: its columns were written by id onto a board the
      same transaction had just created. Nothing failed and nothing was logged. Still not a throw,
      since a record deleted mid-batch is as ordinary as one deleted outside one.
    */
    if (batch) {
      console.warn(
        `${verb}Relation("${relation}"): no record "${id}" is visible, so nothing was written. A record ` +
          'created in this same batch cannot be read until it commits — write the relation at creation instead.',
      );
    }
    return null;
  }

  const call = record[accessorName(verb, relation)] as RelationAccessor | undefined;
  if (typeof call !== 'function') {
    const className = (record.constructor as { name?: string })?.name ?? 'entity';
    throw new Error(
      `${className}.${verb}Relation(): "${relation}" cannot be written on ${className} — it is not a ` +
        'relation, or it is a getter-only one, which is derived rather than stored. ' +
        `Writable relations: ${writableRelations(record).join(', ') || '(none)'}.`,
    );
  }
  return { record, call };
}

/**
 * Install the relation writes on `Ad4mModel`. Idempotent.
 *
 * Called once when the adapter builds its ports, beside `installClearOnEmpty`.
 */
export function installRelationWrites(model: typeof Ad4mModel): void {
  const statics = model as unknown as Record<string | symbol, unknown>;
  if (statics[PATCHED]) return;

  statics.setRelation = async function (
    this: ModelStatic,
    dataset: unknown,
    id: string,
    relation: string,
    targetIds: readonly string[],
    batch?: string,
  ): Promise<void> {
    const found = await accessorFor(this, dataset, id, relation, 'set', batch);
    // The whole list, in order, handed over for the backend to diff. The executor records only what
    // moved and merges concurrent writes, which is why sending everything is cheap and why nothing
    // here indexes or breaks a tie.
    if (found) await found.call.call(found.record, [...targetIds], batch);
  };

  statics.addRelation = async function (
    this: ModelStatic,
    dataset: unknown,
    id: string,
    relation: string,
    targetId: string,
    batch?: string,
  ): Promise<void> {
    const found = await accessorFor(this, dataset, id, relation, 'add', batch);
    if (found) await found.call.call(found.record, targetId, batch);
  };

  statics.removeRelation = async function (
    this: ModelStatic,
    dataset: unknown,
    id: string,
    relation: string,
    targetId: string,
    batch?: string,
  ): Promise<void> {
    const found = await accessorFor(this, dataset, id, relation, 'remove', batch);
    if (found) await found.call.call(found.record, targetId, batch);
  };

  statics[PATCHED] = true;
}
