import { createBoardActions } from '@shared/boards';
import {
  CONTAINER_ACTIVITY_QUERY,
  type ContainerActivity,
  mentionsOf,
  unreadContainerIds,
} from '@shared/containerActivity';
import { isoOf } from '@shared/interpretation/callExport';
import {
  createInvolvementActions,
  INVOLVEMENT_SEMANTICS,
  type InvolvementTypeView,
  parseAppliesTo,
  resolveInvolvementTypes,
} from '@shared/involvements';
import { type SpaceAppearance } from '@shared/spaceAppearance';
import { removeSpaceFromParent, spaceSelfWhere, syncSpaceToParent } from '@shared/spaceSync';
import { createCallExports } from '@shared/stores/space/callExports';
import { createSpaceContext, withRow } from '@shared/stores/space/context';
import { createSpaceExtraction } from '@shared/stores/space/extraction';
import { createSpaceModules } from '@shared/stores/space/modules';
import { createSpaceNavigation } from '@shared/stores/space/navigation';
import { createSpaceRoles } from '@shared/stores/space/roles';
import { createSpaceList, SPACE_AVATAR_PX } from '@shared/stores/space/spaces';
import { createSpaceTaskStates } from '@shared/stores/space/taskStates';
import type { CreatePostOptions, SpaceListEntry, SpaceMetaUpdate } from '@shared/stores/space/types';
import { createSpaceWrites } from '@shared/stores/space/writes';
import type { SpaceStore } from '@shared/stores/SpaceStore';
import { uploadOf } from '@shared/uploadOf';
import { deriveSlug } from '@shared/utils';
import type { AgentProfileSummary } from '@we/backend-shared';
import type { ContentInput } from '@we/block-shared';
import {
  contentHash,
  decodeEditorState,
  deleteBlocks,
  isContentDocument,
  reconcileBlocks,
  writePost,
} from '@we/block-shared';
import { toastService } from '@we/components/solid';
import { runOperation } from '@we/entities';
import {
  CollectionBlock,
  compressImageToFileData,
  type DatasetProxy,
  dataURIToFileData,
  type InvolvementSemantic,
  InvolvementType,
  LocationBlock,
  MutedAgent,
  ReadMarker,
  SignalType,
  Space,
} from '@we/entities';
import { solidReactivity } from '@we/reactivity-solid';
import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js';

import { oneAtATime } from '../../../shared/oneAtATime';
import { signalOrder } from '../../../shared/signalOrder';
import { firstScreen } from '../firstScreen';
import { boardOptimism, involvementOptimism, signalOptimism, taskWorkflowLive } from '../hostState';
import type { StoreRegistry } from './useStore';

/*
  The extraction-settings resolution — `LEGACY_INTERPRETATION_TARGETS`, `entityListOf` and the
  per-collection resolvers below — lives in `collectionInterpretation` in `@we/entities` so it can be tested
  without mounting this provider. See that module for why a collection holds a copy.
*/

