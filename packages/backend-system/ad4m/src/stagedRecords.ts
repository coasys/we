/**
 * What each open batch has written, as the batch would leave it — the records no read can see yet.
 *
 * The executor keeps a batch's writes out of every read until it commits. Two things need them
 * before then:
 *
 * - **Relation writes** (`relationWrites.ts`) onto a record the batch created. Such a write needs
 *   the instance the create wrote, which carries the record's id and its class's predicates; a read
 *   would find nothing and the write would do nothing.
 * - **The write check** (`writeChecks.ts`). The contract's rule (`EntityWrite.record` in
 *   `@we/entities`) is that inside a transaction a check is told about the record as the
 *   transaction has staged it. A record created earlier in the batch has no snapshot that names its
 *   author — the SDK fills `author` on a read, and there has been none — so without this a policy
 *   that lets only the author edit refused the second write of every operation that makes a record
 *   and then edits it. An edit staged onto a committed record is overlaid too, so a later check in
 *   the batch judges the fields as they will stand.
 *
 * So each batch keeps one view: per record id, what it created (the fields it was created with, its
 * id, and the writer as its author), what it changed, and whether it deleted it. Filled by `save`
 * and `delete`, installed after the `json` values patch so the fields are values rather than their
 * stored form, and before the write check so a check sees the batch as it stood before the write it
 * is judging. Dropped when the batch's transaction settles, committed or discarded: after a commit
 * the records are read like any other.
 *
 * Relations are not overlaid: a check that depends on what a record links to reads the committed
 * relation, or for a created record what its create named.
 */
import type { Ad4mModel } from '@coasys/ad4m';
import type { WrittenRecord } from '@we/entities';

const PATCHED = Symbol.for('we.ad4m.stagedRecords');
/** Set on an instance while its own `save()` runs, so a save it makes for itself is not staged twice. */
const SAVING = Symbol.for('we.ad4m.stagedRecords.saving');

interface Staged {
  /** The instance the batch created the record through; absent for a committed record it edited. */
  instance?: Record<string, unknown>;
  /** For a created record, every field; for a committed one, only what the batch changed. */
  fields: Record<string, unknown>;
  deleted: boolean;
}

/**
 * Per open batch id, then record id. A batch is open from when its transaction hands out its id
 * until the transaction settles; a write carrying the id of one that has settled is not staged.
 */
const staged = new Map<string, Map<string, Staged>>();

/**
 * Who a batch's writes are made by — the agent the ports were built for. Replaced, not kept, by
 * each install: the patch is process-wide and installed once, while the ports, and the agent they
 * answer for, can be built again (a sign-out and back in).
 */
let writer: () => string | undefined = () => undefined;

interface Instance {
  id?: string;
  _snapshot?: unknown;
  changedFields?: () => string[];
  [SAVING]?: boolean;
  [field: string]: unknown;
}

type Method = (this: Instance, ...args: unknown[]) => Promise<unknown>;
type Transaction = (perspective: unknown, fn: (tx: { batchId: string }) => Promise<unknown>) => Promise<unknown>;

/** The model's own fields: what is set on the instance, without the ORM's bookkeeping. */
export function fieldsOf(model: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(model)) {
    if (key.startsWith('_') || typeof value === 'function' || value === undefined) continue;
    out[key] = value;
  }
  return out;
}

const copied = (fields: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, Array.isArray(value) ? [...(value as unknown[])] : value]),
  );

/** The record's entry in `batch`'s view, or `undefined` when no such batch is open. */
function entryFor(batch: string, id: string): Staged | undefined {
  const records = staged.get(batch);
  if (!records) return undefined;
  let entry = records.get(id);
  if (!entry) records.set(id, (entry = { fields: {}, deleted: false }));
  return entry;
}

/** The instance `batch` created `id` through, while the batch is open and has not deleted it. */
export function stagedInstance(batch: unknown, id: string): Record<string, unknown> | undefined {
  if (typeof batch !== 'string') return undefined;
  const entry = staged.get(batch)?.get(id);
  return entry && !entry.deleted ? entry.instance : undefined;
}

/**
 * What `batch` has done to `id`, copied now: `{ record }` when the batch made the record or
 * deleted it, so the record as the batch leaves it is known whole (`null` once deleted);
 * `{ changes }` for a committed record it has edited, to lay over the committed one; `undefined`
 * when the batch has not touched it, or there is no open batch.
 */
export function stagedRecord(
  batch: unknown,
  id: string | undefined,
): { record: WrittenRecord | null } | { changes: Record<string, unknown> } | undefined {
  if (typeof batch !== 'string' || !id) return undefined;
  const entry = staged.get(batch)?.get(id);
  if (!entry) return undefined;
  if (entry.deleted) return { record: null };
  if (entry.instance) return { record: copied(entry.fields) };
  return { changes: copied(entry.fields) };
}

/**
 * Install the staged view on `Ad4mModel`: `save` and `delete` record what a batch writes, and
 * `transaction` drops a batch's view when it settles. Idempotent; `selfId` replaces the writer on
 * every call.
 */
export function installStagedRecords(model: typeof Ad4mModel, selfId: () => string | undefined): void {
  writer = selfId;
  const prototype = model.prototype as unknown as Record<string | symbol, unknown>;
  if (prototype[PATCHED]) return;

  const save = prototype.save as Method | undefined;
  if (typeof save === 'function') {
    prototype.save = async function staging(this: Instance, ...args: unknown[]) {
      const batch = args[0];
      if (this[SAVING] || typeof batch !== 'string') return save.apply(this, args);
      // A save with no snapshot is a create (an instance that was read has one).
      const creating = !this._snapshot;
      const changes = creating
        ? null
        : Object.fromEntries((this.changedFields?.() ?? []).map((key) => [key, this[key]]));
      this[SAVING] = true;
      try {
        await save.apply(this, args);
      } finally {
        this[SAVING] = false;
      }
      const entry = this.id ? entryFor(batch, this.id) : undefined;
      if (!entry) return;
      if (creating) {
        entry.instance = this;
        entry.fields = { ...copied(fieldsOf(this)), id: this.id, author: writer() };
        entry.deleted = false;
      } else {
        Object.assign(entry.fields, copied(changes ?? {}));
      }
    };
  }

  const remove = prototype.delete as Method | undefined;
  if (typeof remove === 'function') {
    prototype.delete = async function staging(this: Instance, ...args: unknown[]) {
      await remove.apply(this, args);
      const batch = args[0];
      const entry = typeof batch === 'string' && this.id ? entryFor(batch, this.id) : undefined;
      if (entry) entry.deleted = true;
    };
  }

  const statics = model as unknown as Record<string, unknown>;
  const transaction = statics.transaction as Transaction | undefined;
  if (typeof transaction === 'function') {
    statics.transaction = function settled(this: unknown, perspective: unknown, fn: Parameters<Transaction>[1]) {
      let batch: string | undefined;
      return transaction
        .call(this, perspective, (tx) => {
          batch = tx.batchId;
          staged.set(batch, new Map());
          return fn(tx);
        })
        .finally(() => {
          if (batch) staged.delete(batch);
        });
    };
  }

  prototype[PATCHED] = true;
}
