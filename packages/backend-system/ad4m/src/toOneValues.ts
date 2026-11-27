/**
 * A to-one relation, on AD4M's model layer: written as one id, and holding one id after the write.
 *
 * The contract says a to-one relation holds one record, written and read as that record's id. The
 * executor already reads one that way: a `hasOne` or `belongsToOne` relation hydrates as a single
 * target, last write winning. What the model layer does not do is hold it that way between a write
 * and the next read. `Ad4mModel` accepts a list for any relation, and plans a one-element list on a
 * to-one as a setter, so `create(…, { node: [id] })` wrote the link and then handed back an instance
 * whose `node` was the list. Inside a batch there is no read until the commit, so that instance, and
 * the batch's staged view of it (`stagedRecords.ts`), was what the rest of the batch saw: a record
 * the same transaction made read its to-one as a list, while the same record read from the
 * perspective read it as an id. Callers wrote `r.node == node || node in r.node` to cover both.
 *
 * So before every save a to-one is made what it will read back as. A record given for one becomes
 * its id. A list is refused, as the in-memory backend refuses one: the contract has one spelling,
 * and a list on a to-one is a caller confusing it with a to-many, which no guess fixes for them.
 *
 * Installed outside the write check, so the check sees the id as well.
 */
import type { Ad4mModel } from '@coasys/ad4m';

const PATCHED = Symbol.for('we.ad4m.toOneValues');

interface RelationMeta {
  kind?: string;
  maxCount?: number;
}

interface Instance {
  _snapshot?: Record<string, unknown> | null;
  [field: string]: unknown;
  constructor: {
    getModelMetadata?: () => { className?: string; relations?: Record<string, RelationMeta> };
  };
}

type Method = (this: Instance, ...args: unknown[]) => unknown;

const isToOne = (meta: RelationMeta) => meta.kind === 'hasOne' || meta.kind === 'belongsToOne' || meta.maxCount === 1;

/** The id a to-one is written as, or `undefined` to leave the value as it is. */
export function toOneValue(entity: string, relation: string, value: unknown): string | undefined {
  if (Array.isArray(value)) {
    throw new Error(
      `${entity}.${relation} is a to-one relation: write the one record's id, not a list (a list is a to-many's value)`,
    );
  }
  if (value && typeof value === 'object' && !('action' in value)) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === 'string' && id) return id;
  }
  return undefined;
}

// Workaround for ad4m-issue:to-one-held-as-list. Delete this file once a pin of `@coasys/ad4m`
// holds a to-one as its id after a write: `tests/live/toOneHeldAsList.live.ts` fails then.
/** Install on `Ad4mModel.prototype.save`. Idempotent. */
export function installToOneValues(model: typeof Ad4mModel): void {
  const prototype = model.prototype as unknown as Record<string | symbol, unknown>;
  if (prototype[PATCHED]) return;
  const save = prototype.save as Method | undefined;
  if (typeof save !== 'function') return;

  prototype.save = function withToOneValues(this: Instance, ...args: unknown[]) {
    const metadata = this.constructor.getModelMetadata?.();
    for (const [relation, meta] of Object.entries(metadata?.relations ?? {})) {
      if (!isToOne(meta)) continue;
      const value = this[relation];
      // A hydrated record left as it was read is not a write, so it is left for the snapshot to match.
      if (this._snapshot && this._snapshot[relation] === value) continue;
      const id = toOneValue(metadata?.className ?? 'entity', relation, value);
      if (id !== undefined) this[relation] = id;
    }
    return save.apply(this, args);
  };
  prototype[PATCHED] = true;
}
