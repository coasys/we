/**
 * What every part of the record store is built from: the port, the toasts, who is writing and where.
 *
 * The record store is several jobs over one surface — what kinds there are and how each is shown, the
 * form that makes one, a canvas's arrangement, a tree's, the connections drawn ahead of the data, and
 * things dragged in from elsewhere. Each is a factory of its own in this directory, composed into the one
 * `recordStore` templates read (`../RecordStore.ts`); this is what they share.
 */
import type { EntityStatic, RecordInstance } from '@we/backend-shared';
import { getEntity, runOperation } from '@we/entities';
import type { ReactivityPort } from '@we/reactivity';

import type { Toasts } from '../../toasts';
import type { DatasetStore } from '../DatasetStore';
import type { SessionStore } from '../SessionStore';

/** What the record store reads of the datasets: the one on screen, the ones held, and the classes it already has. */
export type RecordDatasets = Pick<DatasetStore, 'currentDataset' | 'currentDatasetEntities' | 'datasets'>;

export interface RecordContext {
  reactivity: ReactivityPort;
  toasts: Toasts;
  /** Who writes — every write runs as the signed-in agent. */
  sessionStore: Pick<SessionStore, 'me'>;
  datasetStore: RecordDatasets;
  /**
   * Run one of the declared operations (`core.placeCard` …) as the signed-in agent. The writes are
   * declared so every host and an agent make the same ones; what is drawn ahead and the undo stay here.
   */
  runOp: <T = unknown>(name: string, args: Record<string, unknown>, handle: unknown) => Promise<T>;
}

/** `runOp` for a session: refuses with nobody signed in, rather than writing as nobody. */
export function operationRunner(sessionStore: Pick<SessionStore, 'me'>): RecordContext['runOp'] {
  return async <T>(name: string, args: Record<string, unknown>, handle: unknown): Promise<T> => {
    const invoker = sessionStore.me()?.did;
    if (!invoker) throw new Error(`${name}: nobody is signed in`);
    return (await runOperation(name, args, { dataset: handle, invoker })) as T;
  };
}

/** The model a drawn connection is written as. Named once, so every part and the form agree. */
export const RELATIONSHIP = 'Relationship';

/**
 * A class this store writes through, picked by name at runtime. Loose over fields because which
 * entity it is is only known then.
 */
export type AnyEntity = EntityStatic<RecordInstance & Record<string, unknown>>;

/**
 * The registry's class for `name`. The registry's entries are typed loosely (`any`-valued); every
 * class it holds presents the contract's static surface, so it is read as that here, once — the same
 * conversion `@we/entities` makes for its own proxies.
 */
export function entityNamed(name: string): AnyEntity {
  return getEntity(name) as unknown as AnyEntity;
}

/** A canvas's own children, as the parent scope every placement and route on it is read and written under. */
export const canvasChildren = (canvas: string) => ({ id: canvas, relation: 'children', entity: 'CollectionBlock' });
