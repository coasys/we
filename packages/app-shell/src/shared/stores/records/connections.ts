/**
 * The record store's connections: the write that makes one, and the dedup key every connection
 * carries.
 *
 * A connection is a record like any other, made, moved and deleted by declared operations
 * (`core.connectRecords`, `core.retargetConnection`, `core.detachConnection`), so the line changes on
 * the gesture as every other write does: the host draws an operation's writes in every read from
 * the moment it is invoked, the canvas's read of its lines included. What is left here is reading the
 * titles a key is made from — from what the screen holds first, so that read puts no round trip in
 * front of the drawing either.
 *
 * The key (`connectionKey`) names both ends by title and carries the label, so it is rewritten whenever
 * any of those changes — here, for every part that changes one.
 */
import { heldRecord } from '../../heldFirst';
import { connectionKey } from '../../kernels/connectionKey';
import type { RecordStore } from '../RecordStore';
import { entityNamed, type RecordContext, RELATIONSHIP } from './context';
import type { RecordKinds } from './kinds';

export interface RecordConnectionsDeps extends RecordContext {
  kinds: Pick<RecordKinds, 'entityClass' | 'titleField'>;
}

/** One end of a connection: a record and its entity name. */
export interface ConnectionEnd {
  id: string;
  type: string;
}

export interface RecordConnections extends Pick<RecordStore, 'rekeyConnection'> {
  /** A connection between two records, as one write (`core.connectRecords`) — answering with its id. */
  connect: (
    handle: unknown,
    ends: { source: string; sourceType?: string; target: string; targetType?: string },
    extra?: { key?: string; kind?: string; fields?: Record<string, unknown>; home?: string },
  ) => Promise<string>;
  /** The key for a connection between two records, as their titles read now — see `connectionKey`. */
  keyFor: (handle: unknown, source: ConnectionEnd, target: ConnectionEnd, label?: unknown) => Promise<string>;
  /** Every connection touching a record, rekeyed — after the record's title changed. Never throws. */
  rekeyConnectionsOf: (handle: unknown, id: string) => Promise<void>;
}

export function createRecordConnections(deps: RecordConnectionsDeps): RecordConnections {
  const { datasetStore, runOp, kinds } = deps;

  async function connect(
    handle: unknown,
    ends: { source: string; sourceType?: string; target: string; targetType?: string },
    extra: { key?: string; kind?: string; fields?: Record<string, unknown>; home?: string } = {},
  ): Promise<string> {
    const id = await runOp<string>('core.connectRecords', { ...ends, ...extra }, handle);
    return String(id ?? '');
  }

  /** What an extraction prompt calls one record, read now — falling back to its id. */
  async function promptTitle(handle: unknown, end: ConnectionEnd): Promise<string> {
    const field = kinds.titleField(end.type);
    if (!field) return end.id;
    try {
      const row = await heldRecord<Record<string, unknown>>(end.type, handle, end.id, () =>
        kinds.entityClass(end.type, handle).findOne(handle, { where: { id: end.id } } as never),
      );
      const value = row?.[field];
      return typeof value === 'string' && value.trim() ? value : end.id;
    } catch {
      return end.id;
    }
  }

  async function keyFor(handle: unknown, source: ConnectionEnd, target: ConnectionEnd, label?: unknown) {
    const [from, to] = await Promise.all([promptTitle(handle, source), promptTitle(handle, target)]);
    return connectionKey(from, to, label);
  }

  /*
    A store action as well as a helper, for the surfaces that save a connection through the generic
    `record.update` rather than through this store — the knowledge map's edge panel — and so cannot
    be followed here. Never throws: a stale key costs a duplicate on the next pass, and a failed save
    is not the place to say so.
  */
  async function rekeyConnection(id: string): Promise<void> {
    const dataset = datasetStore.currentDataset();
    if (!dataset || !id) return;
    try {
      const Model = entityNamed(RELATIONSHIP);
      const row = (await Model.findOne(dataset.handle, { where: { id } } as never)) as Record<string, unknown> | null;
      if (!row || typeof row.source !== 'string' || typeof row.target !== 'string') return;
      const key = await keyFor(
        dataset.handle,
        { id: row.source, type: typeof row.sourceType === 'string' ? row.sourceType : '' },
        { id: row.target, type: typeof row.targetType === 'string' ? row.targetType : '' },
        row.label,
      );
      if (key !== row.connection) await runOp('core.rekeyConnection', { connection: id, key }, dataset.handle);
    } catch (error) {
      console.warn('RecordStore: could not refresh a connection key', error);
    }
  }

  async function rekeyConnectionsOf(handle: unknown, id: string): Promise<void> {
    try {
      const rows = (await entityNamed(RELATIONSHIP).findAll(handle, {
        where: { OR: [{ source: id }, { target: id }] },
      } as never)) as unknown as { id?: string }[];
      for (const row of rows) if (typeof row?.id === 'string') await rekeyConnection(row.id);
    } catch (error) {
      console.warn('RecordStore: could not refresh the keys of a renamed record', error);
    }
  }

  return {
    rekeyConnection,
    connect,
    keyFor,
    rekeyConnectionsOf,
  };
}
