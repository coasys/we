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
import { sameDataset } from '@shared/datasetIdentity';
import { hostListeners, hostSlot } from '@shared/hostSlot';
import { containmentPredicate, gatherTranscriptTurns, type TurnRecord } from '@shared/interpretation/transcriptTurns';
import { provideModuleHostServices } from '@shared/registries/moduleHostServices';
import { moduleRegistry } from '@shared/registries/moduleRegistry';
import { getSeed } from '@shared/seedRegistry';
import { isSystemDataset, SYSTEM_DATASET_NAMES, SYSTEM_DATASETS } from '@shared/systemDatasets';
import { createCallConfigAccessors, createCallSessionFactory } from '@we/backend-ad4m';
import { datasetKey, type DatasetRef, type EntityManifestEntry, trace } from '@we/backend-shared';
import { toastService } from '@we/components/solid';
import { AgentSettings, type DatasetProxy, ExtractionPass, getEntitiesForPerspective } from '@we/entities';
import { Accessor, batch, createContext, createMemo, createSignal, onCleanup, ParentProps, useContext } from 'solid-js';

import { useSessionStore } from './SessionStore';

/** Where a pass hangs off the collection it read — `CollectionBlock.extractionPasses`. */
const EXTRACTION_PASS_PREDICATE = 'we://extraction_pass_record';

/**
 * The relation saying a record came out of reading a collection — `CollectionBlock.extracted`.
 *
 * Written beside containment rather than instead of it. `children` is ownership, and the call's
 * board gathers through it, so a record that stopped being a child would vanish from the board it
 * exists to appear on. This is the other fact about the same record: a model proposed it from the
 * conversation, rather than somebody typing it there.
 *
 * Named here because it is WE's vocabulary. The interpretation port takes the predicate as an
 * argument for the same reason it takes `parent` as one — a backend that hard-coded it would be
 * deciding what a relation in somebody else's graph is called.
 */
const EXTRACTED_PREDICATE = 'we://extracted';

export type { EntityManifestEntry, EntityManifestProperty } from '@we/backend-shared';

/**
 * A DatasetRef whose handle is narrowed to the model layer's dataset type — cast once where refs
 * enter the shell (this store), typed everywhere downstream. The described fields (id/name/
 * sharedUri/sharedId) are what UI logic reads; `handle` is what model calls consume.
 */
export interface AppDataset extends Omit<DatasetRef, 'handle'> {
  handle: DatasetProxy;
}

