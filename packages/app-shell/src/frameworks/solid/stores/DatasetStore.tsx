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
import { sameDataset } from '@shared/datasetIdentity';
import { containmentPredicate, gatherTranscriptTurns, type TurnModel } from '@shared/interpretation/transcriptTurns';
import { provideModuleHostServices } from '@shared/registries/moduleHostServices';
import { moduleRegistry } from '@shared/registries/moduleRegistry';
import { getSeed } from '@shared/seedRegistry';
import { datasetKey, type DatasetRef, type ModelManifestEntry } from '@we/backend-shared';
import { AgentSettings, type DatasetProxy, getModelForPerspective } from '@we/models';
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
  /** SpaceStore supplies "does this space want calls interpreted automatically". Unset reads off. */
  provideAutoInterpretGate: (gate: () => boolean) => void;
}

const DatasetContext = createContext<DatasetStore>();

export function DatasetStoreProvider(props: ParentProps) {
  const session = useSessionStore();

  const [datasets, setDatasets] = createSignal<AppDataset[]>([]);
  const [datasetsLoaded, setDatasetsLoaded] = createSignal(false);
  /**
   * The dataset on screen — and it notifies only when that is a *different* dataset.
   *
   * `toRef` in the backend adapter builds a fresh object on every `lifecycle.get`, so publishing the
   * same space twice publishes two objects that are equal in every way that matters and unequal by
   * reference. Solid's default comparison is reference identity, so every consumer re-ran.
   *
   * That is not a tidiness point. `PresenceStore` rebuilds its source when this changes, and
   * rebuilding means broadcasting a `bye` and dropping the peer map — so a re-publish of the space
   * you are already in told your peers you had left, emptied the call's roster, and closed every
   * `RTCPeerConnection` in it. Clicking your own space in the sidebar during a call dropped the
   * call, which is exactly what going to its settings and coming back makes you do.
   *
   * See {@link sameDataset} for what counts as the same.
   */
  const [currentDataset, setCurrentDataset] = createSignal<AppDataset | null>(null, { equals: sameDataset });
  const [currentDatasetModels, setCurrentDatasetModels] = createSignal<ModelManifestEntry[]>([]);
  const [isWeSpace, setIsWeSpace] = createSignal<boolean>(false);
  const [rootDataset, setRootDataset] = createSignal<AppDataset | null>(null);
  const [testDataset, setTestDataset] = createSignal<AppDataset | null>(null);
  const [agentSettings, setAgentSettings] = createSignal<AgentSettings | null>(null, { equals: false });

  const removedCallbacks: Array<(uuid: string) => void> = [];

  /*
    Whether the current space wants its calls interpreted as they happen.

    Injected rather than read, for the same reason `TemplateStore.provideSpaceLookup` exists: the
    setting lives on a `Space`, SpaceStore layers on top of this store, and the dependency only
    points one way. Unset means off.
  */
  let autoInterpretGate: (() => boolean) | null = null;
  const provideAutoInterpretGate = (gate: () => boolean) => {
    autoInterpretGate = gate;
  };

  // Lend feature modules the neutral ports the host owns. Published rather than imported so a
  // module never reaches into host stores — what it receives is `EphemeralPort` and dataset
  // accessors, all of which any backend could satisfy. See moduleHostServices.ts.
  provideModuleHostServices({
    dataset: () => currentDataset()?.handle ?? null,
    // The *global* uri, never the local uuid — a uuid is local per-agent, so a call id derived
    // from one would differ on every peer and each would join a call only they can see.
    datasetUri: () => currentDataset()?.sharedUri ?? null,
    // The same dataset, named the way a stored reference names it: the CID where there is one, so
    // the reference means the same record to every agent who joined, and the local uuid otherwise.
    datasetRefKey: () => {
      const ds = currentDataset();
      return ds ? datasetKey({ cid: ds.sharedUri, uuid: ds.id }) : '';
    },
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

    // Gathering the turns is the host's half of the job: the port takes turns, and a module has no
    // read with which to produce them. Parenting what comes back onto the same collection is not
    // optional dressing — an unparented TaskBlock is a real record that no route lists, so an
    // extraction that skipped it would look exactly like one that found nothing.
    interpretCollection: async (collectionId, request) => {
      const port = session.backendPorts()?.interpretation;
      if (!port) throw new Error('interpretation: this backend cannot interpret');
      const dataset = currentDataset();
      if (!dataset) throw new Error('interpretation: no dataset to interpret into');

      const modelFor = (entity: string) => getModelForPerspective(entity, dataset.handle);
      const predicate = containmentPredicate(modelFor, currentDatasetModels());
      if (!predicate) throw new Error('interpretation: this space has no collection schema to read a transcript from');

      const turns = await gatherTranscriptTurns(
        {
          modelFor: (entity) => modelFor(entity) as TurnModel | undefined,
          handle: dataset.handle,
          containmentPredicate: predicate,
        },
        collectionId,
      );

      return port.interpret(dataset.handle, turns, {
        classes: request.classes,
        parent: { id: collectionId, predicate },
      });
    },

    /*
      The standing version of the same thing, and the reason it lives here rather than on the module
      surface.

      A module names a collection worth watching; everything else is the host's — the watch id, the
      dataset, the containment predicate, and the lifetime. That split is what keeps this from being
      "a module holding a watch", which the module contract refuses: a watch is a *dataset-level*
      registration shared with every peer, and a module store whose lifetime is a panel being open
      would leave one behind every time somebody closed it.

      Keyed on the collection id, so registering twice for one call is the same registration rather
      than two. The engine reads its processors out of the perspective graph, so this is idempotent
      in the place it matters: whichever peer registers first wins and the rest write the same row.
    */
    watchCollection: async (collectionId, request) => {
      const port = session.backendPorts()?.interpretation;
      if (!port?.watch) throw new Error('interpretation: this backend cannot run a standing watch');
      // The community's decision, read through a gate SpaceStore supplies — this store sits below
      // it and cannot reach a Space. Absent (no gate provided yet, or no space) reads as off, which
      // is the right way round for something that spends somebody's LLM budget.
      if (!autoInterpretGate?.()) throw new Error('interpretation: automatic extraction is off for this space');
      const dataset = currentDataset();
      if (!dataset) throw new Error('interpretation: no dataset to interpret into');

      const modelFor = (entity: string) => getModelForPerspective(entity, dataset.handle);
      const predicate = containmentPredicate(modelFor, currentDatasetModels());
      if (!predicate) throw new Error('interpretation: this space has no collection schema to read a transcript from');

      await port.watch(dataset.handle, {
        watchId: watchIdFor(collectionId),
        classes: request.classes,
        parent: { id: collectionId, predicate },
      });
    },

    /*
      Repair anything a standing pass minted without an edge.

      Runs when a call is opened rather than on a timer, because that is the moment somebody is
      about to look: the records exist either way, and what is missing is only their place in the
      call. Returns the count so a caller can say nothing when there was nothing to do.
    */
    reconcileCollection: async (collectionId, request) => {
      const port = session.backendPorts()?.interpretation;
      const dataset = currentDataset();
      if (!port?.reconcile || !dataset) return 0;

      const modelFor = (entity: string) => getModelForPerspective(entity, dataset.handle);
      const predicate = containmentPredicate(modelFor, currentDatasetModels());
      if (!predicate) return 0;

      return port.reconcile(dataset.handle, {
        classes: request.classes,
        parent: { id: collectionId, predicate },
      });
    },

    unwatchCollection: async (collectionId) => {
      const port = session.backendPorts()?.interpretation;
      const dataset = currentDataset();
      // Silent rather than thrown: this runs while tearing a call down, and a host that never
      // registered anything is not a failure worth interrupting that with.
      if (!port?.unwatch || !dataset) return;
      await port.unwatch(dataset.handle, watchIdFor(collectionId));
    },
  });

  /*
  One collection, one watch.

  Derived rather than stored so that any peer computing it lands on the same string: the engine
  keys its processors by this id inside the shared perspective, so two members starting the same
  call must agree on it or they register two watches over one transcript and every utterance is
  interpreted twice.

  Reduced to letters, digits and dashes because the id becomes part of a URI — the engine mints its
  processor node at `ad4m://autoprocessor/<id>`, and a record id is itself a URL. It was written
  against ids of the form `literal:string:…`, which nested a second `literal:` inside the processor
  URI on a layer that decides literal-from-URI by exactly that prefix. AD4M now mints `ad4m://obj/…`
  instead, so that particular collision is gone — but the reduction stays, because what an id looks
  like is AD4M's business and has changed once already.
*/
  const watchIdFor = (collectionId: string) => `we-call-${collectionId.replace(/[^a-zA-Z0-9]+/g, '-')}`;

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
        const rootSchemas = session.backendPorts()!.schemas;
        await rootSchemas.installRoot(rootRef.handle, moduleRegistry.agentSchemas(rootSchemas));
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
      const newRootSchemas = session.backendPorts()!.schemas;
      await newRootSchemas.installRoot(rootCreated.handle, moduleRegistry.agentSchemas(newRootSchemas));

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
        // The same skip has a second cost, in two forms: a *property* added to one of WE's own
        // models, and a *model* added outright, both reach newly created spaces only — the first
        // silently dropping writes, the second failing every query against the new entity with "No
        // SHACL shape stored for class X". Refresh covers both; it diffs before writing.
        const written = await schemas.refreshSpace(handle).catch((err) => {
          console.error('DatasetStore: space schema refresh failed', err);
          return [] as string[];
        });
        if (written.length) console.info(`DatasetStore: brought space schemas up to date — ${written.join(', ')}`);
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
    provideAutoInterpretGate,
  };

  return <DatasetContext.Provider value={store}>{props.children}</DatasetContext.Provider>;
}

export function useDatasetStore(): DatasetStore {
  const context = useContext(DatasetContext);
  if (!context) throw new Error('useDatasetStore must be used within the DatasetStoreProvider');
  return context;
}
