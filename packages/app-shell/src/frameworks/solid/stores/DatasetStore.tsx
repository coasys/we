/**
 * DatasetStore — the agent's datasets: which exist, which is active, and what schema each holds.
 *
 * A dataset is the neutral term for a queryable data container — an AD4M perspective in this
 * backend (a repo/branch or database elsewhere). This store owns the dataset list and ordering,
 * the active dataset (with its registered models and we-space status), the system datasets
 * (root/test/global/marketplace), and the agent's root-dataset settings.
 *
 * Dataset lifecycle (list/create/remove/subscribe) runs through the session's
 * `DatasetLifecyclePort`. The coupling that remains is the model layer: schema install and
 * model reads operate on the handles (typed `DatasetProxy` via @we/models) — that half
 * neutralizes when compiled models bridge onto the neutral query engine.
 *
 * Space-model concerns (the `Space` entities that *describe* shared datasets) live in SpaceStore,
 * which layers on top of this store and reacts to dataset changes via `onDatasetRemoved` and the
 * `currentDataset` signal.
 */
import { provideModuleHostServices } from '@shared/registries/moduleHostServices';
import { moduleRegistry } from '@shared/registries/moduleRegistry';
import { getSeed } from '@shared/seedRegistry';
import type { DatasetRef, ModelManifestEntry } from '@we/backend-shared';
import { AgentSettings, type DatasetProxy } from '@we/models';
import { Accessor, batch, createContext, createMemo, createSignal, ParentProps, useContext } from 'solid-js';

import { useSessionStore } from './SessionStore';

export type { ModelManifestEntry, ModelManifestProperty } from '@we/backend-shared';

/**
 * A DatasetRef whose handle is narrowed to the model layer's dataset type — cast once where refs
 * enter the shell (this store), typed everywhere downstream. The described fields (id/name/
 * sharedUri/sharedId) are what UI logic reads; `handle` is what model calls consume.
 */
export interface AppDataset extends Omit<DatasetRef, 'handle'> {
  handle: DatasetProxy;
}

const toApp = (ref: DatasetRef): AppDataset => ref as AppDataset;

export interface DatasetStore {
  // State
  datasets: Accessor<AppDataset[]>;
  orderedDatasets: Accessor<AppDataset[]>;
  currentDataset: Accessor<AppDataset | null>;
  currentDatasetUri: Accessor<string | undefined>;
  currentDatasetCid: Accessor<string | undefined>;
  currentDatasetModels: Accessor<ModelManifestEntry[]>;
  /** True once the current dataset is confirmed to have WE's `Space` schema installed. */
  isWeSpace: Accessor<boolean>;
  joinedSpaceCids: Accessor<string[]>;
  /**
   * The backend has answered with the dataset list.
   *
   * Without it an empty list is indistinguishable from "not fetched yet", and a gate that asks
   * "have I joined this space?" reads the boot frame as "no" — flashing a join prompt at someone
   * already inside. The same reason `accountStore.accountsLoaded` exists.
   */
  datasetsLoaded: Accessor<boolean>;
  systemDatasetUuids: Accessor<string[]>;
  rootDataset: Accessor<AppDataset | null>;
  testDataset: Accessor<AppDataset | null>;
  globalDataset: Accessor<AppDataset | null>;
  marketplaceDataset: Accessor<AppDataset | null>;
  agentSettings: Accessor<AgentSettings | null>;
  globalSpaceConfigured: Accessor<boolean>;
  globalSpaceId: () => string | null;
  marketplaceConfigured: Accessor<boolean>;
  marketplaceId: () => string | null;
  marketplaceJoined: Accessor<boolean>;