const toApp = (ref: DatasetRef): AppDataset => ref as AppDataset;

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
  /**
   * Write a partial update to the agent's settings. Resolves false when it did not land — and says
   * so with a toast, since most callers are `void`-ed and have no other channel.
   */
  updateAgentSettings: (updates: Partial<AgentSettings>) => Promise<boolean>;
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
  /**
   * Register a callback fired after a dataset is removed (locally or by any client).
   *
   * Returns the unsubscribe — hand it to `onCleanup` unless the subscriber genuinely lives as long
   * as the app. Without one this list only ever grew, and a store that unmounted kept being called
   * into a disposed scope. See `hostListeners`.
   */
  onDatasetRemoved: (cb: (uuid: string) => void) => () => void;
  initSystemDatasets: () => Promise<void>;
  loadDatasets: () => Promise<void>;
  subscribeToChanges: () => void;
  getDatasetOrder: () => string[];
  /**
   * Write down a pass the *standing watch* ran, once it has settled.
   *
   * The manual path writes its own, on the way back from a run that returned it everything. A
   * watched pass has no such moment: it happens inside the executor and is only ever reported, so
   * the record has to be written by whoever is watching the report — and that is
   * InterpretationStore, which is the one place subscribed to it.
   *
   * Here rather than there because this is where an `ExtractionPass` is written and where a call's
   * target list is resolved, and neither is worth a second copy. Called only for this agent's own
   * passes: every peer sees the same event, and a row per peer would be a history of who was
   * watching rather than of what ran.
   */
  recordWatchPass: (pass: {
    collection: string;
    outcome: string;
    recordCount: number;
    error?: string;
    prompt?: string;
    response?: string;
  }) => Promise<void>;
  /** SpaceStore supplies "does this space want calls interpreted automatically". Unset reads off. */
  provideAutoInterpretGate: (gate: () => boolean) => () => void;
  /**
   * ShapeStore supplies "which entities *could* be extracted here" — core vocabulary that declares
   * itself extractable, plus this space's adopted shapes. Unset reads as none.
   */
  provideExtractionCandidates: (candidates: () => string[]) => () => void;
  /**
   * SpaceStore supplies the two layers under that: what one call extracts, and how to change it.
   *
   * Both take a collection id, because the answer is per call — `forCall` resolves the call's own
   * list if its participants set one, else the space's default. Injected for the reason
   * `provideAutoInterpretGate` is: the answer lives on `Space` and on a record in the space, and
   * SpaceStore mounts below this one.
   *
   * Unset, `forCall` reads as the candidates — which keeps a host that has not wired this yet
   * behaving as it did rather than silently extracting nothing.
   */
  provideCallExtraction: (access: {
    forCall: (collectionId: string) => string[];
    setForCall: (collectionId: string, entity: string, on: boolean) => Promise<void>;
    /** Whether *this call* is extracted as it happens — its own answer, else the space's. */
    autoForCall: (collectionId: string) => boolean;
    setAutoForCall: (collectionId: string, on: boolean) => Promise<void>;
  }) => () => void;
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
  const [currentDatasetEntities, setCurrentDatasetEntities] = createSignal<EntityManifestEntry[]>([]);
  const [isWeSpace, setIsWeSpace] = createSignal<boolean>(false);
  const [rootDataset, setRootDataset] = createSignal<AppDataset | null>(null);
  const [personalDataset, setPersonalDataset] = createSignal<AppDataset | null>(null);
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

  /*
    Whether the current space wants its calls interpreted as they happen.

    Injected rather than read, for the same reason `TemplateStore.provideSpaceLookup` exists: the
    setting lives on a `Space`, SpaceStore layers on top of this store, and the dependency only
    points one way. Unset means off.
  */
  const autoInterpretGate = hostSlot<() => boolean>();

  /*
    What an extraction pass may write here — the same arrangement, one layer along.

    A space's own models are compiled and registered for its dataset by ShapeStore, which also sits
    above this one, so the list it computes has to arrive the same way the auto-extract setting
    does. Unset reads as *none* rather than as the two core classes: this replaced a constant, and a
    silent fallback to that constant would make a wiring failure look exactly like a space whose
    community had turned everything off.
  */
  const extractionCandidatesGate = hostSlot<() => string[]>();

  /*
    What one call extracts, and how to change it — the two layers below candidacy.

    Injected from SpaceStore, which owns `Space.extractionTargets` and the `CallExtraction` records
    and mounts below this store. Unset, `forCall` falls back to the candidates rather than to
    nothing: a host that has not wired this in should behave as it did before the layer existed.
  */
  const callExtraction = hostSlot<{
    forCall: (collectionId: string) => string[];
    setForCall: (collectionId: string, entity: string, on: boolean) => Promise<void>;
    autoForCall: (collectionId: string) => boolean;
    setAutoForCall: (collectionId: string, on: boolean) => Promise<void>;
  }>();

  /**
   * The class list one pass over this collection should ask for.
   *
   * Always intersected with the candidates, and that is not tidiness: a name the perspective has no
   * shape for fails `assertShapesInstalled` and takes the whole pass down, so a space default naming
   * a model since deleted, or a call list naming one whose `extractable` was withdrawn, has to
   * narrow the request rather than break it.
   */
  /**
   * Write down that a pass happened — see {@link ExtractionPass}.
   *
   * Best effort, and deliberately so: the pass is the thing that mattered and it has already run,
   * so a failed *note* about it must not turn a successful extraction into a rejected one. Logged
   * rather than swallowed, because a note that never lands is a history that quietly stays empty.
   *
   * Written by the host rather than by the module for the same reason `interpretCollection` is: the
   * containment predicate is resolved from the dataset's own models, which a module has no read for
   * and must never learn.
   */
  async function recordPass(
    handle: DatasetProxy,
    collectionId: string,
    pass: {
      outcome: string;
      recordCount: number;
      targets: string[];
      error?: string;
      /** What started it. Defaults to a press, which is what the only writer used to be. */
      trigger?: 'manual' | 'auto';
      prompt?: string;
      response?: string;
    },
  ): Promise<void> {
    try {
      await ExtractionPass.create(
        handle as never,
        {
          outcome: pass.outcome,
          recordCount: pass.recordCount,
          targets: JSON.stringify(pass.targets),
          error: pass.error ?? '',
          trigger: pass.trigger ?? 'manual',
          prompt: pass.prompt ?? '',
          response: pass.response ?? '',
        } as never,
        { parent: { id: collectionId, predicate: EXTRACTION_PASS_PREDICATE } } as never,
      );
    } catch (error) {
      console.warn('[interpretation] could not record that a pass ran', error);
    }
  }

  const targetsForCollection = (collectionId: string): string[] => {
    const candidates = extractionCandidatesGate.get()?.() ?? [];
    const chosen = callExtraction.get()?.forCall(collectionId);
    if (!chosen) return candidates;
    return candidates.filter((entity) => chosen.includes(entity));
  };

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
      // Late-bound call session factory — the call module reads it as `createBackend`. All three
      // accessors dereference at join time, so the factory is safe to construct before the backend
      // connects or the user navigates to a space.
      createCallBackend: createCallSessionFactory(
        () => session.client(),
        () => currentDataset()?.handle ?? null,
        () => session.me()?.did ?? null,
      ),
      // Call config accessors — topology defaults stored on Social DNA.
      // Same late-binding pattern: every accessor reads the current dataset at call time.
      ...(() => {
        const accessors = createCallConfigAccessors(() => currentDataset()?.handle ?? null);
        return {
          getCallConfig: accessors.getCallConfig,
          setCallConfig: accessors.setCallConfig,
          getAvailableSfuNodes: accessors.getAvailableSfuNodes,
          callConfigSupported: accessors.callConfigSupported,
        };
      })(),
      // Read through `backendPorts()` on every call rather than captured: the backend connects after
      // this store is constructed, and a backend that cannot transcribe simply never sets it.
      transcription: {
        models: async () => (await session.backendPorts()?.transcription?.models()) ?? [],
        open: async (modelId, onText, tuning) => {
          const port = session.backendPorts()?.transcription;
          if (!port) throw new Error('transcription: this backend cannot transcribe');
          return port.open(modelId, onText, tuning);
        },
        offeredModel: () => session.backendPorts()?.transcription?.offeredModel?.() ?? null,
        installOfferedModel: async () => {
          const install = session.backendPorts()?.transcription?.installOfferedModel;
          if (!install) throw new Error('transcription: this backend cannot install a model');
          return install();
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
      },

      /*
        What this call extracts, and what else it could — for a module that offers the choice.

        One list of `{ entity, selected }` rather than two arrays, because the surface that renders it
        is a row of toggles and a schema cannot join two lists to decide which are ticked. The module
        never sees the resolution: candidacy, the space's default and the call's own list are three
        questions it has no business knowing about, and it is handed the answer.
      */
      extractionTargets: (collectionId: string) => {
        const active = targetsForCollection(collectionId);
        return (extractionCandidatesGate.get()?.() ?? []).map((entity) => ({
          entity,
          selected: active.includes(entity),
        }));
      },
      setAutoInterpret: async (collectionId: string, on: boolean) => {
        const extraction = callExtraction.get();
        if (!extraction) throw new Error('interpretation: this host cannot record a call’s extraction settings');
        await extraction.setAutoForCall(collectionId, on);
      },
      setExtractionTarget: async (collectionId: string, entity: string, on: boolean) => {
        const extraction = callExtraction.get();
        if (!extraction) throw new Error('interpretation: this host cannot record a call’s extraction targets');
        await extraction.setForCall(collectionId, entity, on);
      },

      // Gathering the turns is the host's half of the job: the port takes turns, and a module has no
      // read with which to produce them. Parenting what comes back onto the same collection is not
      // optional dressing — an unparented TaskBlock is a real record that no route lists, so an
      // extraction that skipped it would look exactly like one that found nothing.
      interpretCollection: async (collectionId) => {
        const port = session.backendPorts()?.interpretation;
        if (!port) throw new Error('interpretation: this backend cannot interpret');
        const dataset = currentDataset();
        if (!dataset) throw new Error('interpretation: no dataset to interpret into');

        const modelFor = (entity: string) => getEntitiesForPerspective(entity, dataset.handle);
        const predicate = containmentPredicate(modelFor, currentDatasetEntities());
        if (!predicate)
          throw new Error('interpretation: this space has no collection schema to read a transcript from');

        const turns = await gatherTranscriptTurns(
          {
            modelFor: (entity) => modelFor(entity) as TurnRecord | undefined,
            handle: dataset.handle,
            containmentPredicate: predicate,
          },
          collectionId,
        );

        // The host resolves the class list, because the three layers that decide it — candidacy, the
        // space's default, this call's own — are all host state. A module names a collection and
        // nothing else, exactly as it does for the watch id and the containment predicate.
        const classes = targetsForCollection(collectionId);
        try {
          const result = await port.interpret(dataset.handle, turns, {
            classes,
            parent: { id: collectionId, predicate },
            provenance: { id: collectionId, predicate: EXTRACTED_PREDICATE },
          });
          await recordPass(dataset.handle, collectionId, {
            // Nothing to look for is not a failure and not a quiet meeting — it is a call whose
            // targets are all switched off, which reads as "0 records" and blames the conversation
            // unless it is said.
            outcome: classes.length === 0 ? 'skipped' : 'done',
            recordCount: result.ids.length,
            targets: classes,
            // Handed back by the run rather than found on the progress feed afterwards, so one
            // write holds the whole pass — see `prompt` on the result.
            prompt: result.prompt,
            response: result.response,
          });
          return result;
        } catch (error) {
          /*
            Written before rethrowing, because a failure is the pass most worth having a record of.

            Live, a failure is reported by the readout and then lost with it: reload, and a call that
            could not be read is indistinguishable from one that was read and found nothing. That is
            the pair somebody reviewing a meeting most needs told apart, and it is the one the live
            feed cannot keep.
          */
          await recordPass(dataset.handle, collectionId, {
            outcome: 'failed',
            recordCount: 0,
            targets: classes,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      },

      /*
        The staged suggestions belonging to one call, rather than to the whole space.

        Here rather than on the port wrapper above for the same reason `interpretCollection` is: the
        scope is a containment predicate, and resolving one needs the dataset's models — which the
        port has not got and a module must never learn.

        A proposal outlives the pass that made it, so an unresolved one from this morning's call is
        still staged this afternoon. Unscoped, it arrived in the next call's review list looking like
        something that call had just found — and accepting it committed a record parented to the
        earlier call, which is real, correct, and invisible on the board of the call the reviewer is
        actually sitting in.

        The dataset is the *caller's*, not `currentDataset()`: a call outlives the space on screen,
        and answering about wherever the reader wandered to is the bug `targeted` exists to prevent.
        The predicate is resolved against that same dataset for the same reason.
      */
      proposalsForCollection: async (dataset, collectionId) => {
        const port = session.backendPorts()?.interpretation;
        if (!port) return [];
        const modelFor = (entity: string) => getEntitiesForPerspective(entity, dataset);
        const predicate = containmentPredicate(modelFor, currentDatasetEntities());
        // Unscoped rather than empty when containment cannot be named here: too many suggestions is
        // a nuisance, none is a review surface that looks broken.
        if (!predicate) return port.proposals(dataset);
        return port.proposals(dataset, { parent: { id: collectionId, predicate } });
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
      watchCollection: async (collectionId) => {
        const port = session.backendPorts()?.interpretation;
        if (!port?.watch) throw new Error('interpretation: this backend cannot run a standing watch');
        // The community's decision, read through a gate SpaceStore supplies — this store sits below
        // it and cannot reach a Space. Absent (no gate provided yet, or no space) reads as off, which
        // is the right way round for something that spends somebody's LLM budget.
        /*
          Asked about *this call*, not about the space.

          The space's switch is still the answer for a call whose participants have not decided —
          `autoForCall` resolves that — but a call that has been turned off has to stay off, and a
          gate that could only see the space would re-register the watch on the next tick. Falls back
          to the space-wide gate where the call layer has not been wired, which keeps a host that
          predates it behaving as it did.
        */
        const auto = callExtraction.get()?.autoForCall(collectionId) ?? autoInterpretGate.get()?.();
        if (!auto) throw new Error('interpretation: automatic extraction is off for this call');
        const dataset = currentDataset();
        if (!dataset) throw new Error('interpretation: no dataset to interpret into');

        const modelFor = (entity: string) => getEntitiesForPerspective(entity, dataset.handle);
        const predicate = containmentPredicate(modelFor, currentDatasetEntities());
        if (!predicate)
          throw new Error('interpretation: this space has no collection schema to read a transcript from');

        const classes = targetsForCollection(collectionId);
        // Refused rather than registered empty: the executor rejects a processor with no classes, and
        // "this space has marked nothing for extraction" is a sentence worth saying in its own words.
        if (!classes.length) throw new Error('interpretation: nothing in this space is marked for AI extraction');

        await port.watch(dataset.handle, {
          watchId: watchIdFor(collectionId),
          classes,
          parent: { id: collectionId, predicate },
          provenance: { id: collectionId, predicate: EXTRACTED_PREDICATE },
        });
      },

      /*
        Repair anything a standing pass minted without an edge.

        Runs when a call is opened rather than on a timer, because that is the moment somebody is
        about to look: the records exist either way, and what is missing is only their place in the
        call. Returns the count so a caller can say nothing when there was nothing to do.
      */
      reconcileCollection: async (collectionId) => {
        const port = session.backendPorts()?.interpretation;
        const dataset = currentDataset();
        if (!port?.reconcile || !dataset) return 0;

        const modelFor = (entity: string) => getEntitiesForPerspective(entity, dataset.handle);
        const predicate = containmentPredicate(modelFor, currentDatasetEntities());
        if (!predicate) return 0;

        return port.reconcile(dataset.handle, {
          classes: targetsForCollection(collectionId),
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
    }),
  );

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
      .filter((d) => isSystemDataset(d.name))
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
  async function loadDatasets(): Promise<void> {
    const lifecycle = session.lifecycle();
    if (!lifecycle) return;
    try {
      const refs = (await lifecycle.list()).map(toApp);
      setDatasets(refs);

      // Bootstrap dataset order on first load (when no order has been saved yet)
      if (!agentSettings()?.datasetOrder) {
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
  async function initSystemDatasets(): Promise<void> {
    const lifecycle = session.lifecycle();
    if (!lifecycle) return;
    let refs: AppDataset[];
    try {
      refs = (await lifecycle.list()).map(toApp);
    } catch (error) {
      console.error('DatasetStore: initSystemDatasets error', error);
      return;
    }

    try {
      await initRootDataset(refs);
    } catch (error) {
      console.error('DatasetStore: root dataset error', error);
    }
    try {
      await initPersonalDataset(refs);
    } catch (error) {
      console.error('DatasetStore: personal dataset error', error);
    }
    try {
      const existingTest = refs.find((d) => d.name === SYSTEM_DATASET_NAMES.test);
      setTestDataset(existingTest ?? toApp(await lifecycle.create(SYSTEM_DATASET_NAMES.test)));
    } catch (error) {
      console.error('DatasetStore: test dataset error', error);
    }
  }

  /**
   * The root: the app's configuration, and nothing a person made.
   *
   * Its schema is reinstalled on every boot so a model added after the dataset was created is there
   * to query. Module entities no longer install here — an agent-scoped module's records are the
   * agent's own things, and they live in the personal space. See `systemDatasets.ts`.
   */
  async function initRootDataset(refs: AppDataset[]): Promise<void> {
    const lifecycle = session.lifecycle()!;
    const schemas = session.backendPorts()!.schemas;
    const existing = refs.find((d) => d.name === SYSTEM_DATASET_NAMES.root);

    if (existing) {
      await schemas.installRoot(existing.handle);
      setRootDataset(existing);
      const settings = await AgentSettings.findOne(existing.handle);
      if (settings) setAgentSettings(settings);
      return;
    }

    trace('dataset', 'root:create');
    const created = toApp(await lifecycle.create(SYSTEM_DATASET_NAMES.root));
    await schemas.installRoot(created.handle);
    const settings = await AgentSettings.create(created.handle, {
      currentTemplateId: 'default',
      currentThemeId: 'dark',
      defaultThemeId: 'dark',
    });
    setRootDataset(created);
    setAgentSettings(settings);
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
   * Published only once its schema is in, since the first thing a reader does is query it — the
   * Pocket's effect fires the moment `personalDataset` is set, and a query ahead of the install
   * fails with "No SHACL shape" rather than returning nothing.
   *
   * No `Space` record. Nothing yet navigates into this dataset, and a record would put it in every
   * list that reads `Space` — which is exactly the listing a system dataset stays out of.
   */
  async function initPersonalDataset(refs: AppDataset[]): Promise<void> {
    const lifecycle = session.lifecycle()!;
    const schemas = session.backendPorts()!.schemas;
    const existing = refs.find((d) => d.name === SYSTEM_DATASET_NAMES.personal);
    const personal = existing ?? toApp(await lifecycle.create(SYSTEM_DATASET_NAMES.personal));
    const moduleSchemas = [...moduleRegistry.moduleSchemas(schemas), ...moduleRegistry.agentSchemas(schemas)];

    if (!existing || !(await schemas.hasCoreSchema(personal.handle))) {
      await schemas.installSpace(personal.handle, moduleSchemas);
    } else {
      // The same two catches a space gets on every switch — see `switchDataset`.
      await schemas.installModules(personal.handle, moduleSchemas);
      await schemas.refreshSpace(personal.handle).catch((err) => {
        console.error('DatasetStore: personal space schema refresh failed', err);
      });
    }
    setPersonalDataset(personal);
  }

  /**
   * Write a partial update to the agent's settings, and say so if it did not land.
   *
   * ## Why this one function is worth the ceremony
   *
   * Nearly every persisted preference in the app goes through here — the default template and
   * theme, both sides of the Follow-system pair, the Claude API key, the dataset order, which
   * modules are installed. Most callers are `void`-ed, so nothing awaited the write and nothing
   * could have noticed it failing. `Object.assign` had already mutated the in-memory model by then,
   * so a failed save left the app showing the new value, the perspective holding the old one, and
   * the two disagreeing until a reload — which is the worst of the three possible outcomes, because
   * it is the one nobody investigates.
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
  async function updateAgentSettings(updates: Partial<AgentSettings>): Promise<boolean> {
    const settings = agentSettings();
    if (!settings) return false;

    const keys = Object.keys(updates) as (keyof AgentSettings)[];
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
      return;
    }
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
   * another. They finish in whatever order the network decides, and the last to finish used to be
   * the one on screen — so a switch nobody wanted any more could land on top of the one they did,
   * leaving the sidebar and the URL naming one space and every query reading another.
   *
   * Requested rather than started, because that is the question with an answer: "is this still what
   * the reader asked for". Whichever ask is latest wins, however long it takes to arrive.
   */
  let requestedDataset: string | null = null;

  async function switchDataset(uuid: string): Promise<void> {
    const lifecycle = session.lifecycle();
    if (!lifecycle) return;
    requestedDataset = uuid;

    try {
      const ref = await lifecycle.get(uuid);
      if (!ref || requestedDataset !== uuid) return;
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

      // Everything above is a round trip, and the reader may have asked for somewhere else while
      // they ran. Publishing now would overwrite a newer switch with an older answer.
      if (requestedDataset !== uuid) return;

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
          if (currentDataset()?.id === uuid) setCurrentDatasetEntities(manifest);
        } catch (err) {
          console.warn('DatasetStore: foreignSchemas failed', err);
          if (currentDataset()?.id === uuid) setCurrentDatasetEntities([]);
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
      trace('dataset', 'sdna:cleanup', { dataset: targetUuid, summary });
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
    currentDatasetEntities,
    isWeSpace,
    joinedSpaceCids,
    datasetsLoaded,
    systemDatasetUuids,
    rootDataset,
    personalDataset,
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
      // Withdraws any switch still in flight as well — a join gate that had a space arrive behind
      // it a second later is the same bug `requestedDataset` exists for, pointed the other way.
      requestedDataset = null;
      setCurrentDataset(null);
      setIsWeSpace(false);
    },
    cleanupSpaceSdna,

    trackDataset,
    onDatasetRemoved: removedListeners.add,
    initSystemDatasets,
    loadDatasets,
    subscribeToChanges,
    getDatasetOrder,
    recordWatchPass: async (pass) => {
      const dataset = currentDataset();
      if (!dataset || !pass.collection) return;
      await recordPass(dataset.handle, pass.collection, {
        outcome: pass.outcome,
        recordCount: pass.recordCount,
        // Resolved here rather than carried on the event: what a call looks for is three layers of
        // host state, and the executor is told class URIs rather than the model names this stores.
        targets: targetsForCollection(pass.collection),
        error: pass.error,
        trigger: 'auto',
        prompt: pass.prompt,
        response: pass.response,
      });
    },
    provideAutoInterpretGate: autoInterpretGate.provide,
    provideExtractionCandidates: extractionCandidatesGate.provide,
    provideCallExtraction: callExtraction.provide,
  };

  return <DatasetContext.Provider value={store}>{props.children}</DatasetContext.Provider>;
}

export function useDatasetStore(): DatasetStore {
  const context = useContext(DatasetContext);
  if (!context) throw new Error('useDatasetStore must be used within the DatasetStoreProvider');
  return context;
}
