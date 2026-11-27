/**
 * The record store's connections: a line drawn the moment it is drawn, and the dedup key every
 * connection carries.
 *
 * A connection is a record like any other, and every gesture that makes, moves or deletes one waited a
 * round trip for the line to change — the line somebody drew appeared a second later, the one they
 * deleted lingered, the end they moved snapped back first. Held here and drawn at once, on the same
 * rules as every other hold in the app (`@we/optimism`): kept until the data has moved, released on a
 * failed write, disbelieved after the backstop. See `shared/canvas/connectionHolds.ts` for what each
 * hold draws and waits for.
 *
 * The key (`connectionKey`) names both ends by title and carries the label, so it is rewritten whenever
 * any of those changes — here, for every part that changes one.
 */
import { createOptimism, sameValue } from '@we/optimism';

import {
  type ConnectionHold,
  connectionHoldKey,
  type DrawnConnection,
  observedConnection,
  pendingConnectionsOf,
} from '../../canvas/connectionHolds';
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

export interface RecordConnections extends Pick<
  RecordStore,
  'pendingConnections' | 'observeConnections' | 'rekeyConnection'
> {
  /** Draw this connection change from now on; answers the key its write reports back under. */
  hold: (change: ConnectionHold) => string;
  /** The write behind a hold is back: the hold stops being exempt from what the next drawing says. */
  done: (key: string) => void;
  /** The write behind a hold failed or made nothing: stop drawing it. */
  release: (key: string) => void;
  /**
   * Hold a connection change around the write that makes it: drawn at once, released if the write fails,
   * and otherwise left for the data to overtake. `write` answers the new connection's id for an added
   * line, so the hold knows what to wait for.
   */
  withHold: <T>(change: ConnectionHold, write: () => Promise<T>) => Promise<T>;
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
  const { reactivity, datasetStore, runOp, kinds } = deps;

  const connections = createOptimism<string | number>(reactivity.signal, { same: sameValue });
  const changes = new Map<string, ConnectionHold>();
  let addedSerial = 0;

  function hold(change: ConnectionHold): string {
    const { key, value } = connectionHoldKey(change, change.kind === 'added' ? ++addedSerial : addedSerial);
    changes.set(key, change);
    connections.hold(key, value);
    return key;
  }

  const pendingConnections = reactivity.memo(() => pendingConnectionsOf(connections.holds(), changes, Date.now()));

  function observeConnections(drawn: readonly DrawnConnection[]): void {
    if (!connections.inFlight()) return;
    const byId = new Map(drawn.map((line) => [line.id, line]));
    connections.settle((key) => observedConnection(changes.get(key), byId));
    // What the holder let go of needs nothing kept about what it drew.
    const live = connections.holds();
    for (const key of [...changes.keys()]) if (!(key in live)) changes.delete(key);
  }

  async function withHold<T>(change: ConnectionHold, write: () => Promise<T>): Promise<T> {
    const key = hold(change);
    try {
      const result = await write();
      if (change.kind === 'added' && typeof result === 'string') {
        if (result) change.id = result;
        else connections.release(key);
      }
      connections.done(key);
      return result;
    } catch (error) {
      connections.release(key);
      throw error;
    }
  }

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
      const row = (await kinds.entityClass(end.type, handle).findOne(handle, {
        where: { id: end.id },
      } as never)) as Record<string, unknown> | null;
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
    pendingConnections,
    observeConnections,
    rekeyConnection,
    hold,
    done: (key) => connections.done(key),
    release: (key) => connections.release(key),
    withHold,
    connect,
    keyFor,
    rekeyConnectionsOf,
  };
}