  // Actions
  switchDataset: (uuid: string) => Promise<void>;
  reorderDatasets: (newOrder: string[]) => Promise<void>;
  /** Remove the dataset from the backend and local state. Space-level concerns (e.g. global
   * discovery cleanup) belong to SpaceStore.removeSpace, which calls this. */
  removeDataset: (uuid: string) => Promise<void>;
  updateAgentSettings: (updates: Partial<AgentSettings>) => Promise<void>;
  clearCurrentDataset: () => void;
  /** One-time remediation for a space that accumulated duplicate SDNA installs — removes the
   * redundant duplicate link copies. Defaults to the active dataset. Returns a display-ready
   * summary string, or '' if nothing needed cleaning up. */
  cleanupSpaceSdna: (uuid?: string) => Promise<string>;

  // Wiring for SpaceStore and the boot controller (not schema-facing)
  /**
   * Take a dataset the app just created or joined into local state, before the backend's own
   * change event arrives. The event fires too — both paths are idempotent — but gates that read
   * the dataset list (marketplaceJoined, the sidebar) would otherwise lag behind the action that
   * caused them.
   */
  trackDataset: (ref: DatasetRef) => Promise<void>;
  /** Register a callback fired after a dataset is removed (locally or by any client). */
  onDatasetRemoved: (cb: (uuid: string) => void) => void;
  initSystemDatasets: () => Promise<void>;
  loadDatasets: () => Promise<void>;
  subscribeToChanges: () => void;
  getDatasetOrder: () => string[];
}

const DatasetContext = createContext<DatasetStore>();

