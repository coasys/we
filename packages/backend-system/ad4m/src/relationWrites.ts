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
 */
import type { Ad4mModel } from '@coasys/ad4m';

/** Marker so a second call is a no-op — the adapter can be initialised more than once per process. */
const PATCHED = Symbol.for('we.ad4m.relationWrites');

type RelationAccessor = (arg: unknown, batchId?: string) => Promise<unknown>;

interface ModelStatic {
  findOne(dataset: unknown, query: { where: { id: string } }): Promise<Record<string, unknown> | null>;
  getModelMetadata?: () => { className?: string; relations?: Record<string, unknown> };
}

const accessorName = (verb: string, relation: string) =>
  `${verb}${relation.charAt(0).toUpperCase()}${relation.slice(1)}`;

/**
 * Load the record and hand back the accessor for this write, or explain why there is not one.
 *
 * A record that is not there resolves to `null` rather than throwing: a record deleted between being
 * read and being arranged is the ordinary race, and the caller's intent — "this record's relation
 * should read like that" — is satisfied by there being no such record. A relation that does not
 * exist, or cannot be written, is a mistake in the calling code and says so.
 */
async function accessorFor(
  entity: ModelStatic,
  dataset: unknown,
  id: string,
  relation: string,
  verb: 'set' | 'add' | 'remove',
): Promise<{ record: Record<string, unknown>; call: RelationAccessor } | null> {
  const className = entity.getModelMetadata?.().className ?? 'entity';
  const declared = entity.getModelMetadata?.().relations ?? {};
  if (!(relation in declared)) {
    throw new Error(
      `${className}.${verb}Relation(): "${relation}" is not a relation of ${className}. ` +
        `It declares: ${Object.keys(declared).join(', ') || '(none)'}.`,
    );
  }

  const record = await entity.findOne(dataset, { where: { id } });
  if (!record) return null;

  const call = record[accessorName(verb, relation)] as RelationAccessor | undefined;
  if (typeof call !== 'function') {
    throw new Error(
      `${className}.${verb}Relation(): "${relation}" has no predicate, so it is read-only. ` +
        'A getter-only relation is derived, not stored, and nothing can be written into it.',
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
    const found = await accessorFor(this, dataset, id, relation, 'set');
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
    const found = await accessorFor(this, dataset, id, relation, 'add');
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
    const found = await accessorFor(this, dataset, id, relation, 'remove');
    if (found) await found.call.call(found.record, targetId, batch);
  };

  statics[PATCHED] = true;
}
