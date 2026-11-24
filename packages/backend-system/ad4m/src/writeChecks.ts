/**
 * Ask the host's write check before every record write, on AD4M.
 *
 * `@we/entities` holds one check the host registers (`registerEntityWriteCheck`), and a backend asks
 * it from wherever it actually writes. On AD4M that is five methods of `Ad4mModel`, and every write
 * WE makes goes through one of them:
 *
 * - `save()` — a create when the instance has never been read (no snapshot), an edit when it has.
 *   The static `create` and `update` both end in it.
 * - `delete()` — and the static `delete`, which builds an instance and calls it.
 * - `addRelationValue`, `removeRelationValue` and `setRelationValues` — which every generated
 *   `add<Relation>` / `remove<Relation>` / `set<Relation>` accessor delegates to, and which the
 *   contract's relation writes (`relationWrites.ts`) reach through those accessors.
 *
 * Installed on the base class because the model classes are
 * generated, compiled from a manifest at runtime, or built from foreign SHACL, and they all extend
 * `Ad4mModel`, so one patch covers every class including those that do not exist yet.
 *
 * ## The writes a save makes for itself
 *
 * A save writes the record's relations too, through `setRelationValues`. Those are part of the
 * create or edit that was just checked, so they are not checked again: a reply created with its
 * parent named is one create, not a create and a relation write. The parent link a `create(…,
 * { parent })` writes goes around these methods altogether, and is likewise part of the create.
 *
 * ## What a check is told about the record
 *
 * Lazily, since most checks never ask. Inside a batch, a record the batch has created, edited or
 * deleted is the record as the batch has staged it — with the writer as the author of one it
 * created — because no read can see it yet and the contract says a check judges the transaction's
 * own writes (`stagedRecords.ts`). Otherwise an instance that has been read already holds it — its
 * snapshot is the record as it stood, and `author` comes with every read — and one that has not,
 * the instance the static `delete` builds from an id, reads it when asked.
 *
 * Installed after `installStagedRecords`, so it wraps outside it: the check runs before the batch's
 * view takes in the write being judged.
 */
import type { Ad4mModel } from '@coasys/ad4m';
import { checkEntityWrite, type WrittenRecord } from '@we/entities';

import { fieldsOf, stagedRecord } from './stagedRecords';

const PATCHED = Symbol.for('we.ad4m.writeChecks');
/** Set on an instance while its own `save()` runs, so the relation writes inside it pass unchecked. */
const SAVING = Symbol.for('we.ad4m.writeChecks.saving');

interface ModelInternals {
  id?: string;
  author?: string;
  _perspective?: unknown;
  _snapshot?: Record<string, unknown>;
  changedFields?: () => string[];
  [SAVING]?: boolean;
  constructor: {
    getModelMetadata?: () => { className?: string };
    findOne?: (perspective: unknown, query: { where: { id: string } }) => Promise<ModelInternals | null>;
  };
}

type Method = (this: ModelInternals, ...args: unknown[]) => Promise<unknown>;

const entityOf = (model: ModelInternals) => model.constructor.getModelMetadata?.().className ?? 'entity';

/**
 * The record as it stands for a write in `batch`: as the batch has staged it when the batch made,
 * edited or deleted it (`stagedRecords.ts`), otherwise the snapshot of an instance that was read,
 * or a read for one that was not.
 */
function recordOf(model: ModelInternals, batch: unknown): () => Promise<WrittenRecord | null> {
  // Taken now, not when asked: a check that reads it after the write has begun must still see the
  // record as it stood.
  const staged = stagedRecord(batch, model.id);
  const snapshot = model._snapshot ? { ...model._snapshot, id: model.id, author: model.author } : null;
  return async () => {
    if (staged && 'record' in staged) return staged.record;
    const committed = snapshot ?? (await readRecord(model));
    return committed && staged ? { ...committed, ...staged.changes } : committed;
  };
}

async function readRecord(model: ModelInternals): Promise<WrittenRecord | null> {
  if (!model.id || !model.constructor.findOne) return null;
  const found = await model.constructor.findOne(model._perspective, { where: { id: model.id } });
  return found ? { ...fieldsOf(found), id: found.id, author: found.author } : null;
}

function relationCheck(model: ModelInternals, kind: 'add' | 'remove', relation: string, batch: unknown) {
  return checkEntityWrite({
    dataset: model._perspective,
    entity: entityOf(model),
    kind,
    id: model.id,
    relation,
    record: recordOf(model, batch),
  });
}

const idsOf = (value: unknown): string[] =>
  (Array.isArray(value) ? value : value == null ? [] : [value]).map((v) => {
    if (typeof v === 'string') return v;
    const id = (v as { id?: unknown })?.id;
    return typeof id === 'string' ? id : '';
  });

/**
 * Install the checks on `Ad4mModel.prototype`. Idempotent.
 *
 * Called once when the adapter builds its ports, beside `installRelationWrites`.
 */
export function installWriteChecks(model: typeof Ad4mModel): void {
  const prototype = model.prototype as unknown as Record<string | symbol, unknown>;
  if (prototype[PATCHED]) return;

  const wrap = (name: string, before: (self: ModelInternals, args: unknown[]) => Promise<void> | void) => {
    const original = prototype[name] as Method | undefined;
    if (typeof original !== 'function') return;
    prototype[name] = async function checked(this: ModelInternals, ...args: unknown[]) {
      await before(this, args);
      return original.apply(this, args);
    };
  };

  const save = prototype.save as Method | undefined;
  if (typeof save === 'function') {
    prototype.save = async function checked(this: ModelInternals, ...args: unknown[]) {
      if (this[SAVING]) return save.apply(this, args);
      if (!this._snapshot) {
        await checkEntityWrite({
          dataset: this._perspective,
          entity: entityOf(this),
          kind: 'create',
          data: fieldsOf(this),
          record: () => null,
        });
      } else {
        const changed = this.changedFields?.() ?? [];
        if (changed.length) {
          const data = Object.fromEntries(changed.map((key) => [key, (this as Record<string, unknown>)[key]]));
          await checkEntityWrite({
            dataset: this._perspective,
            entity: entityOf(this),
            kind: 'edit',
            id: this.id,
            data,
            record: recordOf(this, args[0]),
          });
        }
      }
      this[SAVING] = true;
      try {
        return await save.apply(this, args);
      } finally {
        this[SAVING] = false;
      }
    };
  }

  wrap('delete', (self, [batch]) =>
    checkEntityWrite({
      dataset: self._perspective,
      entity: entityOf(self),
      kind: 'delete',
      id: self.id,
      record: recordOf(self, batch),
    }),
  );

  wrap('addRelationValue', (self, [key, , batch]) =>
    self[SAVING] ? undefined : relationCheck(self, 'add', String(key), batch),
  );
  wrap('removeRelationValue', (self, [key, , batch]) =>
    self[SAVING] ? undefined : relationCheck(self, 'remove', String(key), batch),
  );
  // Setting a list adds what is new and removes what is gone. Without a snapshot to diff against,
  // it may do either, so it is checked as both.
  wrap('setRelationValues', async (self, [key, value, batch]) => {
    if (self[SAVING]) return;
    const relation = String(key);
    const next = idsOf(value);
    const current = self._snapshot && relation in self._snapshot ? idsOf(self._snapshot[relation]) : null;
    if (!current || next.some((id) => !current.includes(id))) await relationCheck(self, 'add', relation, batch);
    if (!current || current.some((id) => !next.includes(id))) await relationCheck(self, 'remove', relation, batch);
  });

  prototype[PATCHED] = true;
}