export function createSpaceStore(
  deps: Pick<
    StoreRegistry,
    | 'appStore'
    | 'datasetStore'
    | 'profileStore'
    | 'recordStore'
    | 'routeStore'
    | 'sessionStore'
    | 'shapeStore'
    | 'shellStore'
    | 'templateStore'
    | 'themeStore'
  >,
): SpaceStore {
  const session = deps.sessionStore;
  const datasetStore = deps.datasetStore;
  const shapeStore = deps.shapeStore;
  const recordStore = deps.recordStore;
  const profileStore = deps.profileStore;
  const routeStore = deps.routeStore;
  const templateStore = deps.templateStore;
  const appStore = deps.appStore;
  const themeStore = deps.themeStore;
  const shellStore = deps.shellStore;

  /*
    The store is composed of parts, one per job, each a neutral factory in `@shared/stores/space/`:
    the spaces held, how a setting on a space is written, where the agent is, what a space runs and
    shows, and what it extracts — built in that order, each handed what it reads of the ones before,
    and reaching a later one only through a function it calls after the store is built. The jobs
    still written below (task states, involvements, roles and policy, unread and mentions, and the
    space's own records — posts, boards, reactions, its fields and defaults) read the parts through
    the names taken out of them here.
  */
  const reactivity = solidReactivity;
  const ctx = createSpaceContext({
    reactivity,
    toasts: toastService,
    firstScreen,
    sessionStore: session,
    datasetStore,
  });
  const { runCore, reportOperation, targetDataset, isCurrent } = ctx;

  /*
    The spaces this agent holds. Built first: every other part reads the records it holds. What a new
    space is given by the later jobs — a section, its first admin, its starting policy — is reached
    through them when a space is made, by which time all of them are built.
  */
  const spaces = createSpaceList({
    ...ctx,
    routeStore,
    templateStore,
    shapeStore,
    newSpace: {
      enableView: (viewId, spaceId) => setViewEnabled(viewId, true, spaceId),
      writeAdminGrant: (dataset) => roles.writeAdminGrant(dataset),
      writeStartingPolicy: (dataset, starter) => roles.writeStartingPolicy(dataset, starter),
    },
  });
  const { mySpaces, updateSpaceInCache } = spaces.members;
  const { heldSpace, spaceForUuid } = spaces;

  /*
    How a setting on a space record is written and shown. Before the navigation part, which shows a
    setting still being saved over the live read; the space on screen is reached only when a write is
    made, by which time the navigation part is built.
  */
  const writes = createSpaceWrites({
    ...ctx,
    spaces,
    onScreen: {
      current: () => navigation.members.currentSpace(),
      show: (ds, fields) => navigation.showOnScreen(ds, fields),
    },
  });
  const { publishSpaceFields, writeSpaceFields } = writes;
  const { defaultSaveFor, queueDefaultWrite, endDefaultSave, spaceRowForSave } = writes;

  /*
    Where the agent is. The sections a space has are the modules-and-views part's, composed after
    this one and read only when somebody goes somewhere.
  */
  const navigation = createSpaceNavigation({
    ...ctx,
    routeStore,
    templateStore,
    shellStore,
    spaces,
    writes,
    sections: {
      routableViews: () => routableViews(),
      spaceViews: () => spaceViews(),
      usesSectionsFor: (uuid) => usesSectionsFor(uuid),
    },
    ensureBoardFor: (collectionId, dataset) => boards.ensureBoardFor(collectionId, dataset),
  });
  const { currentSpace, root: spaceRoot, landmarks: spaceLandmarks } = navigation.members;
  const { reloadSpaceStructure } = navigation;

  // Who stands where in each space and what its rules allow, and the write check that holds them.
  const roles = createSpaceRoles({ ...ctx, spaces, navigation });
  const { canAdministerSpace, canAdministerCurrentSpace } = roles.members;

  // What each space runs and shows, and this agent's own choices about each.
  const modules = createSpaceModules({
    ...ctx,
    templateStore,
    appStore,
    shellStore,
    spaces,
    navigation,
    writes,
  });
  const { routableViews, spaceViews, setViewEnabled } = modules.members;
  const { usesSectionsFor, writeSpacePreference } = modules;

  // What each space extracts, and the extraction runtime modules reach.
  const extraction = createSpaceExtraction({
    ...ctx,
    shapeStore,
    spaces,
    navigation,
    writes,
    canAdministerCurrentSpace,
  });

  // The states the space's work moves through, and the workflow that counts agreement between them.
  const taskStates = createSpaceTaskStates({
    ...ctx,
    recordStore,
    navigation,
    writes,
    canAdministerCurrentSpace,
    taskWorkflowLive,
    addStateToSpaceBoard: (slug, name) => boards.addStateToSpaceBoard(slug, name),
  });

  const [readMarkers, setReadMarkers] = createSignal<ReadMarker[]>([]);
  const [mutedAgents, setMutedAgents] = createSignal<MutedAgent[]>([]);
  /*
    The spaces list: one row per joined dataset the agent can act on, its columns answered by each
    job — whether this agent administers the space (its roles), what it runs and shows and this
    agent's own choices about it (the modules part). A plain list, rebuilt whenever anything in it
    changes. What keeps a row's mount — a half-typed name, the settings page's scroll — is the
    renderer, which keeps the rows of a list by `id`; each row's is its dataset's.
  */
  const spaceList = createMemo<SpaceListEntry[]>(() =>
    datasetStore.orderedDatasets().map((ds) =>
      spaces.listRow(ds, (space) => ({
        canAdminister: space ? canAdministerSpace(space.uuid) : false,
        ...modules.listColumns(ds.id, space),
      })),
    ),
  );

  /*
    The template and theme stores are composed before this one and cannot read it — lend them the
    spaces' records and this agent's overrides, which they resolve which template and theme apply
    from (see `spaceAppearance.ts`). The overrides are this agent's own, written to the root dataset.
  */
  const appearance: SpaceAppearance = {
    spaces: mySpaces,
    spaceFor: spaceForUuid,
    overrideFor: modules.overrideFor,
    setOverride: (uuid, which, id) =>
      which === 'template'
        ? writeSpacePreference('setSpaceTemplateOverride', uuid, { template: id })
        : writeSpacePreference('setSpaceThemeOverride', uuid, { theme: id }),
  };
  templateStore.provideSpaceAppearance(appearance);
  themeStore.provideSpaceAppearance(appearance);

  async function createPost(json: unknown, options: CreatePostOptions = {}): Promise<string | undefined> {
    const p = datasetStore.currentDataset()?.handle;
    const me = session.me()?.did;
    if (!p || !me) return;

    // The anchor is what makes one action serve every composed artifact. A post has none — it sits
    // in the space. A message names its channel through `children`; a reply names whatever it
    // answers through `responses`. Both arrive from a schema as ids, which is all a template
    // has, and both are `$each`/route values rather than anything the store could derive.
    // With no anchor named, a post goes in the space collection — the space's top level — rather than
    // nowhere. Read at the call, not destructured as a default, so a space entered after this store
    // was built still gets its own.
    const { kind = 'post', relation = 'children' } = options;
    const parentId = options.parentId ?? (spaceRoot() || undefined);

    // The action arrives from a schema as unknown; the composer produced it, so it is a content
    // document. The writes, threading a reply included, are `core.createPost`'s, as an agent's are.
    return writePost(p, json as ContentInput, {
      invoker: me,
      kind,
      ...(parentId && (relation === 'responses' ? { respondsTo: parentId } : { container: parentId })),
    });
  }

  async function updatePost(postId: string, json: unknown): Promise<void> {
    const p = datasetStore.currentDataset()?.handle;
    if (!p) return;
    const existingRoot = await CollectionBlock.findOne(p, { where: { id: postId } });
    if (!existingRoot) return;
    const document = json as ContentInput;

    // Somebody else may have saved this post while it was open here. A peer-to-peer store cannot
    // refuse the second writer — a write that has not arrived is invisible — so what it can do is
    // notice: the document carries a hash of the content as loaded, and the stored blob says what
    // is there now. Their blocks survive the save either way (reconcileBlocks keeps what the author
    // never loaded); a paragraph both agents edited resolves to whichever write is later, and that
    // is the one thing worth saying out loud.
    const loadedHash = isContentDocument(document) ? document.baseHash : undefined;
    const storedHash = loadedHash ? contentHash(decodeEditorState(existingRoot.editorState) ?? []) : undefined;
    const changedMeanwhile = !!loadedHash && !!storedHash && loadedHash !== storedHash;

    await reconcileBlocks(p, existingRoot, document);

    if (changedMeanwhile) {
      toastService.warning(
        'This post was changed by someone else while you were editing. Your version of anything you both changed was kept.',
        8000,
      );
    }
  }

  /**
   * The dataset a board write means: the one named, or the space on screen.
   *
   * Named rather than assumed, because a board is not always made where the reader is looking — the
   * extraction hook runs wherever the election landed. It resolves the same dataset
   * `interpretCollection` does, which is the one the pass just wrote its records into, so a board
   * cannot land somewhere its own cards did not.
   */
  function datasetFor(uri?: string): DatasetProxy | undefined {
    if (!uri) return datasetStore.currentDataset()?.handle;
    return datasetStore.datasets().find((d) => d.sharedUri === uri || d.id === uri)?.handle;
  }

  /*
    The board writes, from `@shared/boards`.

    Ten actions over one shape, and what they decide is the board design rather than anything about
    this store: which list to store, what a drop means, and the invariant that a board's children are
    columns. They moved out because they are a subsystem rather than because this file is long — the
    ordering itself is the executor's, so what is left in them is meaning, and meaning reads better
    beside the rest of its own meaning.

    The store stays their **surface**: a template names `spaceStore.moveCardToColumn`, and where the
    implementation sits is not a template author's business. Only three things reach outside the
    module, and they arrive as arguments — which dataset, what the community's states are, and how a
    failure reaches the person who caused it. `offeredStates` is wrapped rather than passed, since the
    memo it names is declared further down this file.
  */
  const boards = createBoardActions({
    dataset: datasetFor,
    invoker: () => session.me()?.did,
    // An arrangement is drawn before it is stored; `boardOptimism` holds it, and whatever draws the
    // board reports when the data has overtaken it. See that module for why nothing releases on
    // success.
    ...boardOptimism.ports,
    offeredStates: () => taskStates.offeredTaskStates(),
    notify: (message) => toastService.error(message),
    landmarksChanged: () => void reloadSpaceStructure(),
    workflow: taskStates.boardWorkflow,
    /*
      A staged suggestion for one property, dropped — see `BoardDeps.resolveSuggestion`. Checked
      against the proposal list first rather than rejected blind, since a reject on a record with no
      overlay is refused, and most moves are of cards nobody proposed. Best-effort throughout: the
      move is the thing that matters, and a suggestion that survives is visible on the card.
    */
    resolveSuggestion: async (recordId, property) => {
      const port = session.backendPorts()?.interpretation;
      const dataset = datasetStore.currentDataset()?.handle;
      if (!port || !dataset) return;
      try {
        const pending = await port.proposals(dataset);
        if (!pending.some((proposal) => proposal.id === recordId && property in proposal.values)) return;
        await port.reject(dataset, recordId, property);
      } catch (error) {
        console.warn('SpaceStore: could not settle a staged suggestion before a move', error);
      }
    },
  });

  /**
   * Join or leave a node's participant roster — an event RSVP, a document's co-editor list.
   *
   * **Writes only this agent's own entry, ever.** That is not a convenience, it is what keeps
   * `participants` conflict-free: it is a bag of links with no way to refuse a duplicate, so it
   * behaves as a set exactly as long as each agent writes itself and nobody else. A caller that
   * appended every member it could see is what turned the transcribe module's roster into a
   * multiset that grew each session — see the note on `WeNode.participants`.
   *
   * No read-modify-write for the same reason: `addParticipants` and `removeParticipants` are single
   * link operations, so two agents RSVPing at the same moment cannot drop each other.
   */
  async function setAttending(nodeId: string, attending: boolean): Promise<void> {
    const p = datasetStore.currentDataset()?.handle;
    const me = session.me()?.did;
    if (!p || !nodeId || !me) return;
    try {
      const node = await CollectionBlock.findOne(p, { where: { id: nodeId } });
      if (!node) return;
      if (attending) await node.addParticipants(me);
      else await node.removeParticipants(me);
    } catch (error) {
      console.error('SpaceStore: could not update attendance', error);
      toastService.error('Could not update your RSVP');
    }
  }

  async function deleteCollection(collectionId: string): Promise<void> {
    const p = datasetStore.currentDataset()?.handle;
    if (!p) return;
    await deleteBlocks(p, collectionId);
  }

  async function updateSpaceImage(field: 'avatar' | 'coverImage', imageFile: File, spaceUuid?: string): Promise<void> {
    const ds = targetDataset(spaceUuid);
    if (!ds) return;
    const fileData = await compressImageToFileData(
      imageFile,
      field === 'avatar' ? 'space-image' : 'space-cover',
      field === 'avatar' ? SPACE_AVATAR_PX : undefined,
    );
    const [spaceRecord] = await Space.findAll(ds.handle, { where: spaceSelfWhere(ds) });
    if (!spaceRecord) return;
    await Space.update(ds.handle, spaceRecord.id, { [field]: fileData });
    // Only the current space has a live subscription refreshing it; every other row in the spaces
    // list is served from this cache, so without it the change would not appear until a reload.
    updateSpaceInCache(ds, { [field]: fileData });
    if (spaceRecord.discovery === 'listed') {
      const globalDs = datasetStore.globalDataset();
      if (globalDs) {
        const imageOpt = field === 'avatar' ? { avatarData: fileData } : { coverImageData: fileData };
        await syncSpaceToParent(spaceRecord, globalDs.handle, session.backendPorts()!.schemas, imageOpt).catch((err) =>
          console.error('SpaceStore: sync image to global failed', err),
        );
      }
    }
  }

  async function updateSpaceMeta(updates: SpaceMetaUpdate, spaceUuid?: string): Promise<void> {
    const ds = targetDataset(spaceUuid);
    if (!ds) return;
    const currentDataset = ds.handle;

    const [spaceRecord] = await Space.findAll(currentDataset, {
      where: spaceSelfWhere(ds),
      include: { location: true },
    });
    if (!spaceRecord) return;

    const previousDiscovery = spaceRecord.discovery;
    const { location, ...scalars } = updates;
    if (location) await session.backendPorts()!.schemas.ensure(currentDataset, LocationBlock);
    /*
      One write: the fields, and the space's own place replaced — deleted and made again, so the
      space's location relation itself changes and the subscription on it reads the new place.
    */
    await runCore(
      'updateSpaceMeta',
      {
        space: spaceRecord.id,
        name: updates.name,
        description: updates.description,
        discovery: updates.discovery,
        location: location ?? undefined,
        clearLocation: location === null || undefined,
      },
      currentDataset,
    );
    // The record read above goes to the discovery space below, so it carries what was just written.
    Object.assign(spaceRecord, scalars);
    // See updateSpaceImage — only the current space is refreshed by a live subscription.
    updateSpaceInCache(ds, scalars);
    /*
      The cached row carries the location too: only the space *on screen* is refreshed by the live
      subscription, so without this the settings page would show the old place — or "Not set" —
      immediately after saving a space the agent is not standing in.
    */
    if (location !== undefined) updateSpaceInCache(ds, { location } as never);

    const globalDs = datasetStore.globalDataset();
    if (!globalDs) return;

    const effectiveDiscovery = updates.discovery ?? previousDiscovery;
    if (effectiveDiscovery === 'listed') {
      // Pass locationData explicitly when location changed — the included spaceRecord.location
      // snapshot is stale after our delete+recreate. null signals explicit removal to syncSpaceToParent.
      const syncOpts = updates.location !== undefined ? { locationData: updates.location } : {};
      await syncSpaceToParent(spaceRecord, globalDs.handle, session.backendPorts()!.schemas, syncOpts).catch((err) =>
        console.error('SpaceStore: sync meta to global failed', err),
      );
    } else if (previousDiscovery === 'listed') {
      await removeSpaceFromParent(spaceRecord.uuid, globalDs.handle).catch((err) =>
        console.error('SpaceStore: remove from global failed', err),
      );
    }
  }

  /**
   * Withdraw a signal type from use, or bring it back — without touching what people gave.
   *
   * ## Why this is not a delete
   *
   * A `Signal` names its type by **record id** (`signalTypeId`), not by slug, while every template
   * resolves the type by slug at render time — `find(local.signalTypes, { slug: 'like' }).id`.
   * Three things follow, and they decide the whole design:
   *
   * - Deleting the type removes nothing. Every reaction ever given stays in the perspective, now
   *   naming an id nothing resolves, counted by no projection and rendered by nothing.
   * - Re-creating a type with the same slug does not bring them back either. AD4M mints a fresh
   *   record id, so the old rows still name the dead one. "Delete it and add it back" loses the
   *   history permanently, which is exactly the thing a person would expect to be safe.
   * - Cascading the delete instead — sweeping up every `Signal` with that id — is worse than it
   *   looks. It is thousands of sequential link removals in an established space; it destroys
   *   *other members'* expressions on one person's click, in a neighbourhood every member can write
   *   to; it cannot be undone; and it cannot even be guaranteed, since a peer who was offline
   *   during the sweep, or who reacted concurrently, re-orphans immediately.
   *
   * So the reversible option is the right one, and it is the one this codebase already chose one
   * layer up: `shapeStore.deleteShape` removes a model definition and says plainly that "records
   * already created keep their data — only the definition goes". A signal type is the same kind of
   * thing, and deserves the same answer.
   *
   * Retired, the type stops being offered anywhere a reaction can be given. The signals stay,
   * `find()` by slug still resolves it so existing counts keep working, and un-retiring restores
   * every reaction exactly as it was — because nothing was ever removed.
   *
   * Positively phrased so a switch can pass `event.detail` bare, matching `setAgentMuted` and
   * `setViewVisible`.
   */
  async function setSignalTypeRetired(signalTypeId: string, retired: boolean): Promise<void> {
    const p = datasetStore.currentDataset()?.handle;
    if (!p) return;

    try {
      await SignalType.update(p, signalTypeId, { retired });
    } catch (error) {
      console.error('SpaceStore: could not change whether a signal type is retired', error);
      toastService.error(retired ? 'Could not retire that reaction' : 'Could not restore that reaction');
    }
  }

  /**
   * Give a reaction, or change one — and `null` withdraws it.
   *
   * ## Why a withdrawal is its own value rather than a zero
   *
   * It was a zero, and that made **0 unstorable**. Every mode whose range includes it lost the
   * answer: a 0–100 mood slider dragged to the bottom was written as "did not answer", so the
   * strongest thing somebody could say was the one thing the average then ignored. Silent, and
   * invisible from the call site — `upsertSignal(node, type, 0)` reads like storing a nought.
   *
   * A toggle and a vote are unaffected, because there 0 genuinely IS absence. That is what let the
   * overload survive: it is correct for two of the four modes, and the two it is wrong for are the
   * two whose range a community chooses.
   */
  /*
    One reaction write at a time, per record-and-type pair.

    `upsertSignal` reads before it writes, so two calls for the same pair both read first: both find
    the same stored record, both delete it, and both create a replacement. That is how one person
    came to be listed twice under one signal type with the same value — and it is not a bug in
    whatever called twice, because a read-then-write is racy against any second caller at all.

    Per pair rather than globally: reacting to one post has no reason to wait on a reaction to
    another. See `oneAtATime`.
  */
  const queueSignalWrite = oneAtATime();

  async function upsertSignal(nodeId: string, signalTypeId: string, value: number | null): Promise<void> {
    const p = datasetStore.currentDataset()?.handle;
    const myDid = session.me()?.did;
    if (!p || !myDid) return;

    /*
      Drawn on the press, before anything is read.

      A reaction is the worst case there is for the round trip: it is a press-and-see control, and
      the answer comes back through a subscription about a second later — with a further 250ms of
      the executor's own debounce under that. Held here, the glyph fills and the count moves on the
      click; `reactions` is where the hold meets the list every surface draws from.
    */
    signalOptimism.hold(nodeId, signalTypeId, value);

    await queueSignalWrite(`${nodeId}|${signalTypeId}`, async () => {
      /*
        The writes are `core.upsertSignal` and `core.withdrawSignal`: every reaction of mine on this
        type is found, one is kept and edited in place, and the rest are removed, so a pair written
        twice heals on the next change. A withdrawal — `null` — removes the record rather than storing
        anything, which keeps a withdrawn reaction absent everywhere instead of being a row every count
        has to remember to exclude. A zero is an ordinary value and is stored like any other.
      */
      try {
        const args = { node: nodeId, signalType: signalTypeId };
        if (value === null) await runOperation('core.withdrawSignal', args, { dataset: p, invoker: myDid });
        else await runOperation('core.upsertSignal', { ...args, value }, { dataset: p, invoker: myDid });
        // The write is back. Not a release — what retires a hold is the data moving — but it ends
        // the hold's exemption from what the next draw says. See `@we/optimism`.
        signalOptimism.done(nodeId, signalTypeId);
      } catch (error) {
        // What is on screen is a lie the moment the write is refused.
        signalOptimism.release(nodeId, signalTypeId);
        console.error('SpaceStore: could not record that reaction', error);
        toastService.error('Could not record that reaction.');
      }
    });
  }

  /**
   * Take back this agent's reaction of one type on one record.
   *
   * Its own action rather than `upsertSignal(node, type, 0)`: on a mode whose range includes zero a
   * nought is a rating, so the two acts are spelled apart and a schema says which one it means.
   */
  async function withdrawSignal(nodeId: string, signalTypeId: string): Promise<void> {
    await upsertSignal(nodeId, signalTypeId, null);
  }

  // The lambdas are read at export time: the interpretation settings they name are declared further down.
  const callExports = createCallExports({
    toasts: toastService,
    dataset: () => datasetStore.currentDataset(),
    interpretation: () => session.backendPorts()?.interpretation,
    profileStore,
    exportMeta: extraction.collectionInterpretationFor,
  });

  /*
    Where content lives: the space collection, for anything made on the space's own canvas and for
    anything made with no other home. See `provideContentHomes` — injected for the reason the
    vocabularies are, since RecordStore mounts above this one.
  */
  onCleanup(
    recordStore.provideContentHomes({
      forCanvas: (canvas) => (canvas === spaceLandmarks().canvas && spaceRoot() ? spaceRoot() : canvas),
      root: () => spaceRoot(),
    }),
  );

  /*
    ── Involvements ─────────────────────────────────────────────────────────────────────────────

    Who is on what. The vocabulary is loaded here, for the reason task states are: a template can filter a list it was handed and cannot substitute one it was not. The
    involvements themselves are not — they change with every click anybody makes, so a template holds
    them in a live query and reads them through the `involvement` host function. What a write *means*
    lives in `involvements.ts`.
  */
  const [ownInvolvementTypes, setOwnInvolvementTypes] = createSignal<InvolvementTypeView[]>([]);
  const [involvementTypesLoaded, setInvolvementTypesLoaded] = createSignal(false);

  async function loadInvolvementTypes(): Promise<void> {
    const dataset = datasetStore.currentDataset()?.handle;
    const uuid = datasetStore.currentDataset()?.id;
    const ports = session.backendPorts()?.schemas;
    if (!dataset || !ports || !datasetStore.isWeSpace()) {
      setOwnInvolvementTypes([]);
      setInvolvementTypesLoaded(true);
      return;
    }
    setInvolvementTypesLoaded(false);
    try {
      // Every space predates the entity; `ensure` is the diff-first install `loadTaskStates` uses.
      await ports.ensure(dataset, InvolvementType);
      const records = (await InvolvementType.findAll(dataset)) as InvolvementType[];
      if (datasetStore.currentDataset()?.id !== uuid) return;
      const stamp = (r: InvolvementType) =>
        isoOf((r as unknown as { timestamp?: unknown; createdAt?: unknown }).timestamp ?? r.createdAt);
      setOwnInvolvementTypes(
        [...records]
          .sort((a, b) => stamp(a).localeCompare(stamp(b)))
          .map((r) => ({
            id: r.id,
            name: r.name || r.slug,
            slug: r.slug || deriveSlug(r.name || ''),
            semantic: INVOLVEMENT_SEMANTICS.includes(r.semantic) ? r.semantic : 'responsible',
            reflexive: Boolean(r.reflexive),
            appliesTo: parseAppliesTo(r.appliesTo),
            icon: r.icon || '',
            color: r.color || '',
            retired: Boolean(r.retired),
          })),
      );
    } catch (error) {
      console.warn('SpaceStore: could not read involvement types', error);
      if (datasetStore.currentDataset()?.id === uuid) setOwnInvolvementTypes([]);
    } finally {
      if (datasetStore.currentDataset()?.id === uuid) setInvolvementTypesLoaded(true);
    }
  }

  createEffect(() => {
    void datasetStore.currentDataset()?.id;
    // A hold is a promise about records on the screen being left; see `involvementOptimism.reset`.
    involvementOptimism.reset();
    signalOptimism.reset();
    // The order a record's reactions settled into is a promise about the same screen. See
    // `signalOrder`.
    signalOrder.reset();
    void loadInvolvementTypes();
  });

  const involvementTypes = createMemo<InvolvementTypeView[]>(() => resolveInvolvementTypes(ownInvolvementTypes()));
  const offeredInvolvementTypes = createMemo<InvolvementTypeView[]>(() =>
    involvementTypes().filter((kind) => !kind.retired),
  );

  const involvements = createInvolvementActions({
    dataset: () => datasetStore.currentDataset()?.handle,
    me: () => session.me()?.did,
    types: () => involvementTypes(),
    notify: (message) => toastService.error(message),
    ...involvementOptimism.ports,
  });

  /**
   * A change to the space's kinds of involvement, then the one read the screen has of them — they
   * are read on entering a space rather than followed.
   */
  async function changeInvolvementType(operation: string, args: Record<string, unknown>, failure: string) {
    try {
      await runCore(operation, args);
    } catch (error) {
      reportOperation('change a kind of involvement', failure, error);
      return;
    }
    await loadInvolvementTypes();
  }

  /**
   * Name a kind of part — "Shepherd", "Second pair of eyes" — through `core.createInvolvementType`,
   * which refuses a slug the community already has. `reflexive` is fixed at creation and not offered
   * for editing: turning an assignment into an answer would leave every existing one claiming
   * somebody said something they never said.
   */
  async function createInvolvementType(config: {
    name: string;
    semantic?: InvolvementSemantic;
    reflexive?: boolean;
    appliesTo?: string;
    icon?: string;
    color?: string;
  }): Promise<void> {
    if (!config?.name?.trim()) return;
    await changeInvolvementType(
      'createInvolvementType',
      {
        name: config.name,
        semantic: config.semantic,
        reflexive: config.reflexive,
        appliesTo: parseAppliesTo(config.appliesTo ?? '').join(','),
        icon: config.icon,
        color: config.color,
      },
      'Could not add that kind',
    );
  }

  /** Change a kind — see `updateTaskState` for why the slug is absent and an empty string clears. */
  async function updateInvolvementType(
    slug: string,
    updates: { name?: string; icon?: string; color?: string; semantic?: InvolvementSemantic; appliesTo?: string },
  ): Promise<void> {
    if (!slug || !updates) return;
    await changeInvolvementType(
      'updateInvolvementType',
      {
        slug,
        name: updates.name,
        icon: updates.icon,
        color: updates.color,
        semantic: updates.semantic,
        appliesTo: updates.appliesTo === undefined ? undefined : parseAppliesTo(updates.appliesTo).join(','),
      },
      'Could not save that change',
    );
  }

  /** Withdraw a kind, or bring it back — `setTaskStateRetired`'s decision, one vocabulary along. */
  async function setInvolvementTypeRetired(slug: string, retired: boolean): Promise<void> {
    if (!slug) return;
    await changeInvolvementType('setInvolvementTypeRetired', { slug, retired }, 'Could not update that kind');
  }

  // Per-agent private state, loaded from the root dataset alongside space preferences and for the
  // same reason: it is not any one space's, and a feed has to filter on the mute list before it can
  // render a single row.
  createEffect(() => {
    const root = datasetStore.rootDataset();
    if (!root) {
      setReadMarkers([]);
      setMutedAgents([]);
      return;
    }
    void ReadMarker.findAll(root.handle)
      .then(setReadMarkers)
      .catch(() => setReadMarkers([]));
    void MutedAgent.findAll(root.handle)
      .then(setMutedAgents)
      .catch(() => setMutedAgents([]));
  });

  /**
   * Mark a node read, as of now.
   *
   * Upsert on `nodeId` — one marker per node, moved forward rather than accumulated. Called on
   * opening a channel, so it runs often and stays silent on failure: a lost marker shows a stale
   * unread dot, which is not worth a toast interrupting what the user opened the channel to do.
   */
  async function markRead(nodeId: string, spaceUuid?: string): Promise<void> {
    const root = datasetStore.rootDataset();
    const uuid = spaceUuid ?? datasetStore.currentDataset()?.id;
    if (!root || !nodeId || !uuid) return;
    try {
      const marker = await runCore<Partial<ReadMarker>>('markRead', { node: nodeId, space: uuid }, root.handle);
      setReadMarkers((rows) => withRow(rows, marker));
    } catch (error) {
      console.error('SpaceStore: could not write read marker', error);
    }
  }

  /**
   * The space's containers, read once for both unread dots and mentions — see `containerActivity.ts`.
   *
   * Once per space: marking a container read changes the markers, not the containers, so the unread
   * set is recomputed from these rows rather than by reading the space again.
   */
  const [activityRows, setActivityRows] = createSignal<ContainerActivity[]>([]);

  createEffect(() => {
    const ds = datasetStore.currentDataset();
    setActivityRows([]);
    if (!ds) return;

    void (async () => {
      try {
        const rows = await CollectionBlock.findAll(ds.handle, CONTAINER_ACTIVITY_QUERY);
        // A read that lands after a space switch belongs to the space that was left.
        if (datasetStore.currentDataset() === ds) setActivityRows(rows);
      } catch (error) {
        console.error('SpaceStore: could not read container activity', error);
      }
    })();
  });

  /**
   * Containers holding something newer than this agent's marker for them.
   *
   * One read for the whole space rather than a projection per row: the rail asked the same question
   * for every channel, so a space with thirty channels opened thirty of them.
   */
  const unreadNodeIds = createMemo(() => unreadContainerIds(activityRows(), readMarkers()));

  /*
    Messages in this space naming this agent — posts and transcript lines alike, newest first.

    Asked from the agent's end, through the backend's references (`we://mention` to this DID): one
    lookup however many messages the space holds, and it finds a mention in a transcript line, which
    the container read below it never could. Read again on entering the space and whenever its
    containers' activity changes — a new line in a running call is not one of those, and is found on
    the next. A backend that cannot answer falls back to filtering the container read, which is what
    this was.
  */
  const [mentionRows, setMentionRows] = createSignal<{ id: string; author: string; createdAt: number }[] | null>(null);
  createEffect(() => {
    const ds = datasetStore.currentDataset();
    const did = session.me()?.did;
    const references = session.backendPorts()?.references;
    void activityRows();
    setMentionRows(null);
    if (!ds || !did || !references) return;
    void references
      .referrers(ds.handle, { relation: 'mentions' }, did, { limit: 50 })
      .then((rows) => {
        if (datasetStore.currentDataset() !== ds) return;
        setMentionRows(rows.map((row) => ({ id: row.id, author: row.author, createdAt: Date.parse(row.at) || 0 })));
      })
      .catch((error: unknown) => console.warn('SpaceStore: could not read who mentions this agent', error));
  });
  const myMentions = createMemo(() => {
    const did = session.me()?.did;
    const found = mentionRows();
    if (found) return found;
    return did ? mentionsOf(activityRows(), did) : [];
  });

  /**
   * Store a file and return the URL that points at it.
   *
   * Images are compressed on the way through, for the reason the profile and space-image paths
   * already do it: a phone photo is several megabytes, and a space's content syncs to every member.
   * Anything else is stored as-is.
   */
  const readAsDataURI = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      // `readAsDataURL` always yields a string.
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
      reader.readAsDataURL(file);
    });

  async function uploadFile(file: File, name?: string): Promise<string | null> {
    const profiles = session.backendPorts()?.profiles;
    if (!profiles) return null;
    try {
      const fileData = file.type.startsWith('image/')
        ? await compressImageToFileData(file, name ?? file.name)
        : // Non-images go through unchanged. `dataURIToFileData` is the same decode the image path
          // ends with, so both arrive at the port in one shape.
          dataURIToFileData(await readAsDataURI(file), name ?? file.name);
      return await profiles.uploadFile(uploadOf(fileData));
    } catch (error) {
      console.error('SpaceStore: upload failed', error);
      toastService.error('Could not upload that file.');
      return null;
    }
  }

  /**
   * Mute or unmute an agent for this agent, everywhere.
   *
   * Phrased positively — `muted: boolean` — so a switch can pass `$event.detail` bare; the same
   * constraint `setModuleVisible` documents.
   *
   * Reports failure, unlike `markRead`: this one was asked for deliberately, and someone who thinks
   * they have muted an account and has not is worse off than someone who knows it did not work.
   */
  /** Just the DIDs — what a feed filter wants, without every consumer mapping the records. */
  const mutedDids = createMemo(() => mutedAgents().map((m) => m.did));

  /**
   * Markers as `{ nodeId, lastReadAt }` rows.
   *
   * An array rather than a map keyed by node id, because **a schema cannot index a map
   * dynamically**: a store read resolves a static dot path, so `spaceStore.readMarkers.<some context
   * ref>` is not expressible — the path would be taken literally. The read is always "this row's
   * marker" from inside a `$each`, which means `find()` over an array with a context ref in `where`,
   * the only form the resolver supports. Linear per rendered row, over a list the size of the
   * channels one agent has opened.
   */
  const readMarkerRows = createMemo(() => readMarkers().map((m) => ({ nodeId: m.nodeId, lastReadAt: m.lastReadAt })));

  async function setAgentMuted(did: string, muted: boolean, description = ''): Promise<void> {
    const root = datasetStore.rootDataset();
    if (!root || !did) return;
    try {
      await runCore('setAgentMuted', { did, muted, description }, root.handle);
      // What the operation leaves: one record while muted, none after. Its id is not needed to read it.
      setMutedAgents((rows) =>
        muted
          ? rows.some((m) => m.did === did)
            ? rows
            : [...rows, { did, description } as MutedAgent]
          : rows.filter((m) => m.did !== did),
      );
    } catch (error) {
      console.error('SpaceStore: could not update mute list', error);
      toastService.error(muted ? 'Could not mute that account' : 'Could not unmute that account');
    }
  }

  /** Turn a module on or off for this agent everywhere. See `AgentSettings.installedModules`. */

  /*
    And the other thing the shell cannot see for itself: the template on screen and a library to
    save into, for "save this arrangement as a template". Same shape as the gate, same reason.
  */
  shellStore.provideTemplateSaver({
    current: () => templateStore.currentTemplate,
    save: (schema) => templateStore.saveTemplateAs(schema, 'root'),
  });

  /**
   * How deep conversations here may go — `'fractal'` or `'flat'`.
   *
   * A decision about what may be *added*, never about what is stored: replies are a tree whatever
   * this says, so switching to flat leaves every existing thread drawn as it is and switching back
   * restores the button that grows it. That is the whole reason this is safe to change twice on a
   * Tuesday — there is nothing to migrate and nothing to lose, which a setting that reshaped stored
   * data could not promise.
   *
   * Takes the value rather than toggling, so a picker can pass `event.detail` straight through.
   */
  async function setThreadMode(mode: string, spaceUuid?: string) {
    const ds = targetDataset(spaceUuid);
    const space = ds ? heldSpace(ds) : undefined;
    if (!ds || !space) return;
    await writeSpaceFields(ds, space, { threadMode: mode === 'flat' ? 'flat' : 'fractal' });
  }

  const [memberDids, setMemberDids] = createSignal<string[]>([]);
  // Read off the space on screen. An optimistic write publishes the field onto that space.
  const spaceDefaultTemplateId = createMemo(() => currentSpace()?.defaultTemplateId ?? '');
  const spaceDefaultThemeId = createMemo(() => currentSpace()?.defaultThemeId ?? '');

  async function setSpaceDefaultTemplate(templateId: string, spaceUuid?: string): Promise<void> {
    const ds = targetDataset(spaceUuid);
    if (!ds) return;
    const save = defaultSaveFor(ds, 'defaultTemplateId');
    const isNewest = save.ops.begin();
    save.value = templateId;
    save.pending += 1;
    try {
      /*
        Published before it is stored — and the publish is the whole of the paint. The template
        store follows the record's `defaultTemplateId` for the space on screen, so a save touches
        no template directly: the follow resolves what to show, through this agent's own override
        for the space where one is set. The republish below is the whole rollback for the same
        reason — the follow paints what the record last took, not what a snapshot happened to
        capture, so a template the record itself brought in mid-save is never rolled back over.
      */
      publishSpaceFields(ds, { defaultTemplateId: templateId });
      await queueDefaultWrite(save, async () =>
        writeSpaceFields(ds, await spaceRowForSave(ds), { defaultTemplateId: templateId }, isNewest),
      );
      save.confirmed = templateId;
    } catch (error) {
      // Only the newest save takes the paint back — an earlier one failing leaves the later one's.
      if (isNewest()) publishSpaceFields(ds, { defaultTemplateId: save.confirmed as string | undefined });
      throw error;
    } finally {
      endDefaultSave(save);
    }
  }

  async function setSpaceDefaultTheme(themeId: string, spaceUuid?: string): Promise<void> {
    const ds = targetDataset(spaceUuid);
    if (!ds) return;
    const save = defaultSaveFor(ds, 'defaultThemeId');
    const isNewest = save.ops.begin();
    save.value = themeId;
    save.pending += 1;
    try {
      publishSpaceFields(ds, { defaultThemeId: themeId });
      if (isCurrent(ds)) themeStore.explainSpaceThemeHidden();
      await queueDefaultWrite(save, async () =>
        writeSpaceFields(ds, await spaceRowForSave(ds), { defaultThemeId: themeId }, isNewest),
      );
      save.confirmed = themeId;
    } catch (error) {
      // Only the newest save takes the paint back — an earlier one failing leaves the later one's.
      if (isNewest()) publishSpaceFields(ds, { defaultThemeId: save.confirmed as string | undefined });
      throw error;
    } finally {
      endDefaultSave(save);
    }
  }

  /*
    Load neighbourhood members whenever the current dataset changes — once the first screen is up,
    since the first page draws none of them and each brings a profile read (`shared/firstScreen.ts`).
    Until then the list is this agent alone, which is what a space with nobody else in it shows.
  */
  createEffect(() => {
    const ds = datasetStore.currentDataset();
    const lifecycle = session.lifecycle();
    const myDid = session.me()?.did;
    if (!ds || !lifecycle?.members || !firstScreen.open()) {
      setMemberDids(myDid ? [myDid] : []);
      return;
    }
    lifecycle
      .members(ds.id)
      .then((dids: string[]) => {
        const allDids = myDid ? [...new Set([myDid, ...dids])] : dids;
        setMemberDids(allDids);
        for (const did of allDids) {
          void profileStore.fetchProfile(did);
        }
      })
      .catch(() => {
        setMemberDids(myDid ? [myDid] : []);
      });
  });

  // Map memberDids to cached AgentProfileSummary entries
  const members = createMemo<AgentProfileSummary[]>(() => {
    const cached = profileStore.profiles();
    return memberDids()
      .map((did) => cached.find((a) => a.did === did))
      .filter((a): a is AgentProfileSummary => a != null);
  });

  const store: SpaceStore = {
    ...spaces.members,
    ...navigation.members,
    ...modules.members,
    ...extraction.members,
    ...roles.members,
    ...taskStates.members,
    // State
    memberDids,
    members,
    spaceDefaultTemplateId,
    spaceDefaultThemeId,
    spaceList,
    involvementTypes,
    offeredInvolvementTypes,
    involvementTypesLoaded,

    // Actions
    createPost,
    updatePost,
    ...boards,
    setAttending,
    mutedDids,
    mutedAgents,
    setAgentMuted,
    readMarkers: readMarkerRows,
    markRead,
    unreadNodeIds,
    myMentions,
    uploadFile,
    deleteCollection,
    updateSpaceImage,
    updateSpaceMeta,
    setSpaceDefaultTemplate,
    setSpaceDefaultTheme,
    firstScreenOpen: () => firstScreen.open(),
    setThreadMode,
    setSignalTypeRetired,
    setInvolvement: involvements.setInvolvement,
    respondTo: involvements.respond,
    createInvolvementType,
    updateInvolvementType,
    setInvolvementTypeRetired,
    upsertSignal,
    withdrawSignal,
    exportCallTranscript: callExports.exportCallTranscript,
    exportInterpretationLog: callExports.exportInterpretationLog,
  };

  return store;
}
