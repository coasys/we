import { createBoardActions } from '@shared/boards';
import {
  CONTAINER_ACTIVITY_QUERY,
  type ContainerActivity,
  mentionsOf,
  unreadContainerIds,
} from '@shared/containerActivity';
import { evidenceSubjectOf } from '@shared/evidenceSubjects';
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
import type { CreatePostOptions, SpaceListEntry, SpaceMetaUpdate, TaskStateView } from '@shared/stores/space/types';
import { createSpaceWrites } from '@shared/stores/space/writes';
import type { SpaceStore } from '@shared/stores/SpaceStore';
import {
  approvalsOf,
  compileTaskWorkflow,
  createTaskWorkflowActions,
  needsAgreement,
  openMoveOf,
  readTaskStateEvidence,
  storeTaskStateEvidence,
  TASK_WORKFLOW,
  type TaskStateRule,
  type TaskWorkflowRule,
  workflowStateOf,
} from '@shared/taskWorkflow';
import { uploadOf } from '@shared/uploadOf';
import { deriveSlug } from '@shared/utils';
import { idListOf } from '@shared/viewResolution';
import { evidenceLabel, refusalWords } from '@shared/workflowViews';
import type { AgentProfileSummary, WorkflowView } from '@we/backend-shared';
import { trace } from '@we/backend-shared';
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
  getEntityForDataset,
  type InvolvementSemantic,
  InvolvementType,
  LocationBlock,
  MutedAgent,
  ReadMarker,
  SignalType,
  Space,
  type TaskBlock,
  TaskState,
} from '@we/entities';
import { solidReactivity } from '@we/reactivity-solid';
import { batch, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js';

import { followLive } from '../../../shared/followLive';
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
  const { publishSpaceFields, writeSpaceFields, writeSpaceSetting } = writes;
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
  const { reloadSpaceStructure, pushedOnScreen } = navigation;

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
    offeredStates: () => offeredTaskStates(),
    notify: (message) => toastService.error(message),
    landmarksChanged: () => void reloadSpaceStructure(),
    // Wrapped for `offeredStates`' reason: the workflow is worked out from the states, further down.
    workflow: {
      enabled: () => taskWorkflow.enabled(),
      needsAgreement: (slug) => needsAgreement(taskWorkflowRules().find((state) => state.slug === slug)),
      stateOf: (taskId) => workflowStateOf(taskWorkflowLive.view(), taskId),
      move: (taskId, from, to) => taskWorkflow.move(taskId, from, to),
      entryFor: (to) => taskWorkflow.entryFor(to),
      explain: (from, to, outcome) => explainTaskMove(from, to, outcome ?? ''),
    },
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
    ── Task states ──────────────────────────────────────────────────────────────────────────────

    The states this community's work moves through: its `TaskState` records, and nothing else.

    A new space's starter writes the first ones, once, at the create press — so they are the
    community's own from the start, and editing "To do" is an edit like any other. There are no
    defaults standing in for records: a space with no states has none, and its boards have no
    columns, which is what a starter that seeds none asked for.

    Loaded per space rather than queried in a template, because every board, picker and key reads the
    same ordered list, and the order is the community's (`Space.taskStates`).
  */
  const [ownTaskStates, setOwnTaskStates] = createSignal<TaskStateView[]>([]);
  const [taskStatesLoaded, setTaskStatesLoaded] = createSignal(false);
  const [taskStateOrder, setTaskStateOrder] = createSignal<string[]>([]);

  /**
   * One record per slug, the earliest written winning.
   *
   * Two members naming the same state at the same moment on two nodes produce two records with one
   * slug, and a task names its state by slug — so to every task they are one state, and the list
   * should say so too. The earliest is kept because it is the one most peers already hold; the later one is
   * inert, never offered and never listed, and costs nothing.
   */
  function dedupeBySlug(records: TaskState[]): TaskState[] {
    const stamp = (r: TaskState) =>
      isoOf((r as unknown as { timestamp?: unknown }).timestamp ?? (r as unknown as { createdAt?: unknown }).createdAt);
    const bySlug = new Map<string, TaskState>();
    for (const record of [...records].sort((a, b) => stamp(a).localeCompare(stamp(b)))) {
      const slug = record.slug || deriveSlug(record.name || '');
      if (!bySlug.has(slug)) bySlug.set(slug, record);
    }
    return [...bySlug.values()];
  }

  /**
   * Read the space's own states. `quiet` for a re-read after somebody changed one: the list is
   * already on screen, and dropping back to "not loaded" would flash every surface gated on it.
   */
  async function loadTaskStates(quiet = false): Promise<void> {
    const dataset = datasetStore.currentDataset()?.handle;
    const uuid = datasetStore.currentDataset()?.id;
    const ports = session.backendPorts()?.schemas;
    if (!dataset || !ports || !datasetStore.isWeSpace()) {
      setOwnTaskStates([]);
      setTaskStatesLoaded(true);
      return;
    }
    if (!quiet) setTaskStatesLoaded(false);
    try {
      // Every space predates this entity, so none of them have its shape installed. `ensure` is the
      // diff-first idempotent path — a read in the common case — and the same step `loadShapes`
      // takes for exactly this reason.
      await ports.ensure(dataset, TaskState);
      const records = await TaskState.findAll(dataset);
      if (datasetStore.currentDataset()?.id !== uuid) return; // navigated away while loading
      applyTaskStates(records);
    } catch (error) {
      console.warn('SpaceStore: could not read task states', error);
      if (datasetStore.currentDataset()?.id === uuid) setOwnTaskStates([]);
    } finally {
      if (datasetStore.currentDataset()?.id === uuid) setTaskStatesLoaded(true);
    }
  }

  /** The space's state records, as the store holds them — from a read, or from what a watch pushed. */
  function applyTaskStates(rows: TaskState[]): void {
    const records = dedupeBySlug(rows);
    setOwnTaskStates(
      records.map((r: TaskState) => ({
        id: r.id,
        name: r.name || r.slug,
        slug: r.slug || deriveSlug(r.name || ''),
        semantic: r.semantic || 'open',
        color: r.color || '',
        icon: r.icon || '',
        retired: Boolean(r.retired),
        // A record written before these existed has neither: one approval, from anybody.
        approvals: approvalsOf({ slug: '', approvals: r.approvals }),
        approverKind: r.approverKind || '',
        evidence: readTaskStateEvidence(r.evidence).map((g) => ({
          entity: g.entity,
          ...(g.where ? { where: g.where } : {}),
          via: g.via && 'relation' in g.via ? g.via.relation : '',
          min: g.min ?? 1,
          label: evidenceLabel(g),
        })),
      })),
    );
  }

  /*
    Followed from entering the space.

    Another member's rename, colour or new state has to reach everybody here: a member still holding
    an old rule would be offered Approve on a move their vote no longer counts toward.

    The watch starts after `ensure`, which installs the entity's shape on a space that predates it —
    a query against a shape the dataset does not hold has nothing to watch.
  */
  createEffect(() => {
    const dataset = datasetStore.currentDataset()?.handle;
    const weSpace = datasetStore.isWeSpace();
    const ports = session.backendPorts()?.schemas;
    if (!dataset || !weSpace || !ports) {
      // Nothing to follow: the list is empty, and answered.
      void loadTaskStates();
      return;
    }
    setTaskStatesLoaded(false);
    followLive(
      solidReactivity,
      async (current) => {
        // The shape is installed first — see above. After that the query's first result is the list.
        await ports.ensure(dataset, TaskState);
        return current() ? TaskState.query(dataset, {}) : undefined;
      },
      {
        store: 'SpaceStore',
        what: 'task states',
        // The pushed rows are the states, whole — the read `loadTaskStates` makes — so a change is
        // applied from them. The list is already on screen, so nothing drops back to "not loaded".
        apply: (rows) => {
          try {
            applyTaskStates(rows);
          } catch (error) {
            console.warn('SpaceStore: could not read task states', error);
          }
          setTaskStatesLoaded(true);
        },
        stored: { read: () => TaskState.findAll(dataset), apply: applyTaskStates },
        // The states held are the previous space's (this effect runs per space), so a list that could
        // not be read is emptied; either way the list is answered.
        settled: (loaded) =>
          batch(() => {
            if (!loaded) setOwnTaskStates([]);
            setTaskStatesLoaded(true);
          }),
      },
    );
  });

  /**
   * The community's chosen order — a separate fact from which states exist, see `Space.taskStates`.
   *
   * Read through an `include` on a fresh fetch rather than off the subscribed space record. The
   * subscription's copy is whatever the last push carried, and reading it right after a write handed
   * back the order from *before* the write — the list snapped to the old arrangement, then never
   * caught up, since nothing re-read it when the push arrived. A hydrated include goes through the
   * executor's ordered read, so what comes back is the arrangement as every peer would read it.
   *
   * Re-run whenever the space record changes, which is how a peer's reorder reaches this screen, and
   * how this agent's own write is confirmed after `reorderTaskStates` has already shown it.
   */

  /** The state order a pushed record carries, or null for a record that is not a push or carries none. */
  function pushedTaskStateOrder(space: Space): string[] | null {
    if (!pushedOnScreen(space) || !Array.isArray(space.taskStates)) return null;
    return taskStateIds(space.taskStates);
  }

  function taskStateIds(rows: unknown): string[] {
    return ((Array.isArray(rows) ? rows : []) as ({ id?: string } | string)[])
      .map((row) => (typeof row === 'string' ? row : (row?.id ?? '')))
      .filter(Boolean);
  }

  async function loadTaskStateOrder(spaceId: string): Promise<void> {
    const dataset = datasetStore.currentDataset()?.handle;
    if (!dataset) return;
    try {
      const record = await Space.findOne(dataset, { where: { id: spaceId }, include: { taskStates: true } });
      if (currentSpace()?.id !== spaceId) return; // moved on while loading
      setTaskStateOrder(taskStateIds(record?.taskStates));
    } catch (error) {
      console.warn('SpaceStore: could not read the task state order', error);
    }
  }

  createEffect(() => {
    const space = currentSpace();
    if (!space?.id) {
      setTaskStateOrder([]);
      return;
    }
    /*
      A record the live query pushed carries the order already: the query includes `taskStates`, and
      a push is the executor's hydrated, ordered read made after the change it reports — the same
      answer the fresh read below gets. Opening a space read the record a second time for it, on the
      path to the first feed page. A copy this store made for an optimistic write is not a push, and
      its `taskStates` may predate a reorder, so that one is read fresh, as before.
    */
    const pushed = pushedTaskStateOrder(space);
    if (pushed) setTaskStateOrder(pushed);
    else void loadTaskStateOrder(space.id);
  });

  /**
   * The row objects the list rendered last time, by slug, so a recompute hands back the same object
   * for a state that has not changed. The renderer keys `$each` rows by reference: a fresh object per
   * state per recompute remounted every row — the flash — and with it the sortable's own bookkeeping.
   */
  let renderedTaskStates = new Map<string, TaskStateView>();
  const sameState = (a: TaskStateView, b: TaskStateView) =>
    a.id === b.id &&
    a.name === b.name &&
    a.slug === b.slug &&
    a.semantic === b.semantic &&
    a.color === b.color &&
    a.icon === b.icon &&
    a.retired === b.retired &&
    a.approvals === b.approvals &&
    a.approverKind === b.approverKind &&
    JSON.stringify(a.evidence) === JSON.stringify(b.evidence);

  /**
   * The states this space uses, as screens read them.
   *
   * "To do" renamed to "Backlog" is one state with one slug, and every task holding `todo` follows it.
   *
   * Ordered by the community's own arrangement where it has one, and otherwise by semantic — what is
   * coming, what is happening, what is stuck, what is finished, what was dropped. That is the only
   * ordering that means anything across communities, and a position number on each state would be a
   * scalar two people editing at once break — see the note on `TaskState`.
   */
  const taskStates = createMemo<TaskStateView[]>(() => {
    const states = [...ownTaskStates()];
    /*
      The community's own order where it has one, and what a state *counts as* where it has not.

      Position hints over a membership, one more time: a state the order does not mention is not
      dropped, it follows the ones it does — which is what lets a newly named state appear at all
      without anybody having to arrange the columns first.
    */
    const chosen = taskStateOrder();
    // Reading order for a state nobody has positioned: what is coming, what is happening, what is
    // stuck, what is finished, what was dropped. An unrecognised value sorts first, with the
    // outstanding work, which is where something nobody can read belongs.
    const rank: Record<string, number> = { open: 0, active: 1, blocked: 2, done: 3, cancelled: 4 };
    const at = (state: TaskStateView) => {
      const i = chosen.indexOf(state.id);
      return i === -1 ? Number.POSITIVE_INFINITY : i;
    };
    const sorted = states.sort((a, b) => {
      if (at(a) !== at(b)) return at(a) < at(b) ? -1 : 1;
      return (rank[a.semantic] ?? 0) - (rank[b.semantic] ?? 0);
    });
    const next = new Map<string, TaskStateView>();
    const stable = sorted.map((state) => {
      const previous = renderedTaskStates.get(state.slug);
      const view = previous && sameState(previous, state) ? previous : state;
      next.set(state.slug, view);
      return view;
    });
    renderedTaskStates = next;
    return stable;
  });

  /** The states a person should be offered — the same list, without the withdrawn ones. */
  const offeredTaskStates = createMemo<TaskStateView[]>(() => taskStates().filter((s) => !s.retired));

  /*
    The space's task states as a workflow — see `shared/taskWorkflow.ts` for when a space has one and what it
    compiles to.

    Every state, withdrawn ones included: work still sits in a withdrawn state, and a workflow that did
    not know it could not move that work out of it.
  */
  const taskWorkflowRules = createMemo<TaskStateRule[]>(
    () =>
      taskStates().map((s) => ({
        slug: s.slug,
        approvals: s.approvals,
        approverKind: s.approverKind,
        evidence: readTaskStateEvidence(storeTaskStateEvidence(s.evidence)),
      })),
    [],
    { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
  );
  const taskWorkflowRule = createMemo<TaskWorkflowRule>(() => {
    const rule = currentSpace()?.taskWorkflowRule ?? '';
    return rule === 'next' || rule === 'next-and-back' ? rule : '';
  });
  const taskWorkflowDefinition = createMemo(() => compileTaskWorkflow(taskWorkflowRules(), taskWorkflowRule()));
  /** Why a task's move was refused, naming the rule — in the community's own words for its states. */
  const explainTaskMove = (from: string, to: string, outcome: string): string | null => {
    const names = new Map(taskStates().map((state) => [state.slug, state.name]));
    return refusalWords(untrack(taskWorkflowDefinition), from, to, outcome, {
      state: (slug) => names.get(slug) ?? slug,
      kind: (slug) => slug,
    });
  };
  const taskWorkflowEnabled = (): boolean =>
    Boolean(taskWorkflowDefinition() && session.backendPorts()?.workflows && datasetStore.isWeSpace());
  const [taskWorkflowView, setTaskWorkflowView] = createSignal<WorkflowView | null>(null);

  const taskWorkflow = createTaskWorkflowActions({
    dataset: () => datasetStore.currentDataset()?.handle,
    port: () => (taskWorkflowEnabled() ? session.backendPorts()?.workflows : undefined),
    states: () => taskWorkflowRules(),
    rule: () => taskWorkflowRule(),
  });

  /*
    Keep the definition installed, and watch the runs.

    Keyed on the space and the definition's text, so a recompute of the states that changes nothing
    about agreement — a rename, a colour — neither reinstalls nor re-subscribes.

    **Installed only by whoever administers the space.** The definition is shared: every member's
    board derives from the one copy the space holds, so one person owns writing it — the same person
    the space's other shared settings answer to. A member's device only watches. The port diffs
    before writing, so an administrator opening a space whose definition is already current writes
    nothing.
  */
  const taskWorkflowKey = createMemo(() => {
    const definition = taskWorkflowDefinition();
    const id = datasetStore.currentDataset()?.id;
    return definition && id && taskWorkflowEnabled() ? `${id}\u0000${JSON.stringify(definition)}` : '';
  });
  createEffect(() => {
    const key = taskWorkflowKey();
    setTaskWorkflowView(null);
    if (!key) return;
    const port = session.backendPorts()?.workflows;
    const dataset = datasetStore.currentDataset()?.handle;
    const definition = untrack(taskWorkflowDefinition);
    if (!port || !dataset || !definition) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
      stop?.();
    });
    void (async () => {
      if (untrack(canAdministerCurrentSpace)) {
        try {
          await port.install(dataset, definition);
        } catch (error) {
          console.error('SpaceStore: could not install the task workflow', error);
          toastService.error('Could not save which moves need agreement');
        }
      }
      if (cancelled) return;
      try {
        const unsubscribe = await port.watch(dataset, TASK_WORKFLOW, (view) => {
          if (!cancelled) setTaskWorkflowView(view);
        });
        if (cancelled) unsubscribe();
        else stop = unsubscribe;
      } catch (error) {
        console.warn('SpaceStore: could not watch the task workflow', error);
      }
    })();
  });

  // What the board draws from — the view and the rules, together, or nothing.
  createEffect(() => {
    const view = taskWorkflowView();
    const rules = Object.fromEntries(
      taskWorkflowRules().map((rule) => [
        rule.slug,
        { approvals: approvalsOf(rule), approverKind: rule.approverKind ?? '' },
      ]),
    );
    taskWorkflowLive.set(taskWorkflowKey() && view ? { view, rules } : null);
  });
  onCleanup(() => taskWorkflowLive.set(null));

  /**
   * Write `status` to follow a move that happened, for every surface that reads it rather than the run.
   * Whoever's action made the move writes it, so it is written once and by somebody who saw it happen.
   */
  async function mirrorTaskStatus(taskId: string, slug: string): Promise<void> {
    const p = datasetStore.currentDataset()?.handle;
    // The registry answers untyped, but what it holds under 'TaskBlock' is the TaskBlock class.
    const Task = p ? (getEntityForDataset('TaskBlock', p) as typeof TaskBlock | undefined) : undefined;
    if (!p || !Task) return;
    const task = await Task.findOne(p, { where: { id: taskId } });
    if (!task || task.status === slug) return;
    task.status = slug;
    const started = performance.now();
    await task.save();
    trace('workflows', 'mirror', { taskId, slug, ms: Math.round(performance.now() - started) });
  }

  /**
   * Agree with the move a task is waiting on — which is asking for the same move, so it is exactly
   * what dragging the card there would do.
   */
  async function approveTaskMove(taskId: string): Promise<void> {
    const view = taskWorkflowLive.view();
    const move = openMoveOf(view, taskId);
    const from = workflowStateOf(view, taskId);
    if (!move || !from) return;
    try {
      const outcome = await taskWorkflow.move(taskId, from, move.to);
      if (outcome === 'moved' || outcome === 'already-there') await mirrorTaskStatus(taskId, move.to);
      else if (outcome === 'stalled') {
        toastService.error('That card is stuck between two moves — one of them has to be withdrawn');
      } else if (outcome === 'slow') {
        // Not a failure: the vote is usually counted after the call gives up waiting, and the board
        // moves the card when it is.
        toastService.info('The node is still counting your approval — the card will move when it has');
      } else if (outcome === 'unmet') {
        toastService.error(
          explainTaskMove(from, move.to, outcome) ?? 'Not yet — what that column asks for is not there',
        );
      } else if (outcome === 'not-allowed') {
        toastService.error(explainTaskMove(from, move.to, outcome) ?? 'That card cannot move there from where it is');
      }
    } catch (error) {
      console.error('SpaceStore: could not agree with that move', error);
      toastService.error('Could not agree with that move');
    }
  }

  const archivedWorkflows = createMemo<string[]>(() => idListOf(currentSpace()?.archivedWorkflows), [], {
    equals: (a, b) => a.join('\u0000') === b.join('\u0000'),
  });

  /**
   * Put a workflow away or bring it back — `core.setWorkflowArchived`, cached and republished the
   * way every setting on the space is.
   */
  async function setWorkflowArchived(name: string, archived: boolean): Promise<void> {
    const ds = datasetStore.currentDataset();
    const space = currentSpace();
    if (!ds || !space) return;
    if (!canAdministerCurrentSpace()) throw new Error('Only whoever administers this space can archive its workflows');
    if (!name || idListOf(space.archivedWorkflows).includes(name) === archived) return;
    await writeSpaceSetting(ds, space, 'setWorkflowArchived', 'archivedWorkflows', { workflow: name, archived });
  }

  async function addTaskStateEvidence(
    slug: string,
    requirement: { entity: string; via?: string; min?: number },
  ): Promise<void> {
    if (!slug || !requirement?.entity) return;
    // `entity` is what the requirement form picked — a key such as "comment" — or an entity name.
    const [stored] = storeTaskStateEvidence([{ ...requirement, ...evidenceSubjectOf(requirement.entity) }]) ?? [];
    if (!stored) return;
    await changeTaskState('addTaskStateEvidence', { slug, requirement: stored }, 'Could not save that change');
  }

  async function removeTaskStateEvidence(slug: string, index: number): Promise<void> {
    if (!slug || !Number.isInteger(index) || index < 0) return;
    await changeTaskState('removeTaskStateEvidence', { slug, index }, 'Could not save that change');
  }

  /** See the interface. Persisted on the space the way `setWorkflowArchived` is. */
  async function setTaskWorkflowRule(rule: '' | 'next' | 'next-and-back'): Promise<void> {
    const ds = datasetStore.currentDataset();
    const space = currentSpace();
    if (!ds || !space) return;
    if (!canAdministerCurrentSpace()) throw new Error('Only whoever administers this space can change how tasks move');
    const next = rule === 'next' || rule === 'next-and-back' ? rule : '';
    if ((space.taskWorkflowRule ?? '') === next) return;
    await writeSpaceFields(ds, space, { taskWorkflowRule: next });
  }

  /** Take back this agent's vote on the move a task is waiting on. */
  async function withdrawTaskMove(taskId: string): Promise<void> {
    try {
      await taskWorkflow.withdraw(taskId);
    } catch (error) {
      console.error('SpaceStore: could not withdraw that vote', error);
      toastService.error('Could not withdraw that');
    }
  }

  /*
    Hand the record layer the vocabularies this community owns.

    A property whose declaration names a `vocabulary` has an `options` list that is only a floor —
    `TaskBlock.status` declares the three defaults because an extraction model has to be shown words
    it can use, and nothing enforces them, so a space that has named "Blocked" holds tasks in a state
    that list does not contain. A picker built from the declaration alone would refuse to offer the
    state the record is already in.

    Slugs, because a slug is what `TaskBlock.status` stores and what the declaration's own options
    are. Withdrawn states are left out for the reason `offeredTaskStates` exists: a picker should not
    offer a state the community has stopped using, even though work already sitting in one keeps it.

    Injected rather than read: this lives on records in the space, and RecordStore mounts above this
    one.
  */
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

  onCleanup(
    recordStore.provideVocabularies((vocabulary) =>
      vocabulary === 'taskState' ? offeredTaskStates().map((state) => state.slug) : undefined,
    ),
  );

  /**
   * Tell extraction which states this space actually uses.
   *
   * A model fills `TaskBlock.status` from the vocabulary it is shown, and what it is shown is the
   * hint on the *stored shape* — which the executor reads instead of the model class, so a space is
   * already the override point (see `interpretationHints.ts`). Without this, a community could add
   * "Blocked", get a Blocked column, and watch extraction keep writing the three defaults forever,
   * because nothing connected naming a state to telling the model it existed.
   *
   * Only for a space that has written a state of its own. One still on the defaults already matches
   * the declared hint, so writing it would customise every space to say what it already said — and a
   * customised hint stops receiving improvements from releases, which is a real cost to pay for a
   * no-op. Once a space has any state of its own the hint lists everything it offers, virtual
   * defaults included, since those are states too.
   *
   * Withdrawn states are left out: a state nobody may pick is not one a model should write.
   *
   * Known limitation, and it is the one `interpretationHints.ts` documents for every hint: a
   * *structural* shape refresh — the model gaining a property in a release — rewrites the shape
   * graph and drops customised hints with it. This is re-derived the next time a state changes
   * rather than watched for, because the alternative is a read on every space open to check whether
   * a hint the community may never have touched still says what we last wrote.
   */
  async function syncTaskStateHint(): Promise<void> {
    const dataset = datasetStore.currentDataset()?.handle;
    const ports = session.backendPorts()?.schemas;
    const offered = offeredTaskStates();
    if (!dataset || !ports || !ownTaskStates().length || !offered.length) return;
    const list = offered.map((state) => `"${state.slug}"`).join(', ');
    /*
      Where a task lands when the conversation does not say.

      **The community's first column**, not "the first state that counts as open" — which any
      second open state could take over.

      Reading it as the first column makes it something the community can *see* and change: the
      leftmost column of the board is where new work arrives. `offered` is already in their order.
      Blocked and cancelled are refused outright — whatever is at the front, an interpretation pass has no
      business declaring work stuck or dropped before anybody has looked at it.
    */
    const entry = offered.find((state) => state.semantic === 'open' || state.semantic === 'active');
    try {
      await ports.setInterpretationHints(dataset, 'TaskBlock', {
        propHints: {
          'we://status': `Exactly one of: ${list}.${
            entry ? ` Use "${entry.slug}" unless the speaker says work has begun.` : ''
          }`,
        },
      });
    } catch (error) {
      // A space whose shape predates the property, or a peer without write access. The states still
      // work; extraction just keeps using the vocabulary it already had.
      console.warn('SpaceStore: could not update the interpretation hint for task states', error);
    }
  }

  /**
   * A change to the space's states, then the two things only the host does after one: read them
   * again for what follows on this screen (the board and the interpretation hint read the list), and
   * tell interpretation which states there are. The watch would bring the same rows a moment later.
   */
  async function changeTaskState(operation: string, args: Record<string, unknown>, failure: string): Promise<void> {
    try {
      await runCore(operation, args);
    } catch (error) {
      reportOperation('change a task state', failure, error);
      return;
    }
    await loadTaskStates(true);
    await syncTaskStateHint();
  }

  /**
   * Name a state this community's work moves through — `core.createTaskState`, which derives the
   * slug and refuses one the space already has.
   *
   * The space's own board — Everything, the catch-all — gains a column for the new state in the same
   * act, so the one board whose job is to show all the work never lags the vocabulary. Boards people
   * made are left alone; theirs offer the column from Unplaced when work in the state shows up.
   */
  async function createTaskState(config: {
    name: string;
    semantic?: TaskStateView['semantic'];
    color?: string;
    icon?: string;
  }): Promise<void> {
    if (!config?.name?.trim()) return;
    let slug: string;
    try {
      ({ slug } = await runCore<{ slug: string }>('createTaskState', {
        name: config.name,
        semantic: config.semantic,
        color: config.color,
        icon: config.icon,
      }));
    } catch (error) {
      reportOperation('create a task state', 'Could not add that state', error);
      return;
    }
    await loadTaskStates(true);
    await Promise.all([syncTaskStateHint(), boards.addStateToSpaceBoard(slug, config.name.trim())]);
  }

  /**
   * Change a state the community already has — its name, its colour, its glyph, what it counts as,
   * and what agreement moving into it asks for. `core.updateTaskState` holds the rules: the slug is
   * not in the update (it is what every task stores; renaming is what `name` is for), `semantic` is
   * (the field most likely chosen wrongly at creation, and otherwise unfixable), and an empty string
   * clears where an absent key leaves a field alone.
   *
   * Normalised here: the approvals into their range, and the evidence form's keys ("comment") into
   * requirements as the state stores them.
   */
  async function updateTaskState(
    slug: string,
    updates: {
      name?: string;
      icon?: string;
      color?: string;
      semantic?: TaskStateView['semantic'];
      approvals?: number;
      approverKind?: string;
      evidence?: { entity: string; where?: Record<string, string | number | boolean>; via?: string; min?: number }[];
    },
  ): Promise<void> {
    if (!slug || !updates) return;
    await changeTaskState(
      'updateTaskState',
      {
        slug,
        name: updates.name,
        icon: updates.icon,
        color: updates.color,
        semantic: updates.semantic,
        approverKind: updates.approverKind,
        approvals: updates.approvals === undefined ? undefined : approvalsOf({ slug, approvals: updates.approvals }),
        // None at all is stored as nothing, which is a clear.
        evidence: Array.isArray(updates.evidence)
          ? (storeTaskStateEvidence(
              updates.evidence.map((requirement) => ({ ...requirement, ...evidenceSubjectOf(requirement.entity) })),
            ) ?? '')
          : undefined,
      },
      'Could not save that change',
    );
  }

  /**
   * Set the order this community reads its states in — what a column drag on the board writes.
   *
   * An ordered relation rather than a number on each state, which is the difference between a
   * reorder that survives two people doing it at once and one where the second write silently
   * discards the first. Takes slugs, which is what a screen holds; `core.reorderTaskStates` writes
   * the relation over the records' ids.
   */
  async function reorderTaskStates(orderedSlugs: string[]): Promise<void> {
    const space = currentSpace();
    if (!space?.id || !Array.isArray(orderedSlugs)) return;
    const ids = new Map(taskStates().map((state) => [state.slug, state.id]));
    const shown = orderedSlugs.map((slug) => ids.get(slug)).filter((id): id is string => Boolean(id));
    if (!shown.length) return;
    const before = untrack(taskStateOrder);
    // Shown before it is written, and kept until the space record's next push carries the order the
    // backend holds — this one, or a peer's concurrent one that beat it.
    setTaskStateOrder(shown);
    try {
      setTaskStateOrder(await runCore<string[]>('reorderTaskStates', { space: space.id, slugs: orderedSlugs }));
    } catch (error) {
      setTaskStateOrder(before);
      reportOperation('reorder task states', 'Could not save that order', error);
    }
  }

  /**
   * Withdraw a state from use, or bring it back — without touching the work sitting in it.
   *
   * The same decision `setSignalTypeRetired` makes, for the same reason one layer along: a task
   * names its state by slug, so deleting the state leaves every task holding a word nothing
   * defines. Retiring stops it being offered and leaves everything readable.
   */
  async function setTaskStateRetired(slug: string, retired: boolean): Promise<void> {
    if (!slug) return;
    await changeTaskState('setTaskStateRetired', { slug, retired }, 'Could not update that state');
  }

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
    // State
    memberDids,
    members,
    spaceDefaultTemplateId,
    spaceDefaultThemeId,
    spaceList,
    taskStates,
    offeredTaskStates,
    taskStatesLoaded,
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
    createTaskState,
    updateTaskState,
    setTaskStateRetired,
    taskWorkflowEnabled,
    archivedWorkflows,
    setWorkflowArchived,
    setTaskWorkflowRule,
    addTaskStateEvidence,
    removeTaskStateEvidence,
    approveTaskMove,
    withdrawTaskMove,
    reorderTaskStates,
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
