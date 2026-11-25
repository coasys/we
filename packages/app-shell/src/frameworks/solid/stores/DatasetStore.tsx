/**
 * DatasetStore — the agent's datasets: which exist, which is active, and what schema each holds.
 *
 * A dataset is the neutral term for a queryable data container — an AD4M perspective in this
 * backend (a repo/branch or database elsewhere). This store owns the dataset list and ordering,
 * the active dataset (with its registered models and we-space status), the system datasets
 * (root/personal/test/global/marketplace), and the agent's root-dataset settings.
 *
 * Dataset lifecycle (list/create/remove/subscribe) runs through the session's
 * `DatasetLifecyclePort`. The coupling that remains is the model layer: schema install and
 * model reads operate on the handles (typed `DatasetProxy` via @we/entities) — that half
 * neutralizes when compiled models bridge onto the neutral query engine.
 *
 * Space-model concerns (the `Space` entities that *describe* shared datasets) live in SpaceStore,
 * which layers on top of this store and reacts to dataset changes via `onDatasetRemoved` and the
 * `currentDataset` signal.
 */
import { createCallKernel } from '@shared/callKernel';
import { sameDataset } from '@shared/datasetIdentity';
import { hostListeners } from '@shared/hostSlot';
import { reportModuleRefusal } from '@shared/moduleSchemaRefusal';
import { provideModuleHostServices } from '@shared/registries/moduleHostServices';
import { moduleRegistry } from '@shared/registries/moduleRegistry';
import { getSeed } from '@shared/seedRegistry';
import { isSystemDataset, SYSTEM_DATASET_NAMES, SYSTEM_DATASETS } from '@shared/systemDatasets';
import { datasetKey, type DatasetRef, type EntityManifestEntry, trace } from '@we/backend-shared';
import { toastService } from '@we/components/solid';
import { AgentSettings, type DatasetProxy } from '@we/entities';
import { latest } from '@we/module-shared';
import { Accessor, batch, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js';

import { firstScreen } from '../firstScreen';
import type { StoreRegistry } from './useStore';

export type { EntityManifestEntry, EntityManifestProperty } from '@we/backend-shared';

/**
 * A DatasetRef whose handle is narrowed to the model layer's dataset type — cast once where refs
 * enter the shell (this store), typed everywhere downstream. The described fields (id/name/
 * sharedUri/sharedId) are what UI logic reads; `handle` is what model calls consume.
 */
export interface AppDataset extends Omit<DatasetRef, 'handle'> {
  handle: DatasetProxy;
}

const toApp = (ref: DatasetRef): AppDataset => ref;

/**
 * The one segment a space is addressed by — its shared id when it has one, its local id otherwise.
 *
 * Both forms *resolve*: the route effect matches `d.id === seg || d.sharedId === seg`, so a shared
 * space had two working URLs and which one you got depended on which code path built the link.
 * `switchTemplate` wrote the shared id, `navigateToSpace` passed through whatever it was handed, and
 * `spacePath` echoed whatever was already in the address — so one space accumulated two history
 * entries, two share links, and two answers to "am I already here".
 *
 * The rule was never in doubt, only unenforced: a local id means nothing to anybody else, so a
 * space that can be shared is addressed by the id that travels. Written once here and used wherever
 * a space path is built; the other form keeps resolving, as an alias rather than an equal.
 */
export const canonicalSpaceId = (dataset: Pick<AppDataset, 'id' | 'sharedId'>): string =>
  dataset.sharedId ?? dataset.id;

export interface DatasetStore {
  // State
  datasets: Accessor<AppDataset[]>;
  orderedDatasets: Accessor<AppDataset[]>;
  currentDataset: Accessor<AppDataset | null>;
  currentDatasetUri: Accessor<string | undefined>;
  currentDatasetCid: Accessor<string | undefined>;
  currentDatasetEntities: Accessor<EntityManifestEntry[]>;
  /**
   * The current dataset's foreign models have been read. They are read after the switch is shown,
   * so until then an empty list — or the previous space's — says nothing about this one.
   */
  currentDatasetEntitiesLoaded: Accessor<boolean>;
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
  /** The app's configuration — settings, installed templates and themes, per-space preferences. */
  rootDataset: Accessor<AppDataset | null>;
  /**
   * The agent's own things — notes, the Pocket — in a dataset with the ordinary space schema.
   *
   * Separate from the root so content a person made is never in the blast radius of repairing or
   * resetting configuration, and so it can be published to follow them between devices without
   * their per-machine settings. `null` until its schema is installed. See `systemDatasets.ts`.
   */
  personalDataset: Accessor<AppDataset | null>;
  /**
   * The personal space's schema install, from the moment the boot has found the dataset: resolves
   * with it once `personalDataset` is set, or with `null` if the install failed. `null` before the
   * boot has found it. A write to the personal space awaits this, so a write made after the app
   * appears and before the install is held rather than dropped.
   */
  whenPersonalDataset: Accessor<Promise<AppDataset | null> | null>;
  testDataset: Accessor<AppDataset | null>;
  globalDataset: Accessor<AppDataset | null>;
  marketplaceDataset: Accessor<AppDataset | null>;
  agentSettings: Accessor<AgentSettings | null>;
  /**
   * Read this agent's settings again. They are read once, at boot, and another of this agent's
   * devices can change them meanwhile — installing a template, say, which is what decides whether it
   * shows in the pickers here.
   */
  refreshAgentSettings: () => Promise<void>;
  globalSpaceConfigured: Accessor<boolean>;
  globalSpaceId: () => string | null;
  marketplaceConfigured: Accessor<boolean>;
  marketplaceId: () => string | null;
  marketplaceJoined: Accessor<boolean>;

  // Actions
  /**
   * Switch to a dataset. `stillWanted` is asked once more, after the round trips and just before the
   * switch is published; answering false abandons it. For a switch made on behalf of something that
   * can move on without asking again — the address bar — see the URL effect in SpaceStore.
   */
  switchDataset: (uuid: string, options?: { stillWanted?: () => boolean }) => Promise<void>;
  reorderDatasets: (newOrder: string[]) => Promise<void>;
  /** Remove the dataset from the backend and local state. Space-level concerns (e.g. global
   * discovery cleanup) belong to SpaceStore.removeSpace, which calls this. */
  removeDataset: (uuid: string) => Promise<void>;
  /**
   * Write a partial update to the agent's settings. Resolves false when it did not land — and says
   * so with a toast, since most callers are `void`-ed and have no other channel.
   */
  updateAgentSettings: (updates: Partial<AgentSettings>) => Promise<boolean>;
  clearCurrentDataset: () => void;

  // Wiring for SpaceStore and the boot controller (not schema-facing)
  /**
   * Take a dataset the app just created or joined into local state, before the backend's own
   * change event arrives. The event fires too — both paths are idempotent — but gates that read
   * the dataset list (marketplaceJoined, the sidebar) would otherwise lag behind the action that
   * caused them.
   */
  trackDataset: (ref: DatasetRef) => Promise<void>;
  /**
   * Register a callback fired after a dataset is removed (locally or by any client).
   *
   * Returns the unsubscribe — hand it to `onCleanup` unless the subscriber genuinely lives as long
   * as the app. Without one this list only ever grew, and a store that unmounted kept being called
   * into a disposed scope. See `hostListeners`.
   */
  onDatasetRemoved: (cb: (uuid: string) => void) => () => void;
  /** The backend's dataset list, or null when it cannot be read. Publishes nothing. */
  readDatasets: () => Promise<AppDataset[] | null>;
  /**
   * Bring up the system datasets. Given the list `readDatasets` just read, works from that rather
   * than reading it again. Resolves with every dataset it saw or made, for `loadDatasets`, once the
   * root is up; the personal space's schema is brought up after the first screen, and
   * `personalDataset` is set when it is.
   */
  initSystemDatasets: (known?: AppDataset[] | null) => Promise<AppDataset[] | null>;
  /**
   * Publish the dataset list. Given the list `initSystemDatasets` just read, publishes that rather
   * than asking the backend again — every ask builds a handle per dataset, and a boot asked twice.
   */
  loadDatasets: (known?: AppDataset[] | null) => Promise<void>;
  subscribeToChanges: () => void;
  getDatasetOrder: () => string[];
}

export function createDatasetStore(deps: Pick<StoreRegistry, 'sessionStore'>): DatasetStore {
  const session = deps.sessionStore;

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
  const [currentDatasetEntities, setCurrentDatasetEntities] = createSignal<EntityManifestEntry[]>([]);
  /** The dataset `currentDatasetEntities` was last read for — see `currentDatasetEntitiesLoaded`. */
  const [entitiesReadFor, setEntitiesReadFor] = createSignal<string | null>(null);
  /**
   * Which publish the read in flight belongs to. Opening a space again starts a new read, and an
   * older read of the same space finishing must not say the newer one is done.
   */
  const entitiesRead = latest();
  const currentDatasetEntitiesLoaded = (): boolean => {
    const id = currentDataset()?.id;
    return Boolean(id) && entitiesReadFor() === id;
  };
  const [isWeSpace, setIsWeSpace] = createSignal<boolean>(false);
  const [rootDataset, setRootDataset] = createSignal<AppDataset | null>(null);
  const [personalDataset, setPersonalDataset] = createSignal<AppDataset | null>(null);
  const [whenPersonalDataset, setWhenPersonalDataset] = createSignal<Promise<AppDataset | null> | null>(null);
  /*
    Counted up each time the agent locks. The personal space's install runs after the app appears,
    so it can still be out when somebody locks and signs in again; what it finds belongs to the
    session that started it, and the count is how it knows that session has ended.
  */
  let sessionsEnded = 0;
  createEffect(() => {
    if (session.bootState() === 'login') sessionsEnded++;
  });
  const [testDataset, setTestDataset] = createSignal<AppDataset | null>(null);
  const [agentSettings, setAgentSettings] = createSignal<AgentSettings | null>(null, { equals: false });

  /*
    Who wants telling when a dataset goes away.

    A plain array with a `push` and no way back out: a store that subscribed and then unmounted was
    still called, into a disposed scope, for the rest of the session. `hostListeners` gives the
    unsubscribe and puts each call in its own `try` — one subscriber failing to forget a dataset
    must not stop the others hearing about it.
  */
  const removedListeners = hostListeners<(uuid: string) => void>('DatasetStore.onDatasetRemoved');

  // Lend feature modules the neutral ports the host owns. Published rather than imported so a
  // module never reaches into host stores — what it receives is `EphemeralPort` and dataset
  // accessors, all of which any backend could satisfy. See moduleHostServices.ts.
  onCleanup(
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
      // Calls, over the backend's call port — read on every call, like transcription below. The
      // module asks without a dataset; the kernel chooses it: the call's own space when the module
      // names one, which a participant following a switch may have navigated away from.
      call: createCallKernel({
        port: () => session.backendPorts()?.call,
        current: () => currentDataset()?.handle ?? null,
        byUri: (uri) => datasets().find((d) => d.sharedUri === uri)?.handle ?? null,
      }),
      // Read through `backendPorts()` on every call rather than captured: the backend connects after
      // this store is constructed, and a backend that cannot transcribe simply never sets it.
      transcription: {
        models: async () => (await session.backendPorts()?.transcription?.models()) ?? [],
        open: async (modelId, onText) => {
          const port = session.backendPorts()?.transcription;
          if (!port) throw new Error('transcription: this backend cannot transcribe');
          return port.open(modelId, onText);
        },
        setup: async () => (await session.backendPorts()?.transcription?.setup?.()) ?? null,
        connectFound: async () => {
          const port = session.backendPorts()?.transcription;
          if (!port?.connectFound) throw new Error('transcription: this backend cannot set transcription up');
          return port.connectFound();
        },
      },
      // The node's own language model, for a module that summarises, translates or tags. The port
      // existed on the backend and was never handed to a module; this is the whole of handing it over.
      languageModel: {
        available: async () => (await session.backendPorts()?.languageModel?.available()) ?? false,
        prompt: async (system, input) => {
          const port = session.backendPorts()?.languageModel;
          if (!port) throw new Error('languageModel: this backend has no language model');
          return port.prompt(system, input);
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
        /*
          Forwarded, like every member above — this wrapper lists them by hand, so a port method it
          does not name never reaches a module. Leaving this one out made every Accept and Discard
          decide alone, with no question asked, which is the failure the read exists to prevent.
          Nothing tied, where the backend cannot say: the decision then stands alone, as it did
          before the read existed.
        */
        connections: async (dataset, id) =>
          (await session.backendPorts()?.interpretation?.connections?.(dataset, id)) ?? { ends: [], connections: [] },
      },
    }),
  );

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
      .filter((d) => isSystemDataset(d.name))
      .map((d) => d.id),
  );

  function getDatasetOrder(): string[] {
    const order = agentSettings()?.datasetOrder;
    return Array.isArray(order) ? order.filter((id): id is string => typeof id === 'string') : [];
  }

  // Derived: datasets sorted by user-defined order (falls back to load order), system datasets excluded
  const orderedDatasets = createMemo(() => {
    const all = datasets().filter((d) => !isSystemDataset(d.name));
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
    settings.datasetOrder = deduped;
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
        // the system datasets, excluded from the sidebar by `orderedDatasets`.
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
        followPublish(ref);
      },

      // Removal fires for deletions from any client
      onRemoved: (uuid) => {
        setDatasets((prev) => prev.filter((d) => d.id !== uuid));
        removedListeners.emit(uuid);
        reorderDatasets(getDatasetOrder().filter((id) => id !== uuid)).catch(console.error);
      },
    });
  }

  /** Load the dataset snapshot and bootstrap the sidebar ordering on first run. */
  async function loadDatasets(known?: AppDataset[] | null): Promise<void> {
    const lifecycle = session.lifecycle();
    if (!lifecycle) return;
    try {
      const refs = known ?? (await lifecycle.list()).map(toApp);
      setDatasets(refs);

      // Bootstrap dataset order on first load (when no order has been saved yet)
      if (!Array.isArray(agentSettings()?.datasetOrder)) {
        const systemOrder = [...SYSTEM_DATASETS, 'we-global'];
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

  /**
   * Find or create every system dataset — the root, the personal space, the test sandbox.
   *
   * Each in its own `try`. They were one, which was harmless while the root was the only one that
   * mattered; with a personal space beside it, a failure bringing one schema up to date must not
   * leave the other unset — no settings because the notes schema failed to refresh is the wrong
   * way round.
   */
  async function readDatasets(): Promise<AppDataset[] | null> {
    const lifecycle = session.lifecycle();
    if (!lifecycle) return null;
    try {
      return (await lifecycle.list()).map(toApp);
    } catch (error) {
      console.error('DatasetStore: could not read the dataset list', error);
      return null;
    }
  }

  async function initSystemDatasets(known?: AppDataset[] | null): Promise<AppDataset[] | null> {
    const lifecycle = session.lifecycle();
    if (!lifecycle) return null;
    const refs = known ?? (await readDatasets());
    if (!refs) return null;

    // Side by side: the three share nothing but the list, and each is several round trips to the
    // backend — one after another they were most of the wait before a space could open. Only what
    // the app needs to appear is waited for: the root, which holds the agent's settings, templates
    // and per-space choices, and the datasets a first run has to make, so the list published holds them.
    const made: AppDataset[] = [];
    const started = sessionsEnded;
    await Promise.all([
      initRootDataset(refs, made).catch((error) => console.error('DatasetStore: root dataset error', error)),
      findPersonalDataset(refs, made).then(
        (personal) => {
          if (started !== sessionsEnded) return;
          // Held, not awaited: the boot does not wait for it. `initPersonalDataset` catches its own errors.
          const install = initPersonalDataset(personal, made.includes(personal));
          void setWhenPersonalDataset(() => install);
        },
        (error) => console.error('DatasetStore: personal dataset error', error),
      ),
      (async () => {
        const existingTest = refs.find((d) => d.name === SYSTEM_DATASET_NAMES.test);
        const test = existingTest ?? toApp(await lifecycle.create(SYSTEM_DATASET_NAMES.test));
        if (!existingTest) made.push(test);
        setTestDataset(test);
      })().catch((error) => console.error('DatasetStore: test dataset error', error)),
    ]);
    return [...refs, ...made];
  }

  /**
   * The root: the app's configuration, and nothing a person made.
   *
   * Its schema is reinstalled on every boot so a model added after the dataset was created is there
   * to query. Module entities no longer install here — an agent-scoped module's records are the
   * agent's own things, and they live in the personal space. See `systemDatasets.ts`.
   */
  async function initRootDataset(refs: AppDataset[], made: AppDataset[]): Promise<void> {
    const lifecycle = session.lifecycle()!;
    const schemas = session.backendPorts()!.schemas;
    const existing = refs.find((d) => d.name === SYSTEM_DATASET_NAMES.root);

    if (existing) {
      // An existing root already holds `AgentSettings`, so reading it need not wait for the
      // reinstall, which only brings shapes up to date. Settled rather than awaited alongside it:
      // a failed read must not leave the root unset, which loses every saved template and theme.
      const early = AgentSettings.findOne(existing.handle).then(
        (settings) => ({ settings }),
        (error: unknown) => ({ error }),
      );
      await schemas.installRoot(existing.handle);
      setRootDataset(existing);
      const read = await early;
      // The likeliest failure is the first boot after the settings model changed, when the read
      // lands mid-reinstall. The reinstall has finished now, so ask once more.
      const settings = 'settings' in read ? read.settings : await AgentSettings.findOne(existing.handle);
      if (settings) setAgentSettings(settings);
      return;
    }

    trace('dataset', 'root:create');
    const created = toApp(await lifecycle.create(SYSTEM_DATASET_NAMES.root));
    made.push(created);
    await schemas.installRoot(created.handle);
    // No theme: a new agent has not chosen one, so they wear the theme their app offers first
    // (WE's own offers Dark). Writing one here made it a choice that outranked every app's theme.
    await AgentSettings.create(created.handle, { currentTemplateId: 'default' });
    setRootDataset(created);
    // Read back rather than holding what the create answered with, which is the same thing the
    // `existing` branch above does one screen up. This signal lives for the life of the app and its
    // relations *are* read — `hiddenTemplates` and `installedThemes` decide which custom
    // templates and themes the pickers show — and a create's answer carries none (see `NewRecord`).
    // Held, the very first session after an account is made would install a template and go on
    // reading an empty list, so the thing it had just installed never showed as installed.
    const settings = await AgentSettings.findOne(created.handle);
    if (settings) setAgentSettings(settings);
    trace('dataset', 'root:created', { id: created.id });
  }

  /**
   * The personal space: what this agent made or kept, with the ordinary space schema.
   *
   * A space's schema rather than the root's, because what lives here is content — a note is a post
   * nobody else can see — and the composer, the renderer and file storage all assume a space's
   * models. Every module's entities install here too, the space-scoped ones included: a note can
   * hold any block a post can, and a block a module contributes is one of those.
   *
   * Published only once its schema is in, since the first thing a reader does is query it — a
   * template's `$query` on `personalDataset` runs the moment it is set, and a query ahead of the
   * install fails with "No SHACL shape" rather than returning nothing.
   *
   * After the first screen (`shared/firstScreen.ts`), and not waited for by the boot: the space on
   * screen reads nothing here, and these schema reads go to the same backend as its Feed's first
   * page. What writes to it — the Pocket, notes, agent-scoped modules — awaits what this resolves
   * with (`whenPersonalDataset`). A failure is logged, leaves `personalDataset` unset, as it always
   * did, and resolves `null`. So does a session that ended while the install was out: what it set
   * would be the last session's dataset in the next.
   *
   * No `Space` record. Nothing yet navigates into this dataset, and a record would put it in every
   * list that reads `Space` — which is exactly the listing a system dataset stays out of.
   */
  async function initPersonalDataset(personal: AppDataset, created: boolean): Promise<AppDataset | null> {
    const started = sessionsEnded;
    try {
      await firstScreen.whenOpen();
      const schemas = session.backendPorts()!.schemas;
      const moduleSchemas = [...moduleRegistry.moduleSchemas(schemas), ...moduleRegistry.agentSchemas(schemas)];

      if (created || !(await schemas.hasCoreSchema(personal.handle))) {
        await schemas
          .installSpace(personal.handle, moduleSchemas)
          .catch(reportModuleRefusal('DatasetStore: personal space'));
      } else {
        // The same two catches a space gets on every switch, run together — see `switchDataset`.
        await Promise.all([
          schemas.installModules(personal.handle, moduleSchemas).catch((err) => {
            console.error('DatasetStore: personal space module schema install failed', err);
          }),
          schemas.refreshSpace(personal.handle).catch((err) => {
            console.error('DatasetStore: personal space schema refresh failed', err);
          }),
        ]);
      }
      if (started !== sessionsEnded) return null;
      setPersonalDataset(personal);
      return personal;
    } catch (error) {
      console.error('DatasetStore: personal dataset error', error);
      return null;
    }
  }

  /** The personal space, made if this agent has none yet — a first run — and then listed in `made`. */
  async function findPersonalDataset(refs: AppDataset[], made: AppDataset[]): Promise<AppDataset> {
    const existing = refs.find((d) => d.name === SYSTEM_DATASET_NAMES.personal);
    if (existing) return existing;
    const personal = toApp(await session.lifecycle()!.create(SYSTEM_DATASET_NAMES.personal));
    made.push(personal);
    return personal;
  }

  /**
   * Write a partial update to the agent's settings, and say so if it did not land.
   *
   * ## Why this one function is worth the ceremony
   *
   * Nearly every persisted preference in the app goes through here — the default template and
   * theme, both sides of the Follow-system pair, the Claude API key, the dataset order, which
   * modules are installed. Most callers are `void`-ed, so nothing awaits the write. Without a
   * rollback, a failed save would leave the app showing the new value and the perspective holding
   * the old one until a reload.
   *
   * So: snapshot the fields being changed, apply, save, and put the snapshot back if the save
   * throws. The toast is the only channel left, given the callers return `void` — but it is the
   * channel that matters, since the person just flicked a switch and is entitled to know it did not
   * take. Resolving `false` rather than rethrowing so a caller that *does* await gets an answer
   * without a caller that does not getting an unhandled rejection.
   *
   * (The revert restores only what this call touched. Two updates racing each other would otherwise
   * have the loser's revert undo the winner's write.)
   */
  async function refreshAgentSettings(): Promise<void> {
    const root = rootDataset();
    if (!root) return;
    try {
      const settings = await AgentSettings.findOne(root.handle);
      if (settings) setAgentSettings(settings);
    } catch (error) {
      console.warn('DatasetStore: re-reading agent settings failed', error);
    }
  }

  /** The stored fields of an `AgentSettings` record — its keys minus its methods. */
  type AgentSettingsField = {
    [K in keyof AgentSettings]-?: AgentSettings[K] extends (...args: never[]) => unknown ? never : K;
  }[keyof AgentSettings];

  async function updateAgentSettings(updates: Partial<AgentSettings>): Promise<boolean> {
    const settings = agentSettings();
    if (!settings) return false;

    // Updates name stored fields only, never one of the record's methods.
    const keys = Object.keys(updates) as AgentSettingsField[];
    const before = Object.fromEntries(keys.map((key) => [key, settings[key]])) as Partial<AgentSettings>;

    Object.assign(settings, updates);
    try {
      await settings.save();
      setAgentSettings(settings);
      return true;
    } catch (error) {
      Object.assign(settings, before);
      setAgentSettings(settings);
      console.error('DatasetStore: updateAgentSettings error', error);
      toastService.error('That setting could not be saved');
      return false;
    }
  }

  /**
   * Add a dataset to the list, or replace the entry already there.
   *
   * Replace, not skip. The backend's added event routinely wins the race with the action that made
   * the dataset — a shared space is created, then published, and the event lands in between — so the
   * entry already listed can predate the publish: no `sharedUri`, and a handle whose `sharedUrl` is
   * empty. Anything looking the space up by its shared uri then misses it, which is how a new space's
   * presence never started and its transcript had no call to write into until a reload re-listed it.
   * The caller's ref is the one that knows how the action ended.
   */
  async function trackDataset(ref: DatasetRef): Promise<void> {
    if (datasets().some((existing) => existing.id === ref.id)) {
      setDatasets((prev) => prev.map((d) => (d.id === ref.id ? toApp(ref) : d)));
      followPublish(ref);
      return;
    }
    setDatasets((prev) => [...prev, toApp(ref)]);
    // reorderDatasets dedupes, so re-tracking a dataset the change event already ordered is safe.
    await reorderDatasets([...getDatasetOrder(), ref.id]);
  }

  /**
   * The space on screen, once it has been published: its shared address, where it had none.
   *
   * A shared space is published in the background now, after it has been created and usually after
   * it has been opened — so `currentDataset` was set from a ref with no `sharedUri`, and only the
   * list heard that the publish had finished. Everything keyed on the open space's shared address
   * stayed dead until a reload: no way to start a call, no presence, no live calls, and a space
   * address built in the meantime carried the local id.
   *
   * Only for that change. Replacing the current dataset on any update would restart whatever follows
   * it whenever the handle object differed — presence among them, which drops a running call.
   */
  function followPublish(ref: DatasetRef): void {
    const current = untrack(currentDataset);
    if (current?.id === ref.id && ref.sharedUri && ref.sharedUri !== current.sharedUri) setCurrentDataset(toApp(ref));
  }

  async function removeDataset(uuid: string): Promise<void> {
    const lifecycle = session.lifecycle();
    if (!lifecycle) return;

    try {
      await lifecycle.remove(uuid);
      setDatasets((prev) => prev.filter((d) => d.id !== uuid));
      removedListeners.emit(uuid);
    } catch (error) {
      console.error('DatasetStore: removeDataset error', error);
    }
  }

  /**
   * The switch most recently asked for — not the one most recently finished.
   *
   * A switch is several round trips long (`hasCoreSchema`, `installModules`, `refreshSpace`), so two
   * of them overlap routinely: clicking a space runs one, and the route change that follows runs
   * another. They finish in whatever order the network decides, and a switch nobody wants any more
   * must not land on top of the one they do.
   *
   * Requested rather than started, because that is the question with an answer: "is this still what
   * the reader asked for". Whichever ask is latest wins, however long it takes to arrive.
   */
  let requestedDataset: string | null = null;

  async function switchDataset(uuid: string, options?: { stillWanted?: () => boolean }): Promise<void> {
    const lifecycle = session.lifecycle();
    if (!lifecycle) return;
    requestedDataset = uuid;
    const started = performance.now();
    let step = started;
    const lap = () => {
      const now = performance.now();
      const ms = Math.round(now - step);
      step = now;
      return ms;
    };

    try {
      const ref = await lifecycle.get(uuid);
      trace('dataset', 'switch:get', { dataset: uuid, ms: lap() });
      if (!ref || requestedDataset !== uuid) return;
      const app = toApp(ref);
      const handle = app.handle;

      // Check whether the schema is already installed. `hasCoreSchema` asks whether WE's Space
      // class is registered — the class every query against a WE space reads first.
      //
      // But the *install-triggering* condition below must stay "is ANYTHING at all
      // installed", not "is WE's Space specifically installed" — a dataset with
      // its own established foreign SDNA (e.g. a Flux community, with Channel/Message/
      // Community shapes but no Space shape) must NOT be auto-converted into a WE
      // space here. That's exactly what the "Initialize as WE space" gate (see
      // foreignSpacePrefill in SpaceStore) exists to ask the user about explicitly.
      // Only a dataset with no SDNA of any kind — the genuine first-time join
      // race (the dataset-added listener fires before joinSpace reaches the schema install)
      // — should hit the install path here. And only once it has synced: before that a
      // just-joined dataset holds no SDNA whatever app made it, so a Flux community would
      // look empty too.
      const schemas = session.backendPorts()!.schemas;
      let weSpace = await schemas.hasCoreSchema(handle);
      trace('dataset', 'switch:core', { dataset: uuid, weSpace, ms: lap() });
      if (!weSpace) {
        if (!(await schemas.hasAnySchema(handle))) {
          await lifecycle.whenSynced?.(uuid);
          if (requestedDataset !== uuid) return;
          if (!(await schemas.hasAnySchema(handle))) {
            await schemas
              .installSpace(handle, moduleRegistry.moduleSchemas(schemas))
              .catch(reportModuleRefusal('DatasetStore: switchDataset'));
          }
          weSpace = await schemas.hasCoreSchema(handle);
        }
      } else {
        // An existing WE space skips the install above by design, so a module enabled after the
        // space was created would find its shapes missing — a query failing with "No SHACL shape
        // stored for class X" in a dataset that otherwise looks healthy. Module shapes therefore
        // install on every switch; registration writes only what changed, so this writes nothing
        // in the common case.
        //
        // The same skip has a second cost, in two forms: a *property* added to one of WE's own
        // models, and a *model* added outright, both reach newly created spaces only — the first
        // silently dropping writes, the second failing every query against the new entity with "No
        // SHACL shape stored for class X". Refresh covers both, and writes only what changed.
        //
        // Together rather than in turn: they register disjoint classes (a module's, WE's own), so
        // neither waits on the other.
        //
        // Neither failing stops the switch. The space is a WE space already, so it opens on the
        // shapes it holds; a module the backend refused is named in the error (each module installs
        // on its own, so the others are in), and its records are what will not query.
        const [, written] = await Promise.all([
          schemas.installModules(handle, moduleRegistry.moduleSchemas(schemas)).catch((err) => {
            console.error('DatasetStore: module schema install failed', err);
          }),
          schemas.refreshSpace(handle).catch((err) => {
            console.error('DatasetStore: space schema refresh failed', err);
            return [] as string[];
          }),
        ]);
        if (written.length) console.info(`DatasetStore: brought space schemas up to date — ${written.join(', ')}`);
        trace('dataset', 'switch:refresh', { dataset: uuid, written: written.length, ms: lap() });
      }

      // Everything above is a round trip, and the reader may have asked for somewhere else while
      // they ran. Publishing now would overwrite a newer switch with an older answer.
      if (requestedDataset !== uuid) return;
      /*
        The other way a switch goes stale: not superseded by a later switch, but by a later
        *navigation*. `requestedDataset` only knows about switches, so a switch the address bar asked
        for could not tell that the address had since moved on — and it published anyway, landing the
        previous space's data under the current space's URL. The caller that can answer "is this
        still what the address says" is the one that read the address, so it is asked here rather
        than guessed at.
      */
      if (options?.stillWanted && !options.stillWanted()) return;

      // SDNA is installed — switch immediately so WE templates render. WE model classes
      // are pre-registered at module load; foreign (non-WE) model resolution isn't needed
      // for the visible switch at all — it's only consumed below, in the background.
      // A new read starts below, so whatever was read before — even for this same space — is not it.
      const readIsLatest = entitiesRead.begin();
      batch(() => {
        setIsWeSpace(weSpace);
        setCurrentDataset(app);
        setEntitiesReadFor(null);
      });
      trace('dataset', 'switch:published', {
        dataset: uuid,
        totalMs: Math.round(performance.now() - started),
        sincePageStartMs: Math.round(performance.now()),
      });

      // Background: discover schemas foreign to the host (another app's entities synced into
      // this dataset) and publish their manifest — the port registers them for name-based query
      // resolution as part of the same pass.
      // Stale guard: if the user navigated away before this resolves, skip updates.
      void (async () => {
        try {
          const manifest = await schemas.foreignSchemas(handle);
          if (readIsLatest() && currentDataset()?.id === uuid)
            batch(() => {
              // By name, so a list of them — another app's classes in Social DNA — is in order with no sort of its own.
              setCurrentDatasetEntities([...manifest].sort((a, b) => a.name.localeCompare(b.name)));
              setEntitiesReadFor(uuid);
            });
        } catch (err) {
          console.warn('DatasetStore: foreignSchemas failed', err);
          // Read, and answered with nothing: a failed read must not hold back everything that waits on it.
          if (readIsLatest() && currentDataset()?.id === uuid)
            batch(() => {
              setCurrentDatasetEntities([]);
              setEntitiesReadFor(uuid);
            });
        }
      })();
    } catch (error) {
      console.error('DatasetStore: switchDataset error', error);
      // Switching is a navigation, and a navigation that silently does not happen is the worst
      // failure a store can have: the sidebar highlights the space, the URL says the space, and the
      // content is the previous one's. Console-only, this looked like the app ignoring a click.
      toastService.error('Could not open that space');
    }
  }

  const store: DatasetStore = {
    datasets,
    orderedDatasets,
    currentDataset,
    currentDatasetUri,
    currentDatasetCid,
    currentDatasetEntities,
    currentDatasetEntitiesLoaded,
    isWeSpace,
    joinedSpaceCids,
    datasetsLoaded,
    systemDatasetUuids,
    rootDataset,
    personalDataset,
    whenPersonalDataset,
    testDataset,
    globalDataset,
    marketplaceDataset,
    agentSettings,
    refreshAgentSettings,
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
      // Withdraws any switch still in flight as well — a join gate that had a space arrive behind
      // it a second later is the same bug `requestedDataset` exists for, pointed the other way.
      requestedDataset = null;
      setCurrentDataset(null);
      setIsWeSpace(false);
    },

    trackDataset,
    onDatasetRemoved: removedListeners.add,
    readDatasets,
    initSystemDatasets,
    loadDatasets,
    subscribeToChanges,
    getDatasetOrder,
  };

  return store;
}