export function DatasetStoreProvider(props: ParentProps) {
  const session = useSessionStore();

  const [datasets, setDatasets] = createSignal<AppDataset[]>([]);
  const [datasetsLoaded, setDatasetsLoaded] = createSignal(false);
  const [currentDataset, setCurrentDataset] = createSignal<AppDataset | null>(null);
  const [currentDatasetModels, setCurrentDatasetModels] = createSignal<ModelManifestEntry[]>([]);
  const [isWeSpace, setIsWeSpace] = createSignal<boolean>(false);
  const [rootDataset, setRootDataset] = createSignal<AppDataset | null>(null);
  const [testDataset, setTestDataset] = createSignal<AppDataset | null>(null);
  const [agentSettings, setAgentSettings] = createSignal<AgentSettings | null>(null, { equals: false });

  const removedCallbacks: Array<(uuid: string) => void> = [];

  // Lend feature modules the neutral ports the host owns. Published rather than imported so a
  // module never reaches into host stores — what it receives is `EphemeralPort` and dataset
  // accessors, all of which any backend could satisfy. See moduleHostServices.ts.
  provideModuleHostServices({
    dataset: () => currentDataset()?.handle ?? null,
    // The *global* uri, never the local uuid — a uuid is local per-agent, so a call id derived
    // from one would differ on every peer and each would join a call only they can see.
    datasetUri: () => currentDataset()?.sharedUri ?? null,
    selfId: () => session.me()?.did ?? null,
    ephemeral: session.ephemeralPort,
    // Read through `backendPorts()` on every call rather than captured: the backend connects after
    // this store is constructed, and a backend that cannot transcribe simply never sets it.
    transcription: {
      models: async () => (await session.backendPorts()?.transcription?.models()) ?? [],
      open: async (modelId, onText, tuning) => {
        const port = session.backendPorts()?.transcription;
        if (!port) throw new Error('transcription: this backend cannot transcribe');
        return port.open(modelId, onText, tuning);
      },
    },
    // Same late read as transcription, but this one answers `available()` honestly — the wrapper is
    // always published, so a module asking "can this node interpret?" has to be told about the
    // backend behind it rather than about the wrapper's own existence.
    interpretation: {
      available: () => session.backendPorts()?.interpretation !== undefined,
      interpret: async (dataset, turns, request, ctl) => {
        const port = session.backendPorts()?.interpretation;
        if (!port) throw new Error('interpretation: this backend cannot interpret');
        return port.interpret(dataset, turns, request, ctl);
      },
      proposals: async (dataset) => (await session.backendPorts()?.interpretation?.proposals(dataset)) ?? [],
      accept: async (dataset, id, property) =>
        (await session.backendPorts()?.interpretation?.accept(dataset, id, property)) ?? false,
      reject: async (dataset, id, property) =>
        (await session.backendPorts()?.interpretation?.reject(dataset, id, property)) ?? false,
    },
  });

  // Converts null → undefined so that when JSON-serialised into an ORM WHERE clause,
  // personal datasets (no shared uri) produce {} rather than {"url":null}.
  const currentDatasetUri = createMemo<string | undefined>(() => currentDataset()?.sharedUri ?? undefined);

  // The scheme-less shared id, for comparing against Space.url — which stores that form so the
  // backend never has to resolve a URI mid-query.
  const currentDatasetCid = createMemo<string | undefined>(() => currentDataset()?.sharedId ?? undefined);
  const joinedSpaceCids = createMemo<string[]>(() =>
    datasets()
      .map((d) => d.sharedId)
      .filter((id): id is string => !!id),
  );

  const systemDatasetUuids = createMemo(() =>
    datasets()
      .filter((d) => ['we-root', 'we-test'].includes(d.name))
      .map((d) => d.id),
  );

  function getDatasetOrder(): string[] {
    const json = agentSettings()?.datasetOrder;
    if (!json) return [];
    try {
      return JSON.parse(json);
    } catch {
      return [];
    }
  }

  // Derived: datasets sorted by user-defined order (falls back to load order), system datasets excluded
  const orderedDatasets = createMemo(() => {
    const all = datasets().filter((d) => !['we-root', 'we-test'].includes(d.name));
    const order = getDatasetOrder();
    if (order.length === 0) return all;
    const byUuid = new Map(all.map((d) => [d.id, d]));
    const ordered = order.flatMap((uuid) => {
      const p = byUuid.get(uuid);
      return p ? [p] : [];
    });
    const inOrder = new Set(order);
    const appended = all.filter((d) => !inOrder.has(d.id));
    return [...ordered, ...appended];
  });

  // Seed URLs are backend-native deployment values (full URIs); correlating them with
  // scheme-less shared ids is the one sanctioned strip in the shell, defined here once.
  const globalSpaceConfigured = () => !!getSeed().globalSpaceUrl;
  const marketplaceConfigured = () => !!getSeed().marketplaceUrl;
  /** The scheme-less shared id for the global space, or null if unconfigured. */
  const globalSpaceId = (): string | null => {
    const url = getSeed().globalSpaceUrl;
    return url ? url.replace('neighbourhood://', '') : null;
  };
  const marketplaceId = (): string | null => {
    const url = getSeed().marketplaceUrl;
    return url ? url.replace('neighbourhood://', '') : null;
  };
  const marketplaceJoined = createMemo(() => {
    const id = marketplaceId();
    return id ? joinedSpaceCids().includes(id) : false;
  });

  /**
   * The seed-configured datasets are *recognised*, not assigned: whichever joined dataset carries
   * the seed's uri is the global space / marketplace. Derived rather than set imperatively so
   * there is no path — restore on boot, join at runtime — that can forget to claim one.
   *
   * (`rootDataset`/`testDataset` stay explicit signals below: those the host *creates* when
   * absent, which is a lifecycle step rather than a match.)
   */
  const globalDataset = createMemo<AppDataset | null>(() => {
    const seedUrl = getSeed().globalSpaceUrl;
    return seedUrl ? (datasets().find((d) => d.sharedUri === seedUrl) ?? null) : null;
  });
  const marketplaceDataset = createMemo<AppDataset | null>(() => {
    const mktUrl = getSeed().marketplaceUrl;
    return mktUrl ? (datasets().find((d) => d.sharedUri === mktUrl) ?? null) : null;
  });

  async function reorderDatasets(newOrder: string[]): Promise<void> {
    const settings = agentSettings();
    if (!settings) return;
    // Deduplicate while preserving order — guards against any remaining race between
    // the eager update in createSpace and the dataset-added subscription.
    const deduped = [...new Set(newOrder)];
    settings.datasetOrder = JSON.stringify(deduped);
    await settings.save();
    setAgentSettings(settings);
  }

  function subscribeToChanges(): void {
    const lifecycle = session.lifecycle();
    if (!lifecycle) return;
    lifecycle.subscribe({
      onAdded: (ref) => {
        if (datasets().some((d) => d.id === ref.id)) return;
        // Backend bookkeeping datasets never arrive here — the adapter filters its own (see
        // createAd4mDatasetLifecycle). What this store still filters is the HOST's convention:
        // we-root/we-test, excluded from the sidebar by `orderedDatasets`.
        // Re-check after the async gap: createSpace's eager update may have run while
        // the adapter resolved the handle, which would add a duplicate.
        if (datasets().some((d) => d.id === ref.id)) return;
        setDatasets((prev) => [...prev, toApp(ref)]);
        reorderDatasets([...getDatasetOrder(), ref.id]).catch(console.error);
      },

      // Update events fire on renames and share-state transitions — not on link changes.
      // Space model data lives in links, so there's nothing to refresh here beyond the handle.
      onUpdated: (ref) => {
        setDatasets((prev) => prev.map((d) => (d.id === ref.id ? toApp(ref) : d)));
      },

      // Removal fires for deletions from any client
      onRemoved: (uuid) => {
        setDatasets((prev) => prev.filter((d) => d.id !== uuid));
        removedCallbacks.forEach((cb) => cb(uuid));
        reorderDatasets(getDatasetOrder().filter((id) => id !== uuid)).catch(console.error);
      },
    });
  }

  /** Load the dataset snapshot and bootstrap the sidebar ordering on first run. */
  async function loadDatasets(): Promise<void> {
    const lifecycle = session.lifecycle();
    if (!lifecycle) return;
    try {
      const refs = (await lifecycle.list()).map(toApp);
      setDatasets(refs);

      // Bootstrap dataset order on first load (when no order has been saved yet)
      if (!agentSettings()?.datasetOrder) {
        const systemOrder = ['we-root', 'we-test', 'we-global'];
        const initialOrder = [...refs]
          .sort((a, b) => {
            const ai = systemOrder.indexOf(a.name);
            const bi = systemOrder.indexOf(b.name);
            if (ai === -1 && bi === -1) return 0;
            if (ai === -1) return 1;
            if (bi === -1) return -1;
            return ai - bi;
          })
          .map((d) => d.id);
        await reorderDatasets(initialOrder);
      }
    } catch (error) {
      console.error('DatasetStore: loadDatasets error', error);
    } finally {
      // Set even on failure: the question has been asked and answered, badly. Leaving it false
      // would hold every gate in "still resolving" for the rest of the session, which is a worse
      // failure than showing what we know.
      setDatasetsLoaded(true);
    }
  }

  /** Find or create the root dataset and all other system datasets.
   * Also restores global/marketplace datasets if previously joined. */
  async function initSystemDatasets(): Promise<void> {
    const lifecycle = session.lifecycle();
    if (!lifecycle) return;
    try {
      const refs = (await lifecycle.list()).map(toApp);
      const rootRef = refs.find((d) => d.name === 'we-root');

      if (rootRef) {
        // Ensure all models are registered (handles new models added after initial creation)
        await session.backendPorts()!.schemas.installRoot(rootRef.handle);
        setRootDataset(rootRef);

        const settings = await AgentSettings.findOne(rootRef.handle);
        if (settings) setAgentSettings(settings);

        // Find or create we-test system dataset (uses same snapshot)
        const existingTest = refs.find((d) => d.name === 'we-test');
        if (existingTest) {
          setTestDataset(existingTest);
        } else {
          setTestDataset(toApp(await lifecycle.create('we-test')));
        }

        return;
      }

      // No root dataset exists — create one
      console.log('DatasetStore: creating root dataset');
      const rootCreated = toApp(await lifecycle.create('we-root'));
      await session.backendPorts()!.schemas.installRoot(rootCreated.handle);

      const settings = await AgentSettings.create(rootCreated.handle, {
        currentTemplateId: 'default',
        currentThemeId: 'dark',
        defaultThemeId: 'dark',
      });

      setRootDataset(rootCreated);
      setAgentSettings(settings);

      console.log('DatasetStore: created root dataset', rootCreated.id);

      // Find or create we-test system dataset
      const allRefs = (await lifecycle.list()).map(toApp);
      const existingTest = allRefs.find((d) => d.name === 'we-test');
      if (existingTest) {
        setTestDataset(existingTest);
      } else {
        setTestDataset(toApp(await lifecycle.create('we-test')));
      }
    } catch (error) {
      console.error('DatasetStore: initSystemDatasets error', error);
    }
  }

  // TODO: could this be done cleaner with the .update() method on the model instead of mutating and saving?
  async function updateAgentSettings(updates: Partial<AgentSettings>): Promise<void> {
    const settings = agentSettings();
    if (!settings) return;

    Object.assign(settings, updates);
    await settings.save();
    setAgentSettings(settings);
  }

  async function trackDataset(ref: DatasetRef): Promise<void> {
    if (datasets().some((existing) => existing.id === ref.id)) return;
    setDatasets((prev) => [...prev, toApp(ref)]);
    // reorderDatasets dedupes, so re-tracking a dataset the change event already ordered is safe.
    await reorderDatasets([...getDatasetOrder(), ref.id]);
  }

  async function removeDataset(uuid: string): Promise<void> {
    const lifecycle = session.lifecycle();
    if (!lifecycle) return;

    try {
      await lifecycle.remove(uuid);
      setDatasets((prev) => prev.filter((d) => d.id !== uuid));
      removedCallbacks.forEach((cb) => cb(uuid));
    } catch (error) {
      console.error('DatasetStore: removeDataset error', error);
    }
  }

  async function switchDataset(uuid: string): Promise<void> {
    const lifecycle = session.lifecycle();
    if (!lifecycle) return;

    try {
      const ref = await lifecycle.get(uuid);
      if (!ref) return;
      const app = toApp(ref);
      const handle = app.handle;

      // Check whether the schema is already installed. The port's `hasCoreSchema` uses the
      // reliable marker rather than a shape listing for the isWeSpace determination — a listing's
      // underlying triples can lag behind
      // on a freshly-switched-to, not-yet-fully-synced dataset (e.g. over a
      // remote backend connection) even though the space's SDNA is already installed
      // and queryable.
      //
      // But the *install-triggering* condition below must stay "is ANYTHING at all
      // installed", not "is WE's Space specifically installed" — a dataset with
      // its own established foreign SDNA (e.g. a Flux community, with Channel/Message/
      // Community shapes but no Space shape) must NOT be auto-converted into a WE
      // space here. That's exactly what the "Initialize as WE space" gate (see
      // foreignSpacePrefill in SpaceStore) exists to ask the user about explicitly.
      // Only a dataset with no SDNA of any kind — the genuine first-time join
      // race (the dataset-added listener fires before joinSpace reaches the schema install)
      // — should hit the install path here.
      const schemas = session.backendPorts()!.schemas;
      let weSpace = await schemas.hasCoreSchema(handle);
      if (!weSpace) {
        if (!(await schemas.hasAnySchema(handle))) {
          await schemas.installSpace(handle, moduleRegistry.moduleSchemas(schemas));
          weSpace = await schemas.hasCoreSchema(handle);
        }
      } else {
        // An existing WE space skips the install above by design, so a module enabled after the
        // space was created would find its shapes missing — a query failing with "No SHACL shape
        // stored for class X" in a dataset that otherwise looks healthy. Module shapes therefore
        // install on every switch; the port diffs before writing, so this is a read in the
        // common case.
        await schemas.installModules(handle, moduleRegistry.moduleSchemas(schemas));
        // The same skip has a second cost: a *property* added to one of WE's own models reaches
        // newly created spaces only, and writes to it are silently dropped in every space that
        // predates it. Refresh brings those shapes up to date; it also diffs before writing.
        const refreshed = await schemas.refreshSpace(handle).catch((err) => {
          console.error('DatasetStore: space schema refresh failed', err);
          return [] as string[];
        });
        if (refreshed.length) console.info(`DatasetStore: refreshed space schemas — ${refreshed.join(', ')}`);
      }

      // SDNA is installed — switch immediately so WE templates render. WE model classes
      // are pre-registered at module load; foreign (non-WE) model resolution isn't needed
      // for the visible switch at all — it's only consumed below, in the background.
      batch(() => {
        setIsWeSpace(weSpace);
        setCurrentDataset(app);
      });

      // Background: discover schemas foreign to the host (another app's entities synced into
      // this dataset) and publish their manifest — the port registers them for name-based query
      // resolution as part of the same pass.
      // Stale guard: if the user navigated away before this resolves, skip updates.
      void (async () => {
        try {
          const manifest = await schemas.foreignSchemas(handle);
          if (currentDataset()?.id === uuid) setCurrentDatasetModels(manifest);
        } catch (err) {
          console.warn('DatasetStore: foreignSchemas failed', err);
          if (currentDataset()?.id === uuid) setCurrentDatasetModels([]);
        }
      })();
    } catch (error) {
      console.error('DatasetStore: switchDataset error', error);
    }
  }

  async function cleanupSpaceSdna(uuid?: string): Promise<string> {
    const lifecycle = session.lifecycle();
    if (!lifecycle) return '';

    const targetUuid = uuid ?? currentDataset()?.id;
    if (!targetUuid) {
      console.warn('DatasetStore: cleanupSpaceSdna called with no uuid and no active dataset');
      return '';
    }

    try {
      const handle = (await lifecycle.get(targetUuid))?.handle as DatasetProxy | undefined;
      if (!handle) return '';
      const dedupe = session.backendPorts()?.schemas.dedupe;
      if (!dedupe) return '';
      const { removed, authors } = await dedupe(handle);
      if (removed === 0) return 'No duplicate SDNA links found.';
      const myDid = session.me()?.did;
      const authorList = authors.map((did) => (did === myDid ? `${did} (you)` : did)).join(', ');
      const summary = `Removed ${removed} duplicate SDNA link(s) created by: ${authorList}`;
      console.log(`DatasetStore: cleanupSpaceSdna on ${targetUuid} —`, summary);
      return summary;
    } catch (error) {
      console.error('DatasetStore: cleanupSpaceSdna error', error);
      return '';
    }
  }

  const store: DatasetStore = {
    datasets,
    orderedDatasets,
    currentDataset,
    currentDatasetUri,
    currentDatasetCid,
    currentDatasetModels,
    isWeSpace,
    joinedSpaceCids,
    datasetsLoaded,
    systemDatasetUuids,
    rootDataset,
    testDataset,
    globalDataset,
    marketplaceDataset,
    agentSettings,
    globalSpaceConfigured,
    globalSpaceId,
    marketplaceConfigured,
    marketplaceId,
    marketplaceJoined,

    switchDataset,
    reorderDatasets,
    removeDataset,
    updateAgentSettings,
    clearCurrentDataset: () => {
      setCurrentDataset(null);
      setIsWeSpace(false);
    },
    cleanupSpaceSdna,

    trackDataset,
    onDatasetRemoved: (cb) => removedCallbacks.push(cb),
    initSystemDatasets,
    loadDatasets,
    subscribeToChanges,
    getDatasetOrder,
  };

  return <DatasetContext.Provider value={store}>{props.children}</DatasetContext.Provider>;
}

export function useDatasetStore(): DatasetStore {
  const context = useContext(DatasetContext);
  if (!context) throw new Error('useDatasetStore must be used within the DatasetStoreProvider');
  return context;
}
