/**
 * What every part of the space store is built from: the port, the toasts, who is writing and where.
 *
 * The space store is several jobs over one surface — the spaces the agent holds, going to one, what a
 * space runs and shows, what it extracts, its task states, involvements, roles and policy, and what is
 * unread in it. Each is a factory of its own in this directory, composed into the one `spaceStore`
 * templates read; this is what they share.
 */
import type { DatasetProxy } from '@we/entities';
import { runOperation } from '@we/entities';
import type { ReactivityPort } from '@we/reactivity';

import type { FirstScreen } from '../../firstScreen';
import { operationFailureMessage } from '../../operationFailure';
import type { Toasts } from '../../toasts';
import type { AppDataset, DatasetStore } from '../DatasetStore';
import type { SessionStore } from '../SessionStore';

/** What the space store reads of the session: who is signed in, and the backend it reached. */
export type SpaceSession = Pick<SessionStore, 'me' | 'lifecycle' | 'backendPorts' | 'bootState' | 'serverUrl'>;

/** What the space store reads and asks of the datasets. */
export type SpaceDatasets = Pick<
  DatasetStore,
  | 'currentDataset'
  | 'datasets'
  | 'orderedDatasets'
  | 'datasetsLoaded'
  | 'isWeSpace'
  | 'currentDatasetEntities'
  | 'rootDataset'
  | 'globalDataset'
  | 'globalSpaceId'
  | 'marketplaceId'
  | 'systemDatasetUuids'
  | 'agentSettings'
  | 'updateAgentSettings'
  | 'switchDataset'
  | 'trackDataset'
  | 'removeDataset'
  | 'clearCurrentDataset'
  | 'onDatasetRemoved'
>;

export interface SpaceContext {
  reactivity: ReactivityPort;
  toasts: Toasts;
  /** Whether work the first screen does not need may start yet. */
  firstScreen: Pick<FirstScreen, 'open' | 'whenOpen'>;
  sessionStore: SpaceSession;
  datasetStore: SpaceDatasets;
  /**
   * Run one of WE's own declared operations as this agent — in the dataset given, else the space on
   * screen. What the write means lives in the operation; the action around it keeps what only the
   * host does (what is drawn first, what is said, what is read again).
   */
  runCore: <T = unknown>(name: string, args: Record<string, unknown>, dataset?: DatasetProxy) => Promise<T>;
  /**
   * Say why an operation did nothing: its own words for a precondition it refused on (a name the
   * space already has), the given words for anything else. A policy refusal is already said by the
   * write check, once, for every write.
   */
  reportOperation: (what: string, fallback: string, error: unknown) => void;
  /**
   * The dataset a space-scoped write targets: a named space, or the one being viewed.
   *
   * Space settings are reached from the spaces list, so the space being configured is usually not
   * the one you are standing in — navigating to it would close the settings overlay
   * (`navigateToSpace` closes the shell view), which is the whole reason the list carries the
   * settings entry point rather than a "current space" page doing it.
   *
   * Omitting the argument keeps the previous meaning, so in-space callers are unchanged.
   */
  targetDataset: (spaceUuid?: string) => AppDataset | null;
  /** Whether a write is aimed at the space currently on screen — live UI switches only apply then. */
  isCurrent: (ds: AppDataset) => boolean;
}

export function createSpaceContext(deps: {
  reactivity: ReactivityPort;
  toasts: Toasts;
  firstScreen: SpaceContext['firstScreen'];
  sessionStore: SpaceSession;
  datasetStore: SpaceDatasets;
}): SpaceContext {
  const { toasts, sessionStore: session, datasetStore } = deps;
  return {
    ...deps,
    runCore: <T>(name: string, args: Record<string, unknown>, dataset?: DatasetProxy): Promise<T> => {
      const p = dataset ?? datasetStore.currentDataset()?.handle;
      const invoker = session.me()?.did;
      if (!p || !invoker) return Promise.reject(new Error('No space is open'));
      return runOperation(`core.${name}`, args, { dataset: p, invoker }) as Promise<T>;
    },
    reportOperation: (what, fallback, error) => {
      const message = operationFailureMessage(error, fallback);
      if (!message) return;
      console.error(`SpaceStore: could not ${what}`, error);
      toasts.error(message);
    },
    targetDataset: (spaceUuid) => {
      if (!spaceUuid) return datasetStore.currentDataset();
      return datasetStore.datasets().find((d) => d.id === spaceUuid) ?? null;
    },
    isCurrent: (ds) => datasetStore.currentDataset()?.id === ds.id,
  };
}
