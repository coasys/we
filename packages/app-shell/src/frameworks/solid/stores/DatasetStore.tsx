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
import type { ModelManifestEntry } from '@we/backend-ad4m';
import {
  buildModelClasses,
  buildModelManifest,
  deduplicateSpaceSdna,
  getForeignShacl,
  installModuleSdna,
  installRootSdna,
  installSpaceSdna,
  isModelRegistered,
  registerDynamicModels,
} from '@we/backend-ad4m';
import { AgentSettings, type DatasetProxy, Space } from '@we/models';
import { Accessor, batch, createContext, createMemo, createSignal, ParentProps, useContext } from 'solid-js';

import { useSessionStore } from './SessionStore';

export type { ModelManifestEntry, ModelManifestProperty } from '@we/backend-ad4m';

export interface DatasetStore {
  // State
  datasets: Accessor<DatasetProxy[]>;
  orderedDatasets: Accessor<DatasetProxy[]>;
  currentDataset: Accessor<DatasetProxy | null>;
  currentDatasetUri: Accessor<string | undefined>;
  currentDatasetCid: Accessor<string | undefined>;
  currentDatasetModels: Accessor<ModelManifestEntry[]>;
  /** True once the current dataset is confirmed to have WE's `Space` schema installed. */
  isWeSpace: Accessor<boolean>;
  joinedSpaceCids: Accessor<string[]>;
  systemDatasetUuids: Accessor<string[]>;
  rootDataset: Accessor<DatasetProxy | null>;
  testDataset: Accessor<DatasetProxy | null>;
  globalDataset: Accessor<DatasetProxy | null>;
  marketplaceDataset: Accessor<DatasetProxy | null>;
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
  addDataset: (p: DatasetProxy) => Promise<void>;
  /** Add a just-joined dataset, adopting it as the global/marketplace dataset if the seed says so. */
  adoptJoinedDataset: (p: DatasetProxy) => void;
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

  const [datasets, setDatasets] = createSignal<DatasetProxy[]>([]);
  const [currentDataset, setCurrentDataset] = createSignal<DatasetProxy | null>(null);
  const [currentDatasetModels, setCurrentDatasetModels] = createSignal<ModelManifestEntry[]>([]);
  const [isWeSpace, setIsWeSpace] = createSignal<boolean>(false);
  const [rootDataset, setRootDataset] = createSignal<DatasetProxy | null>(null);
  const [testDataset, setTestDataset] = createSignal<DatasetProxy | null>(null);
  const [globalDataset, setGlobalDataset] = createSignal<DatasetProxy | null>(null);
  const [marketplaceDataset, setMarketplaceDataset] = createSignal<DatasetProxy | null>(null);
  const [agentSettings, setAgentSettings] = createSignal<AgentSettings | null>(null, { equals: false });

  const removedCallbacks: Array<(uuid: string) => void> = [];

  // Lend feature modules the neutral ports the host owns. Published rather than imported so a
  // module never reaches into host stores — what it receives is `EphemeralPort` and dataset
  // accessors, all of which any backend could satisfy. See moduleHostServices.ts.
  provideModuleHostServices({
    dataset: () => currentDataset() ?? null,
    // The *global* uri, never the local uuid — a uuid is local per-agent, so a call id derived
    // from one would differ on every peer and each would join a call only they can see.
    datasetUri: () => currentDataset()?.sharedUrl ?? null,
    selfId: () => session.me()?.did ?? null,
    ephemeral: session.ephemeralPort,
  });

  // Converts null → undefined so that when JSON-serialised into an ORM WHERE clause,
  // personal datasets (no sharedUrl) produce {} rather than {"url":null}.
  const currentDatasetUri = createMemo<string | undefined>(() => currentDataset()?.sharedUrl ?? undefined);

  // CID-only form (neighbourhood:// stripped) for comparing against Space.url,
  // which stores only the CID to avoid URI resolution in the AD4M triple store.
  const currentDatasetCid = createMemo<string | undefined>(
    () => currentDataset()?.sharedUrl?.replace('neighbourhood://', '') ?? undefined,
  );
  const joinedSpaceCids = createMemo<string[]>(() =>
    datasets()
      .filter((p) => p.sharedUrl)
      .map((p) => p.sharedUrl!.replace('neighbourhood://', '')),
  );

