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
  /** Eagerly add a just-created dataset to the list and persist its ordering slot. */
  addDataset: (ref: DatasetRef) => Promise<void>;
  /** Add a just-joined dataset, adopting it as the global/marketplace dataset if the seed says so. */
  adoptJoinedDataset: (ref: DatasetRef) => void;
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
  const [currentDataset, setCurrentDataset] = createSignal<AppDataset | null>(null);
  const [currentDatasetModels, setCurrentDatasetModels] = createSignal<ModelManifestEntry[]>([]);
  const [isWeSpace, setIsWeSpace] = createSignal<boolean>(false);
  const [rootDataset, setRootDataset] = createSignal<AppDataset | null>(null);
  const [testDataset, setTestDataset] = createSignal<AppDataset | null>(null);
  const [globalDataset, setGlobalDataset] = createSignal<AppDataset | null>(null);
  const [marketplaceDataset, setMarketplaceDataset] = createSignal<AppDataset | null>(null);
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
  });

  // Converts null → undefined so that when JSON-serialised into an ORM WHERE clause,
  // personal datasets (no sharedUrl) produce {} rather than {"url":null}.
  const currentDatasetUri = createMemo<string | undefined>(() => currentDataset()?.sharedUri ?? undefined);

  // CID-only form (neighbourhood:// stripped) for comparing against Space.url,
  // which stores only the CID to avoid URI resolution in the AD4M triple store.
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
    const json = agentSettings()?.perspectiveOrder;
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
  /** The neighbourhood CID (with `neighbourhood://` stripped) for the global space, or null if unconfigured. */
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

  async function reorderDatasets(newOrder: string[]): Promise<void> {
    const settings = agentSettings();
    if (!settings) return;
    // Deduplicate while preserving order — guards against any remaining race between
    // the eager update in createSpace and the perspective-added subscription.
    const deduped = [...new Set(newOrder)];
    settings.perspectiveOrder = JSON.stringify(deduped);
    await settings.save();
    setAgentSettings(settings);
  }

  function subscribeToChanges(): void {
    const lifecycle = session.lifecycle();
    if (!lifecycle) return;
    lifecycle.subscribe({
      onAdded: (ref) => {
        if (datasets().some((d) => d.id === ref.id)) return;
        // Log unexpected datasets so we can identify and filter system ones
        const meAgent = session.me();
        const publicPerspectiveUuid = (meAgent?.perspective as { uuid?: string } | undefined)?.uuid;
        if (publicPerspectiveUuid && ref.id === publicPerspectiveUuid) {
          console.log('DatasetStore: suppressing agent public perspective from sidebar', ref.name, ref.id);
          return;
        }
        if (ref.name?.toLowerCase().startsWith('agent perspective')) {
          console.log('DatasetStore: suppressing agent perspective from sidebar', ref.name, ref.id);
          return;
        }
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
      if (!agentSettings()?.perspectiveOrder) {
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

        // Restore the global dataset if previously joined — model registration is handled
        // by SpaceStore/installSpaceSdna when the dataset is navigated to.
        const seedUrl = getSeed().globalSpaceUrl;
        const existingGlobal = seedUrl ? refs.find((d) => d.sharedUri === seedUrl) : undefined;
        if (existingGlobal) {
          setGlobalDataset(existingGlobal);
          console.log('DatasetStore: restored global dataset', existingGlobal.id);
        }

        const marketplaceUrl = getSeed().marketplaceUrl;
        const existingMarketplace = marketplaceUrl ? refs.find((d) => d.sharedUri === marketplaceUrl) : undefined;
        if (existingMarketplace) {
          setMarketplaceDataset(existingMarketplace);
          console.log('DatasetStore: restored marketplace dataset', existingMarketplace.id);
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

  async function addDataset(ref: DatasetRef): Promise<void> {
    if (datasets().some((existing) => existing.id === ref.id)) return;
    setDatasets((prev) => [...prev, toApp(ref)]);
    await reorderDatasets([...getDatasetOrder(), ref.id]);
  }

  function adoptJoinedDataset(ref: DatasetRef): void {
    const app = toApp(ref);
    // If this is the configured global space or marketplace, adopt it as such.
    const seedUrl = getSeed().globalSpaceUrl;
    if (app.sharedUri && app.sharedUri === seedUrl) setGlobalDataset(app);
    const mktUrl = getSeed().marketplaceUrl;
    if (app.sharedUri && app.sharedUri === mktUrl) setMarketplaceDataset(app);

    // Eagerly add so derived state (e.g. marketplaceJoined, joinedSpaceCids) updates immediately —
    // the dataset-added listener will also fire, but that backend event can lag or arrive too
    // late for gates that key off the dataset list.
    if (!datasets().some((existing) => existing.id === app.id)) {
      setDatasets((prev) => [...prev, app]);
    }
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
      const perspective = app.handle;

      // Check whether SDNA is already installed. Prefer the reliable SubjectClass
      // marker (isModelRegistered) over getAllShacl() emptiness for the actual
      // isWeSpace determination — getAllShacl()'s underlying triples can lag behind
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
      // race (the perspective-added listener fires before joinSpace reaches
      // installSpaceSdna) — should hit the install path here.
      const schemas = session.backendPorts()!.schemas;
      let weSpace = await schemas.hasCoreSchema(perspective);
      if (!weSpace) {
        if (!(await schemas.hasAnySchema(perspective))) {
          await schemas.installSpace(perspective, moduleRegistry.models());
          weSpace = await schemas.hasCoreSchema(perspective);
        }
      } else {
        // An existing WE space skips the install above by design, so a module enabled after the
        // space was created would find its shapes missing — a query failing with "No SHACL shape
        // stored for class X" in a dataset that otherwise looks healthy. Module shapes therefore
        // install on every switch; `ensureModelsRegistered` diffs first, so this is a read in the
        // common case.
        await schemas.installModules(perspective, moduleRegistry.models());
      }

      // SDNA is installed — switch immediately so WE templates render. WE model classes
      // are pre-registered at module load; foreign (non-WE) model resolution isn't needed
      // for the visible switch at all — it's only consumed below, in the background.
      batch(() => {
        setIsWeSpace(weSpace);
        setCurrentDataset(app);
      });

      // Background: fetch foreign SHACL shapes once and derive both the dynamic model
      // classes and the AI-facing manifest from that single result — they're pure,
      // synchronous transforms of the same data, not separate fetches (see
      // getForeignShacl's doc comment).
      // Stale guard: if the user navigated away before this resolves, skip updates.
      void (async () => {
        try {
          const manifest = await schemas.foreignSchemas(perspective);
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
      const perspective = (await lifecycle.get(targetUuid))?.handle as DatasetProxy | undefined;
      if (!perspective) return '';
      const dedupe = session.backendPorts()?.schemas.dedupe;
      if (!dedupe) return '';
      const { removed, authors } = await dedupe(perspective);
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

    addDataset,
    adoptJoinedDataset,
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
