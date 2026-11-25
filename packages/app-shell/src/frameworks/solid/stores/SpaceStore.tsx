import { createBoardActions } from '@shared/boards';
import { type SpaceAppearance } from '@shared/spaceAppearance';
import { removeSpaceFromParent, spaceSelfWhere, syncSpaceToParent } from '@shared/spaceSync';
import { createCallExports } from '@shared/stores/space/callExports';
import { createSpaceContext } from '@shared/stores/space/context';
import { createSpaceExtraction } from '@shared/stores/space/extraction';
import { createSpaceInvolvements } from '@shared/stores/space/involvements';
import { createSpaceModules } from '@shared/stores/space/modules';
import { createSpaceNavigation } from '@shared/stores/space/navigation';
import { createSpaceRoles } from '@shared/stores/space/roles';
import { createSpaceList, SPACE_AVATAR_PX } from '@shared/stores/space/spaces';
import { createSpaceTaskStates } from '@shared/stores/space/taskStates';
import type { CreatePostOptions, SpaceListEntry, SpaceMetaUpdate } from '@shared/stores/space/types';
import { createSpaceUnread } from '@shared/stores/space/unread';
import { createSpaceWrites } from '@shared/stores/space/writes';
import type { SpaceStore } from '@shared/stores/SpaceStore';
import { uploadOf } from '@shared/uploadOf';
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
import {
  CollectionBlock,
  compressImageToFileData,
  type DatasetProxy,
  dataURIToFileData,
  LocationBlock,
  Space,
} from '@we/entities';
import { solidReactivity } from '@we/reactivity-solid';
import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js';

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
  const { runCore, targetDataset, isCurrent } = ctx;

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

  // Who is on what in each space, and what each person gave.
  const involvements = createSpaceInvolvements({
    ...ctx,
    involvementOptimism,
    signalOptimism,
    signalOrder,
  });

  // What is new to this agent in each space, and who it has muted.
  const unread = createSpaceUnread(ctx);

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
    ...involvements.members,
    ...unread.members,
    // State
    memberDids,
    members,
    spaceDefaultTemplateId,
    spaceDefaultThemeId,
    spaceList,

    // Actions
    createPost,
    updatePost,
    ...boards,
    uploadFile,
    deleteCollection,
    updateSpaceImage,
    updateSpaceMeta,
    setSpaceDefaultTemplate,
    setSpaceDefaultTheme,
    firstScreenOpen: () => firstScreen.open(),
    setThreadMode,
    exportCallTranscript: callExports.exportCallTranscript,
    exportInterpretationLog: callExports.exportInterpretationLog,
  };

  return store;
}