  const systemDatasetUuids = createMemo(() =>
    datasets()
      .filter((p) => ['we-root', 'we-test'].includes(p.name))
      .map((p) => p.uuid),
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
    const all = datasets().filter((p) => !['we-root', 'we-test'].includes(p.name));
    const order = getDatasetOrder();
    if (order.length === 0) return all;
    const byUuid = new Map(all.map((p) => [p.uuid, p]));
    const ordered = order.flatMap((uuid) => {
      const p = byUuid.get(uuid);
      return p ? [p] : [];
    });
    const inOrder = new Set(order);
    const appended = all.filter((p) => !inOrder.has(p.uuid));
    return [...ordered, ...appended];
  });

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
        const perspective = ref.handle as DatasetProxy;
        if (datasets().some((p) => p.uuid === ref.id)) return;
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
        if (datasets().some((p) => p.uuid === ref.id)) return;
        setDatasets((prev) => [...prev, perspective]);
        reorderDatasets([...getDatasetOrder(), ref.id]).catch(console.error);
      },

      // Update events fire on renames and share-state transitions — not on link changes.
      // Space model data lives in links, so there's nothing to refresh here beyond the handle.
      onUpdated: (ref) => {
        setDatasets((prev) => prev.map((p) => (p.uuid === ref.id ? (ref.handle as DatasetProxy) : p)));
      },

      // Removal fires for deletions from any client
      onRemoved: (uuid) => {
        setDatasets((prev) => prev.filter((p) => p.uuid !== uuid));
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
      const perspectives = (await lifecycle.list()).map((ref) => ref.handle as DatasetProxy);
      setDatasets(perspectives);

      // Bootstrap dataset order on first load (when no order has been saved yet)
      if (!agentSettings()?.perspectiveOrder) {
        const systemOrder = ['we-root', 'we-test', 'we-global'];
        const initialOrder = [...perspectives]
          .sort((a, b) => {
            const ai = systemOrder.indexOf(a.name);
            const bi = systemOrder.indexOf(b.name);
            if (ai === -1 && bi === -1) return 0;
            if (ai === -1) return 1;
            if (bi === -1) return -1;
            return ai - bi;
          })
          .map((p) => p.uuid);
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
      const perspectives = (await lifecycle.list()).map((ref) => ref.handle as DatasetProxy);
      const rootP = perspectives.find((p) => p.name === 'we-root');

      if (rootP) {
        // Ensure all models are registered (handles new models added after initial creation)
        await installRootSdna(rootP);
        setRootDataset(rootP);

        const settings = await AgentSettings.findOne(rootP);
        if (settings) setAgentSettings(settings);

        // Find or create we-test system dataset (uses same snapshot)
        const existingTest = perspectives.find((p) => p.name === 'we-test');
        if (existingTest) {
          setTestDataset(existingTest);
        } else {
          const testP = (await lifecycle.create('we-test')).handle as DatasetProxy;
          setTestDataset(testP);
        }

        // Restore the global dataset if previously joined — model registration is handled
        // by SpaceStore/installSpaceSdna when the dataset is navigated to.
        const seedUrl = getSeed().globalSpaceUrl;
        const existingGlobal = seedUrl ? perspectives.find((p) => p.sharedUrl === seedUrl) : undefined;
        if (existingGlobal) {
          setGlobalDataset(existingGlobal);
          console.log('DatasetStore: restored global dataset', existingGlobal.uuid);
        }

        const marketplaceUrl = getSeed().marketplaceUrl;
        const existingMarketplace = marketplaceUrl
          ? perspectives.find((p) => p.sharedUrl === marketplaceUrl)
          : undefined;
        if (existingMarketplace) {
          setMarketplaceDataset(existingMarketplace);
          console.log('DatasetStore: restored marketplace dataset', existingMarketplace.uuid);
        }

        return;
      }

      // No root dataset exists — create one
      console.log('DatasetStore: creating root dataset');
      const perspective = (await lifecycle.create('we-root')).handle as DatasetProxy;
      await installRootSdna(perspective);
      // Model.register resolves before SDNA is actually ready
      await new Promise((resolve) => setTimeout(resolve, 500));

      const settings = await AgentSettings.create(perspective, {
        currentTemplateId: 'default',
        currentThemeId: 'dark',
        defaultThemeId: 'dark',
      });

      setRootDataset(perspective);
      setAgentSettings(settings);

      console.log('DatasetStore: created root dataset', perspective.uuid);

      // Find or create we-test system dataset
      const allPersp = (await lifecycle.list()).map((ref) => ref.handle as DatasetProxy);
      const existingTest = allPersp.find((p: DatasetProxy) => p.name === 'we-test');
      if (existingTest) {
        setTestDataset(existingTest);
      } else {
        const testP = (await lifecycle.create('we-test')).handle as DatasetProxy;
        setTestDataset(testP);
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

  async function addDataset(p: DatasetProxy): Promise<void> {
    if (datasets().some((existing) => existing.uuid === p.uuid)) return;
    setDatasets((prev) => [...prev, p]);
    await reorderDatasets([...getDatasetOrder(), p.uuid]);
  }

  function adoptJoinedDataset(p: DatasetProxy): void {
    // If this is the configured global space or marketplace, adopt it as such.
    const seedUrl = getSeed().globalSpaceUrl;
    if (p.sharedUrl && p.sharedUrl === seedUrl) setGlobalDataset(p);
    const mktUrl = getSeed().marketplaceUrl;
    if (p.sharedUrl && p.sharedUrl === mktUrl) setMarketplaceDataset(p);

    // Eagerly add so derived state (e.g. marketplaceJoined, joinedSpaceCids) updates immediately —
    // the perspective-added listener will also fire, but that backend event can lag or arrive too
    // late for gates that key off the dataset list.
    if (!datasets().some((existing) => existing.uuid === p.uuid)) {
      setDatasets((prev) => [...prev, p]);
    }
  }

  async function removeDataset(uuid: string): Promise<void> {
    const lifecycle = session.lifecycle();
    if (!lifecycle) return;

    try {
      await lifecycle.remove(uuid);
      setDatasets((prev) => prev.filter((p) => p.uuid !== uuid));
      removedCallbacks.forEach((cb) => cb(uuid));
    } catch (error) {
      console.error('DatasetStore: removeDataset error', error);
    }
  }

  async function switchDataset(uuid: string): Promise<void> {
    const lifecycle = session.lifecycle();
    if (!lifecycle) return;

    try {
      const perspective = (await lifecycle.get(uuid))?.handle as DatasetProxy | undefined;
      if (!perspective) return;

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
      let weSpace = await isModelRegistered(perspective, Space);
      if (!weSpace) {
        const shapeNames = await perspective.getShaclNames();
        if (shapeNames.length === 0) {
          await installSpaceSdna(perspective, moduleRegistry.models());
          await new Promise((resolve) => setTimeout(resolve, 500));
          weSpace = await isModelRegistered(perspective, Space);
        }
      } else {
        // An existing WE space skips the install above by design, so a module enabled after the
        // space was created would find its shapes missing — a query failing with "No SHACL shape
        // stored for class X" in a dataset that otherwise looks healthy. Module shapes therefore
        // install on every switch; `ensureModelsRegistered` diffs first, so this is a read in the
        // common case.
        await installModuleSdna(perspective, moduleRegistry.models());
      }

      // SDNA is installed — switch immediately so WE templates render. WE model classes
      // are pre-registered at module load; foreign (non-WE) model resolution isn't needed
      // for the visible switch at all — it's only consumed below, in the background.
      batch(() => {
        setIsWeSpace(weSpace);
        setCurrentDataset(perspective);
      });

      // Background: fetch foreign SHACL shapes once and derive both the dynamic model
      // classes and the AI-facing manifest from that single result — they're pure,
      // synchronous transforms of the same data, not separate fetches (see
      // getForeignShacl's doc comment).
      // Stale guard: if the user navigated away before this resolves, skip updates.
      void (async () => {
        let foreignShapes: Awaited<ReturnType<typeof getForeignShacl>> = [];
        try {
          foreignShapes = await getForeignShacl(perspective);
        } catch (err) {
          console.warn('DatasetStore: getForeignShacl failed', err);
        }

        try {
          if (currentDataset()?.uuid === uuid) registerDynamicModels(uuid, buildModelClasses(foreignShapes));
        } catch (err) {
          console.warn('DatasetStore: registerDynamicModels failed', err);
        }

        try {
          if (currentDataset()?.uuid === uuid) setCurrentDatasetModels(buildModelManifest(foreignShapes));
        } catch (err) {
          console.warn('DatasetStore: buildModelManifest failed', err);
          if (currentDataset()?.uuid === uuid) setCurrentDatasetModels([]);
        }
      })();
    } catch (error) {
      console.error('DatasetStore: switchDataset error', error);
    }
  }

  async function cleanupSpaceSdna(uuid?: string): Promise<string> {
    const lifecycle = session.lifecycle();
    if (!lifecycle) return '';

    const targetUuid = uuid ?? currentDataset()?.uuid;
    if (!targetUuid) {
      console.warn('DatasetStore: cleanupSpaceSdna called with no uuid and no active dataset');
      return '';
    }

    try {
      const perspective = (await lifecycle.get(targetUuid))?.handle as DatasetProxy | undefined;
      if (!perspective) return '';
      const { removed, authors } = await deduplicateSpaceSdna(perspective);
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
