/**
 * Running an operation without writing: the same runner over a view of the dataset that reads the
 * committed rows with this agent's pending predictions laid over them, and records each write
 * instead of making it.
 *
 * What a host draws before the real run lands. Given the invocation id and time the real run will
 * use, the records it predicts have the ids the real ones will (`ids.ts`), so when the real rows
 * arrive they replace the prediction exactly. A speculation that fails — statically, on a
 * precondition, or on the write check, which it asks as the real run would — predicts nothing, so a
 * press that will be refused is never drawn as having worked.
 *
 * A step's reads see what the real run's would plus what is pending: the predictions of earlier
 * invocations still on their way. Not its own writes, as in the real run (see `run.ts`). So a second
 * press of a control, made before the first has landed, is predicted from the first one's answer.
 *
 * And they are answered, where they can be, from the rows this host's live reads already hold
 * (`predictions/held.ts`) rather than from the backend: a read that waits on a round trip draws the
 * prediction a round trip after the gesture, which is the delay drawing it exists to remove. Only a
 * read nothing on screen holds goes to the backend, and then the prediction waits for it.
 */
import { checkEntityWrite, getEntityForDataset } from '../entityRegistry';
import { CORE_MANIFEST } from '../manifest';
import { heldAnswer } from '../predictions/held';
import { withPredictedRows } from '../predictions/live';
import { readShapeOf } from '../predictions/overlay';
import type { PredictedWrite } from '../predictions/registry';
import { type OperationView, runOperation, type RunOperationOptions } from './run';

/** What a speculative run predicts. */
export interface Speculation {
  /** What the operation would answer with. */
  result: unknown;
  /** Every write it would make, in order. */
  writes: PredictedWrite[];
}

type Row = Record<string, unknown> & { id: string };

/**
 * Fields as a read gives them back. A file the record stores is written as its bytes and read, where
 * its property says so (`readAs: 'dataUri'`), as a data URI — so a predicted picture is drawn as the
 * picture, as the record will read once the write lands, rather than as the bytes it was written with.
 */
function asRead(entity: string, fields: Record<string, unknown>): Record<string, unknown> {
  const properties = CORE_MANIFEST.entities[entity]?.properties;
  if (!properties) return fields;
  const out = { ...fields };
  for (const [key, value] of Object.entries(fields)) {
    const file = value as { data_base64?: unknown; file_type?: unknown } | null;
    if (properties[key]?.readAs !== 'dataUri' || !file || typeof file.data_base64 !== 'string') continue;
    out[key] =
      `data:${typeof file.file_type === 'string' ? file.file_type : 'application/octet-stream'};base64,${file.data_base64}`;
  }
  return out;
}

interface Reads {
  findAll(dataset: unknown, query?: Record<string, unknown>): Promise<Row[]>;
}

/** A read a speculation had to send to the backend, because nothing this host holds answered it. */
export interface SpeculationMiss {
  operation: string;
  entity: string;
  query: Record<string, unknown> | undefined;
}

let missed: ((miss: SpeculationMiss) => void) | null = null;

/**
 * Be told of every read a speculation sends past the held rows, or stop being told (`null`).
 *
 * Off unless a host turns it on, so production and tests are silent. It is how to see whether the
 * three cases `heldAnswer` answers cover the gestures that matter: a gesture whose prediction waits a
 * round trip shows up here, with the read that made it wait.
 */
export function onSpeculationMiss(listener: ((miss: SpeculationMiss) => void) | null): void {
  missed = listener;
}

/**
 * Run `name` as `runOperation` would, writing nothing. `invocationId` and `invokedAt` are required:
 * a prediction is only worth drawing if the real run will make the same ids.
 */
export async function speculateOperation(
  name: string,
  args: Record<string, unknown> | undefined,
  options: RunOperationOptions & { invocationId: string; invokedAt: string },
): Promise<Speculation> {
  const writes: PredictedWrite[] = [];
  const { dataset, invoker } = options;

  /** A record as a step holds it: its fields, and a save and delete that record what they would do. */
  const instance = (entity: string, row: Row, made: boolean): Row => {
    const seen: Record<string, unknown> = { ...row };
    const record = { ...row } as Row;
    Object.defineProperties(record, {
      save: {
        enumerable: false,
        value: async () => {
          const fields: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(record)) if (seen[key] !== value) fields[key] = value;
          if (!Object.keys(fields).length) return;
          await checkEntityWrite({
            dataset,
            entity,
            kind: 'edit',
            id: row.id,
            data: fields,
            record: () => (made ? { ...seen, author: invoker } : seen),
          });
          Object.assign(seen, fields);
          writes.push({ kind: 'edit', entity, id: row.id, fields: asRead(entity, fields) });
        },
      },
      delete: {
        enumerable: false,
        value: async () => {
          await checkEntityWrite({ dataset, entity, kind: 'delete', id: row.id, record: () => seen });
          writes.push({ kind: 'delete', entity, id: row.id });
        },
      },
    });
    return record;
  };

  const statics = (entity: string, real: Reads) => {
    const findAll = async (ds: unknown, query?: Record<string, unknown>) => {
      // What the screen holds first, predictions in it already; the backend only for what it does not.
      const held = heldAnswer(entity, ds, query);
      if (!held) missed?.({ operation: name, entity, query });
      const rows = held ?? withPredictedRows(await real.findAll(ds, query), ds, readShapeOf([entity], query));
      return rows.map((row) => instance(entity, row, false));
    };
    const relation = async (kind: 'add' | 'remove', id: string, relation: string) =>
      checkEntityWrite({ dataset, entity, kind, id, relation, record: () => null });
    return {
      findAll,
      findOne: async (ds: unknown, query?: Record<string, unknown>) =>
        (await findAll(ds, { ...query, limit: 1 }))[0] ?? null,
      create: async (_ds: unknown, data: Record<string, unknown>, opts?: Record<string, unknown>) => {
        await checkEntityWrite({ dataset, entity, kind: 'create', data, record: () => null });
        const id = opts?.id as string;
        const parent = opts?.parent as { id: string; relation: string; entity?: string } | undefined;
        // Stamped as the backend stamps them, so a read whose where names the author finds it.
        const fields = { ...data, author: invoker, createdAt: options.invokedAt };
        writes.push({ kind: 'create', entity, id, fields: asRead(entity, fields), ...(parent ? { parent } : {}) });
        return instance(entity, { ...fields, id }, true);
      },
      addRelation: async (_ds: unknown, id: string, rel: string, target: string) => {
        await relation('add', id, rel);
        writes.push({ kind: 'add', entity, id, relation: rel, target });
      },
      removeRelation: async (_ds: unknown, id: string, rel: string, target: string) => {
        await relation('remove', id, rel);
        writes.push({ kind: 'remove', entity, id, relation: rel, target });
      },
      setRelation: async (_ds: unknown, id: string, rel: string, targets: readonly string[]) => {
        await relation('add', id, rel);
        writes.push({ kind: 'set', entity, id, relation: rel, targets: [...targets] });
      },
    };
  };

  const made = new Map<string, unknown>();
  const view: OperationView = {
    entity: (entity, ds) => {
      if (made.has(entity)) return made.get(entity);
      const real = getEntityForDataset(entity, ds) as unknown as Reads | undefined;
      const viewed = real ? statics(entity, real) : undefined;
      made.set(entity, viewed);
      return viewed;
    },
    // Nothing is written, so there is nothing to group.
    transaction: (_ds, fn) => fn({}),
  };

  const result = await runOperation(name, args, { ...options, view });
  return { result, writes };
}
