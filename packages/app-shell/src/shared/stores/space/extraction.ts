/**
 * What a space extracts: whether a new collection starts out interpreted as it grows and for which
 * models, each asked-about collection's own answer followed live, the space's standing watch on the
 * messages typed straight into it, and the extraction runtime modules reach. Part of `SpaceStore` —
 * see `../SpaceStore.ts`.
 *
 * The space's defaults are columns on its record (`autoInterpret`, `extractionTargets`); a collection
 * holds a copy of its own, made when it was (see `collectionInterpretation` in `@we/entities`).
 */
import {
  CollectionBlock,
  type DatasetProxy,
  entityListOf,
  getEntityForDataset,
  LEGACY_INTERPRETATION_TARGETS,
  resolveCollectionAutoInterpret,
  resolveCollectionInterpretationTargets,
  resolveSpaceInterpretationTargets,
  Space,
} from '@we/entities';

import { updatingSignal } from '../../distinctSignal';
import { followLive } from '../../followLive';
import { provideModuleHostServices } from '../../registries/moduleHostServices';
import { isSpaceSelf, spaceSelfWhere } from '../../spaceSync';
import type { ShapeStore } from '../ShapeStore';
import type { SpaceStore } from '../SpaceStore';
import type { SpaceContext } from './context';
import { createInterpretationRuntime } from './interpretationRuntime';
import type { SpaceNavigation } from './navigation';
import type { SpaceList } from './spaces';
import type { SpaceWrites } from './writes';

/** What a collection's extraction settings are read from — see `autoInterpretFor`. */
const COLLECTION_SETTINGS_FIELDS = ['autoExtract', 'extractionTargets'] as const;

export interface SpaceExtractionDeps extends SpaceContext {
  shapeStore: Pick<
    ShapeStore,
    | 'interpretationCandidates'
    | 'interpretationCandidatesLoaded'
    | 'interpretationCandidatesFor'
    | 'provideInterpretationEnroller'
  >;
  spaces: Pick<SpaceList, 'heldSpace'>;
  navigation: { members: Pick<SpaceNavigation['members'], 'currentSpace' | 'root'> };
  writes: Pick<
    SpaceWrites,
    'writeSpaceFields' | 'publishSpaceFields' | 'defaultSaveFor' | 'queueDefaultWrite' | 'endDefaultSave'
  >;
  /**
   * Whether this agent administers the space on screen — the roles' answer, which decides who may
   * change what the space's own collection extracts. Asked when somebody changes it.
   */
  canAdministerCurrentSpace: () => boolean;
}

export function createSpaceExtraction(deps: SpaceExtractionDeps) {
  const {
    reactivity,
    toasts,
    sessionStore: session,
    datasetStore,
    shapeStore,
    spaces,
    navigation,
    writes,
    runCore,
    targetDataset,
    canAdministerCurrentSpace,
  } = deps;
  const { memo, effect, untrack, batch, onCleanup } = reactivity;
  const { heldSpace } = spaces;
  const { currentSpace, root: spaceRoot } = navigation.members;
  const { writeSpaceFields, publishSpaceFields, defaultSaveFor, queueDefaultWrite, endDefaultSave } = writes;

  /*
    What a new collection here starts with — whether it is interpreted as it grows.

    Read off the space rather than stored here, so it answers for whichever space is on screen. Absent
    space reads false: a decision nobody has made is not a decision to spend somebody's LLM budget.

    A default and nothing more. Each collection holds its own answer, copied from this when it was
    made (`CollectionBlock.autoExtract`); see `collectionInterpretation` in `@we/entities` for why a copy.
  */
  const autoInterpret = memo<boolean>(() => currentSpace()?.autoInterpret === true);

  /*
    Which candidates a new collection here starts with.

    Intersected with the candidates rather than trusted as stored, and that is load bearing: a name
    the dataset has no shape for fails `assertShapesInstalled` and takes the whole pass down, so
    a list naming a model since deleted — or one whose `extractable` was withdrawn in a release —
    has to narrow quietly instead of breaking extraction for the space.

    Order follows the candidates, so a settings list reads the same way every time rather than in
    whatever order somebody happened to tick things.
  */
  const interpretationTargets = memo<string[]>(() =>
    resolveSpaceInterpretationTargets(shapeStore.interpretationCandidates(), currentSpace()?.extractionTargets),
  );

  /**
   * Each asked-about collection's own extraction settings, as stored on it, by id.
   *
   * Read on demand rather than for every collection in the space: a space holds a call for every
   * meeting it ever had, and only the ones on screen are asked about — the call somebody is in, the
   * one a panel names, and the space's own collection. Followed while asked, so a participant
   * switching a call off is seen by everybody in it.
   *
   * `loaded` is separate from the settings, because an answer that has not arrived must not be
   * mistaken for "made without a copy" — which defers to the space, and would register a standing
   * watch for a call its participants had switched off for the moment it took to read.
   */
  const [collectionSettings, setCollectionSettings, updateCollectionSettings] = updatingSignal<
    Record<string, { autoExtract?: boolean; extractionTargets?: unknown }>
  >(reactivity, {});
  const [loadedCollections, setLoadedCollections] = reactivity.signal<ReadonlySet<string>>(new Set());
  const [askedCollections, setAskedCollections, updateAskedCollections] = updatingSignal<string[]>(reactivity, []);

  /*
    Asking is a read, and reads happen inside computations. Writing the asked list there would be a
    signal written while it is being read, so the request is posted for after the read instead.
  */
  function askCollection(collectionId: string): void {
    if (!collectionId || untrack(askedCollections).includes(collectionId)) return;
    queueMicrotask(() => {
      updateAskedCollections((ids) => (ids.includes(collectionId) ? ids : [...ids, collectionId]));
    });
  }

  /*
    Follow what the asked-about collections extract, in the space on screen.

    One effect with the forgetting, because the two are ordered: a new space's collections are a
    different set, so what was asked about the last one is dropped before anything is followed here —
    and a follow of the last space's ids in this one would be a read of records it does not hold.
  */
  let followingIn: unknown = undefined;
  effect(() => {
    const handle = datasetStore.currentDataset()?.handle;
    const here = handle && datasetStore.isWeSpace() ? handle : null;
    if (here !== followingIn) {
      followingIn = here;
      batch(() => {
        setCollectionSettings({});
        setLoadedCollections(new Set<string>());
        setAskedCollections([]);
      });
    }
    const ids = askedCollections();
    if (!here || !ids.length) return;
    /*
      Only the two fields the settings are made of. Without `properties` a read hydrates every field,
      `children` among them — and the space's own collection holds everything in the space.
    */
    const query = { where: { id: ids }, properties: [...COLLECTION_SETTINGS_FIELDS] };
    const apply = (rows: CollectionBlock[]) => {
      updateCollectionSettings((current) => {
        const next = { ...current };
        for (const row of rows) {
          next[row.id] = { autoExtract: row.autoExtract, extractionTargets: row.extractionTargets };
        }
        return next;
      });
    };
    // The query asks what a read would ask, so its first result is the settings, whole, and a change
    // after that is applied the same way.
    followLive(reactivity, CollectionBlock.query(here, query), {
      store: 'SpaceStore',
      what: 'what these collections extract',
      apply: (rows, opened) => {
        apply(rows);
        if (opened) setLoadedCollections(new Set(ids));
      },
      // Loaded only once the stored settings are in: without them `autoInterpretFor` would answer
      // with the space's default for a collection stored as off. If this read fails too they stay
      // unloaded, and it answers `false`.
      stored: { read: () => CollectionBlock.findAll(here, query as never) },
    });
  });

  // The space's own collection is always asked about: its messages are the space's standing watch.
  effect(() => {
    const root = spaceRoot();
    if (root && datasetStore.currentDataset()?.handle && datasetStore.isWeSpace()) askCollection(root);
  });

  /**
   * Whether one collection is interpreted as it grows: its own answer, or — for a collection made
   * without one — the space's default. False until its settings have been read.
   */
  const autoInterpretFor = (collectionId: string): boolean => {
    if (!collectionId) return false;
    askCollection(collectionId);
    if (!loadedCollections().has(collectionId)) return false;
    return resolveCollectionAutoInterpret(autoInterpret(), collectionSettings()[collectionId]?.autoExtract);
  };

  /** The models one collection extracts: its own list, else the space's default, narrowed to the candidates. */
  const interpretationTargetsFor = (collectionId: string): string[] => {
    askCollection(collectionId);
    return resolveCollectionInterpretationTargets(
      shapeStore.interpretationCandidates(),
      currentSpace()?.extractionTargets,
      collectionSettings()[collectionId]?.extractionTargets,
    );
  };

  /**
   * Whether this agent may change what one collection extracts.
   *
   * A call's participants decide for their call, which is everybody who can see it. The space's own
   * collection is the community's — the messages typed outside any call — so it is whoever
   * administers the space, exactly as its defaults are.
   */
  const canSetInterpretationFor = (collectionId: string): boolean =>
    Boolean(collectionId) && (collectionId !== spaceRoot() || canAdministerCurrentSpace());

  /**
   * Change what one collection is interpreted for — `core.setCollectionInterpretation` — showing
   * `shown` on the press: the subscription answers a moment later, and a switch that waits for it
   * reads as one that did not take.
   */
  async function writeCollectionSettings(
    collectionId: string,
    shown: { autoExtract?: boolean; extractionTargets?: string[] },
    args: Record<string, unknown>,
    what: string,
  ): Promise<void> {
    const dataset = datasetStore.currentDataset();
    if (!dataset || !collectionId) return;
    if (!canSetInterpretationFor(collectionId)) {
      toasts.error(`Only someone who administers this space can change ${what} outside calls.`);
      return;
    }
    const before = collectionSettings()[collectionId];
    updateCollectionSettings((current) => ({ ...current, [collectionId]: { ...current[collectionId], ...shown } }));
    try {
      await runCore('setCollectionInterpretation', { collection: collectionId, ...args }, dataset.handle);
    } catch (error) {
      updateCollectionSettings((current) => ({ ...current, [collectionId]: before ?? {} }));
      console.error(`SpaceStore: could not save ${what}`, error);
      toasts.error(`Could not save ${what}.`);
      throw error;
    }
  }

  /**
   * Turn automatic interpretation on or off for one collection, for everyone in it. Leaves the space's
   * default alone — that is where the *next* conversation starts, and this is about this one.
   * Does not stop a pass already running: those tokens are spent.
   */
  const setAutoInterpretFor = (collectionId: string, on: boolean): Promise<void> =>
    writeCollectionSettings(
      collectionId,
      { autoExtract: on },
      { autoExtract: on },
      'whether this is interpreted as it happens',
    );

  /**
   * Add or remove one model from what a collection extracts, for everyone in it.
   *
   * A collection made without a list of its own starts from what it resolves to now — the space's
   * default — so the first toggle pins that, the rule `setModuleEnabled` follows.
   */
  async function setInterpretationTargetFor(collectionId: string, entity: string, on: boolean): Promise<void> {
    const resolved = interpretationTargetsFor(collectionId);
    const next = on ? [...new Set([...resolved, entity])] : resolved.filter((name) => name !== entity);
    await writeCollectionSettings(
      collectionId,
      { extractionTargets: next },
      { entity, on, fallback: resolved },
      'what this interprets',
    );
  }

  /**
   * One collection's extraction answers, read for the dataset named rather than the space on screen.
   *
   * The live reads above follow whichever space is showing and reset on every switch; a watch
   * registered for a call in a space nobody is looking at, and an export laid out after a save
   * dialog, both answer about the collection's own dataset. The space's defaults come off its
   * record there, so a collection made without a copy defers to its own space — and narrowing asks
   * the dataset's own registry, since a name it cannot resolve has no shape there and would take
   * the whole pass down.
   */
  async function collectionInterpretationFor(
    handle: DatasetProxy,
    collectionId: string,
  ): Promise<{ spaceName?: string; spaceTargets: string[]; auto: boolean; classes: string[] }> {
    const [row]: CollectionBlock[] = await CollectionBlock.findAll(handle, {
      where: { id: [collectionId] },
      properties: [...COLLECTION_SETTINGS_FIELDS],
    } as never);
    const ds = datasetStore.datasets().find((d) => d.handle === handle);
    const onScreen = ds !== undefined && datasetStore.currentDataset()?.id === ds.id;
    /*
      Where the freshest answer lives, per dataset.

      For the space on screen the live reads are the freshest — they hold a setting that has been
      published but whose write has not landed yet — and they follow the stored record the moment
      it changes, so preferring them loses nothing. For a dataset nobody is looking at the live
      reads answer for a different space and the sidebar cache says what the record said when this
      client last visited — a peer switching automatic interpretation off after that would register a
      watch the community already turned off — so the space's own record is read where it lives,
      through the handle.
    */
    const shown = currentSpace();
    /*
      The live answers are taken now, before the next await: the space record's read below can
      outlive the dataset on screen, and a switch landing inside it leaves the live signals
      answering for the space that replaced this one — another space's collections and candidates,
      read with this one's row and handle still in hand. What is live is read once, while the
      dataset on screen is still provably this one's; everything after the await is the asking
      dataset's own.
    */
    const shownSpace = onScreen && shown && ds && isSpaceSelf(shown, ds) ? shown : undefined;
    const liveSettings =
      onScreen && loadedCollections().has(collectionId) ? collectionSettings()[collectionId] : undefined;
    // Only once this dataset's own list has published: until then the signal still holds the space just left's.
    const liveCandidates =
      onScreen && shapeStore.interpretationCandidatesLoaded() ? shapeStore.interpretationCandidates() : undefined;
    const space = shownSpace ?? (ds ? (await Space.findAll(handle, { where: spaceSelfWhere(ds) }))[0] : undefined);
    const own = liveSettings ?? { autoExtract: row?.autoExtract, extractionTargets: row?.extractionTargets };
    /*
      Narrowed by candidacy — the same rule the live list intersects, read for this dataset —
      not by resolvability: an adopted model whose manifest is not extractable resolves in the
      registry all the same, and a check that only asks "does the name resolve" kept it. The
      resolvable check stays: a candidate whose class is not installed in this dataset yet has no
      shape there and would take the whole pass down.

      The candidates split the same way the records do: the live list for the dataset on screen
      once it has loaded — re-reading what the switch already read would only wait on it again —
      and the asking dataset's own read for one nobody is looking at or whose list is still arriving.
    */
    const { candidates, installed } = liveCandidates
      ? { candidates: liveCandidates, installed: [] }
      : await shapeStore.interpretationCandidatesFor(handle);
    // A class the dataset already had is installed though this session never registered it — only
    // a switch does — and the executor resolves it from its own shape, so it stays.
    const resolvable = (entity: string) =>
      installed.includes(entity) || getEntityForDataset(entity, handle) !== undefined;
    return {
      spaceName: space?.name,
      spaceTargets: resolveSpaceInterpretationTargets(candidates, space?.extractionTargets).filter(resolvable),
      // A record that could not be read has not said it inherits: the space's default must not start
      // a watch the record's own switch may forbid, and nothing re-registers it once the record arrives.
      auto:
        (liveSettings !== undefined || row !== undefined) &&
        resolveCollectionAutoInterpret(space?.autoInterpret === true, own.autoExtract),
      classes: resolveCollectionInterpretationTargets(
        candidates,
        space?.extractionTargets,
        own.extractionTargets,
      ).filter(resolvable),
    };
  }

  /*
    The space's own standing watch: the messages typed straight into it, outside any call.

    Calls are watched by the transcribe module for as long as somebody is in them. This one belongs
    to the space, so it is the space collection's own setting that decides it. Registered by every
    member who enters, which is one registration — it is keyed on the collection, and the engine
    keeps one row per key in the shared dataset. Removed when the setting is switched off while
    somebody is here to see it change; a member arriving later to a space with it off has nothing
    to remove.

    What it reads and where it files are the same rules every pass follows: what a person wrote, and
    the space collection — with the collection itself as the provenance, so items from the feed are
    told apart from items from a call. Its passes batch, by the engine's defaults: a few messages, or
    a quiet spell, or two minutes at the most.
  */
  const interpretation = createInterpretationRuntime({
    reactivity,
    port: () => session.backendPorts()?.interpretation,
    dataset: () => datasetStore.currentDataset()?.handle ?? null,
    candidates: () => shapeStore.interpretationCandidates(),
    candidatesLoaded: () => shapeStore.interpretationCandidatesLoaded(),
    targetsFor: interpretationTargetsFor,
    setTargetFor: setInterpretationTargetFor,
    setAutoFor: setAutoInterpretFor,
    collectionAnswers: collectionInterpretationFor,
  });
  onCleanup(provideModuleHostServices(interpretation.services));

  let looseWatchOn: { root: string; handle: unknown } | null = null;
  effect(() => {
    const root = spaceRoot();
    const handle = datasetStore.currentDataset()?.handle;
    const wanted = Boolean(root && handle && autoInterpretFor(root));
    // Read so a change to what it extracts re-registers: the watch's class list is fixed at
    // registration, and the port replaces it when the list differs.
    if (root) void interpretationTargetsFor(root);
    if (wanted) {
      /*
        Not before the list is whole. Core vocabulary is known at once and the space's own models and
        foreign classes a few round trips later, so registering on the first answer wrote a watch
        without them and then, when they came, removed it and wrote it again — on every visit, from
        every member. Registered once it is whole, the port finds what is stored already says the
        same and writes nothing.

        Recorded as on before the wait, all the same: the watch is one row in the shared graph and
        may be there from an earlier visit, so switching off during the wait must still remove it.
      */
      looseWatchOn = { root, handle };
      if (!shapeStore.interpretationCandidatesLoaded()) return;
      void interpretation.watchConversation(root, handle).catch((error: unknown) => {
        console.info('SpaceStore: the space’s loose messages cannot be watched here', error);
      });
      return;
    }
    const was = looseWatchOn;
    looseWatchOn = null;
    // Only on the way from on to off, and only for the space it was on in: leaving a space is not
    // switching its watch off.
    if (was && was.root === root && was.handle === handle) {
      void interpretation.unwatchConversation(was.root, was.handle).catch(() => {});
    }
  });

  /*
    Ticking "let AI create these" in the model wizard is this space saying yes — see
    `ShapeStore.provideInterpretationEnroller`. Handed upward because ShapeStore is composed before
    this one and cannot reach a `Space`.
  */
  onCleanup(shapeStore.provideInterpretationEnroller((entity) => setInterpretationTarget(entity, true)));

  /**
   * Whether a new collection in a space starts out interpreted as it grows. A default: a conversation
   * already under way keeps its own answer.
   *
   * Takes the value rather than toggling, so a `we-switch` can pass `$event.detail` straight
   * through — the same reason `setThemeScopeGlobal` does. Same failure handling as
   * `setModuleEnabled`: a switch that reports success without persisting is worse than one that
   * fails visibly, because the next member to open the page sees the old decision.
   */
  async function setAutoInterpret(enabled: boolean, spaceUuid?: string) {
    const ds = targetDataset(spaceUuid);
    const space = ds ? heldSpace(ds) : undefined;
    if (!ds || !space) return;
    await writeSpaceFields(ds, space, { autoInterpret: enabled });
  }

  /**
   * Add or remove one model from what this community's calls start out extracting.
   *
   * Writes the resolved list, exactly as `setModuleEnabled` does and for the same two reasons: the
   * first toggle pins whatever was on by fallback — so a space that had never touched the setting
   * keeps `TaskBlock` and `EventBlock` rather than being reduced to the one thing just ticked — and
   * a model that becomes a candidate in a later release does not silently join a space that has
   * already decided.
   *
   * Published before it is stored, and queued like a default save. Each switch writes the *whole*
   * list, so the next one has to read this one's list rather than the copy from before it. The
   * executor shows a write as soon as it lands, which is before this call resumes to publish, and a
   * live row from before the write can replace the copy in the meantime — either one drops the class
   * the switch just turned on. The queue keeps an older write, whose list does not have the later
   * switch, from finishing last and storing that.
   */
  async function setInterpretationTarget(entity: string, on: boolean, spaceUuid?: string) {
    const ds = targetDataset(spaceUuid);
    const space = ds ? heldSpace(ds) : undefined;
    if (!ds || !space) return;
    const save = defaultSaveFor(ds, 'extractionTargets');
    const isNewest = save.ops.begin();
    const base = save.pending > 0 && save.value !== undefined ? save.value : space.extractionTargets;
    const current = entityListOf(base) ?? LEGACY_INTERPRETATION_TARGETS;
    const next = new Set(current);
    if (on) next.add(entity);
    else next.delete(entity);
    const extractionTargets = [...next];
    save.value = extractionTargets;
    save.pending += 1;
    try {
      publishSpaceFields(ds, { extractionTargets });
      await queueDefaultWrite(save, async () => writeSpaceFields(ds, space, { extractionTargets }, isNewest));
      save.confirmed = extractionTargets;
    } catch (error) {
      // Only the newest save takes the paint back — an earlier one failing leaves the later one's.
      if (isNewest()) publishSpaceFields(ds, { extractionTargets: save.confirmed });
      throw error;
    } finally {
      endDefaultSave(save);
    }
  }

  const members: Pick<
    SpaceStore,
    | 'autoInterpret'
    | 'interpretationTargets'
    | 'autoInterpretFor'
    | 'setAutoInterpretFor'
    | 'canSetInterpretationFor'
    | 'setAutoInterpret'
    | 'setInterpretationTarget'
  > = {
    autoInterpret,
    interpretationTargets,
    autoInterpretFor,
    setAutoInterpretFor,
    canSetInterpretationFor,
    setAutoInterpret,
    setInterpretationTarget,
  };

  return { members, collectionInterpretationFor };
}

export type SpaceExtraction = ReturnType<typeof createSpaceExtraction>;
